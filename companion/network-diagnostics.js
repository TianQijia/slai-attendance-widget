const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { validateStateEnvelope, LIMIT } = require("./protocol");
const { isPrivate, atomicWrite } = require("./server");
const { sanitizeReport, reportText, freshnessChecks } = require("./network-report");
const { codedError, diagnoseError } = globalThis.__slaiErrors;
const diagnostic = (error, stage = "network_probe", fields = {}) => diagnoseError(error, { stage, ...fields });
const safeError = (code, error, fields = {}) => codedError(code, { ...fields, systemCode: error?.code }, error);
function privateAddresses(interfaces = os.networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter(a => a && a.family === "IPv4" && !a.internal && isPrivate(a.address)).map(a => a.address))];
}
function probe({ host, port, token, write = false, expectedInstance, timeoutMs = 3000 }) {
  if (host !== "127.0.0.1" && !isPrivate(host)) throw codedError("NET_RESPONSE_INVALID");
  const started = performance.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { req.destroy(); reject(error); } else resolve({ ...value, elapsedMs: Math.round(performance.now() - started) });
    };
    const req = http.request({ host, port, method: "GET", path: "/api/state", headers: token ? { Authorization: `Bearer ${token}` } : {}, agent: false }, res => {
      let size = 0; const chunks = [];
      res.on("data", bytes => {
        size += bytes.length;
        if (size > LIMIT + 4096) finish(codedError("NET_RESPONSE_INVALID", { port }));
        else chunks.push(bytes);
      });
      res.on("error", error => finish(safeError("NET_PROBE_FAILED", error, { port })));
      res.on("end", () => {
        try {
          if (res.statusCode !== (write ? 405 : 200)) throw codedError(res.statusCode === 401 ? "ACCESS_DENIED" : "NET_HTTP_FAILED", { port, httpStatus: res.statusCode });
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (write) {
            if (body.diagnostic?.code !== "METHOD_NOT_ALLOWED") throw codedError("NET_RESPONSE_INVALID", { port });
          } else {
            if (body.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(body.instanceId) || !Number.isFinite(Date.parse(body.serverTime)) || (expectedInstance && body.instanceId !== expectedInstance)) throw codedError("NET_RESPONSE_INVALID", { port });
            if (body.state !== null) validateStateEnvelope({ schemaVersion: 1, state: body.state });
          }
          finish(null, { httpStatus: res.statusCode, body });
        } catch (error) { finish(error.code ? error : safeError("NET_RESPONSE_INVALID", error, { port })); }
      });
    });
    const timer = setTimeout(() => finish(codedError("NET_PROBE_TIMEOUT", { port, timeoutMs })), timeoutMs);
    req.on("error", error => finish(safeError("NET_PROBE_FAILED", error, { port })));
    req.end();
  });
}
function systemChecks(input) {
  const issueCodes = { Denied: "NET_INSPECT_PERMISSION", CommandMissing: "NET_INSPECT_UNAVAILABLE", Failed: "NET_INSPECT_FAILED" };
  const issue = value => Object.hasOwn(issueCodes, value) ? { code: issueCodes[value], stage: "network_inspect" } : undefined;
  const category = { Private: "NET_PROFILE_PRIVATE", Public: "NET_PROFILE_PUBLIC", DomainAuthenticated: "NET_PROFILE_DOMAIN" };
  const firewall = { On: "NET_FIREWALL_ON", Off: "NET_FIREWALL_OFF", BlockAll: "NET_FIREWALL_BLOCK_ALL" };
  const rule = { Ready: "NET_RULE_READY", Missing: "NET_RULE_MISSING", Blocked: "NET_RULE_BLOCKED", Program: "NET_RULE_PROGRAM", Scope: "NET_RULE_SCOPE" };
  const checks = [];
  if (input?.platform === "win32") checks.push({ id: "profile", code: category[input.category] || "NET_PROFILE_UNKNOWN" });
  checks.push({ id: "firewall", code: firewall[input?.firewall] || "NET_FIREWALL_UNKNOWN", diagnostic: input?.diagnostic || issue(input?.profileIssue) });
  checks.push({ id: "rule", code: rule[input?.rule] || "NET_RULE_UNKNOWN", diagnostic: issue(input?.ruleIssue) });
  return checks;
}
async function inspectSystem({ platform = process.platform, host, runtime = process.execPath, execute = execFile } = {}) {
  try {
    if (platform === "win32") {
      // Absolute OS path works even when the launcher's PATH is empty. The
      // script reads task-specific env vars, never interpolated command text.
      const command = await fs.readFile(path.join(__dirname, "inspect-windows.ps1"), "utf8");
      const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const { stdout } = await execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { timeout: 10000, maxBuffer: 32768, windowsHide: true,
        env: { ...process.env, SLAI_DIAG_ADDRESS: isPrivate(host) ? host : "127.0.0.1", SLAI_DIAG_RUNTIME: runtime } });
      const value = JSON.parse(stdout.replace(/^\uFEFF/, ""));
      if (value.schemaVersion !== 1) throw codedError("NET_RESPONSE_INVALID");
      return systemChecks({ ...value, platform });
    }
    if (platform === "darwin") {
      const command = "/usr/libexec/ApplicationFirewall/socketfilterfw";
      const results = await Promise.allSettled([["--getglobalstate"], ["--getblockall"], ["--getappblocked", runtime]].map(args => execute(command, args, { timeout: 3000, maxBuffer: 32768, env: { ...process.env, LANG: "C", LC_ALL: "C" } })));
      const output = index => results[index].status === "fulfilled" ? results[index].value.stdout : "";
      const global = output(0), block = output(1), app = output(2);
      const firewall = /State\s*=\s*0\b/.test(global) ? "Off" : /State\s*=\s*1\b/.test(global) ? (/block all.*enabled/i.test(block) ? "BlockAll" : "On") : "Unknown";
      const rule = /^The application is not (?:part of|in) the firewall\.?\s*$/i.test(app.trim()) ? "Missing" : /(?:is not blocked|is unblocked|is permitted)\.?\s*$/i.test(app) ? "Ready" : /is blocked\.?\s*$/i.test(app) ? "Blocked" : "Unknown";
      const failed = results.find(result => result.status === "rejected");
      return systemChecks({ platform, firewall, rule, diagnostic: failed ? diagnostic(safeError("NET_INSPECT_FAILED", failed.reason), "network_inspect") : undefined });
    }
    return systemChecks({ platform });
  } catch (error) {
    return systemChecks({ platform, diagnostic: diagnostic(safeError("NET_INSPECT_FAILED", error), "network_inspect", error.killed ? { timeoutMs: 10000 } : {}) });
  }
}
async function collectDiagnostics({ dir, platform = process.platform, addresses = privateAddresses(), readPort = 32100, writePort = 32101, inspect = inspectSystem, request = probe, now = Date.now } = {}) {
  const checks = [];
  let config, selected;
  try {
    config = JSON.parse(await fs.readFile(path.join(dir, "config.local.json"), "utf8"));
    if (!/^[A-Za-z0-9_-]{43}$/.test(config.viewToken) || !/^[A-Za-z0-9_-]{43}$/.test(config.writeToken) || config.viewToken === config.writeToken) throw codedError("CONFIG_FAILED");
    checks.push({ id: "config", code: "NET_CONFIG_READY" });
  } catch (error) {
    config = null;
    checks.push({ id: "config", code: error.code === "ENOENT" ? "NET_CONFIG_MISSING" : "NET_CONFIG_INVALID", diagnostic: diagnostic(safeError("CONFIG_FAILED", error), "read_cache") });
  }
  addresses = [...new Set(addresses.filter(isPrivate))];
  checks.push({ id: "addresses", code: addresses.length ? "NET_LAN_FOUND" : "NET_LAN_NONE", addressCount: addresses.length });
  try {
    const saved = JSON.parse(await fs.readFile(path.join(dir, "network.local.json"), "utf8"));
    if (!isPrivate(saved.host)) throw codedError("NET_RESPONSE_INVALID");
    selected = saved.host;
    checks.push({ id: "selected", code: addresses.includes(selected) ? "NET_ADDRESS_READY" : "NET_ADDRESS_CHANGED" });
  } catch (error) {
    checks.push({ id: "selected", code: error.code === "ENOENT" ? "NET_ADDRESS_MISSING" : "NET_ADDRESS_INVALID", diagnostic: error.code === "ENOENT" ? undefined : diagnostic(safeError("NET_INSPECT_FAILED", error), "network_inspect") });
  }
  let live;
  for (const [id, host, port, write] of [["loopback", "127.0.0.1", readPort, false], ["write", "127.0.0.1", writePort, true], ["lan", selected, readPort, false]]) {
    if ((!config && !write) || (id === "lan" && (!live || !addresses.includes(host)))) { checks.push({ id, code: "NET_SKIPPED", port }); continue; }
    try {
      const response = await request({ host, port, token: write ? undefined : config.viewToken, write, expectedInstance: id === "lan" ? live.instanceId : undefined });
      if (id === "loopback") live = response.body;
      checks.push({ id, code: write ? "NET_WRITE_READY" : "NET_HTTP_OK", port, elapsedMs: response.elapsedMs, httpStatus: response.httpStatus });
    } catch (error) { checks.push({ id, code: "NET_REQUEST_FAILED", port, diagnostic: diagnostic(error.code ? error : safeError("NET_PROBE_FAILED", error), "network_probe", { port }) }); }
  }
  if (live) checks.push(...freshnessChecks(live));
  else checks.push({ id: "extension", code: "NET_SKIPPED" }, { id: "data", code: "NET_SKIPPED" });
  try { checks.push(...await inspect({ platform, host: addresses.includes(selected) ? selected : undefined })); }
  catch (error) { checks.push({ id: "firewall", code: "NET_FIREWALL_UNKNOWN", diagnostic: diagnostic(safeError("NET_INSPECT_FAILED", error), "network_inspect") }); }
  checks.push({ id: "peer", code: "NET_PEER_UNVERIFIED" });
  return sanitizeReport({ schemaVersion: 1, platform, version: "1.2.0", createdAt: new Date(now()).toISOString(), checks });
}
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function reportHtml(input) {
  const text = reportText(input);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>SLAI 网络检测</title><style>body{font:16px/1.7 system-ui;background:#101b1a;color:#f3faf7;max-width:760px;margin:32px auto;padding:20px}p{color:#c2d2cd}button{font:inherit;padding:10px 18px;border:0;border-radius:8px;background:#72e4ad;color:#10221c;cursor:pointer}textarea{box-sizing:border-box;width:100%;min-height:70vh;background:#1d302b;color:#fff;font:14px/1.6 monospace;border:1px solid #507060;border-radius:8px;padding:16px}</style><h1>网络检测</h1><p>这是本次检测的快照。重新运行 diagnose 启动器可生成新报告；即使服务没有启动，也能检测。检测不会修改网络或防火墙。</p><button id="copyReport">复制脱敏报告</button><p id="copyStatus" role="status">报告不包含配对码、查看链接、IP、网络名称、账号或考勤明细。</p><textarea id="networkReport" aria-label="网络检测报告" readonly>${escape(text)}</textarea><script>document.getElementById('copyReport').addEventListener('click',async()=>{const report=document.getElementById('networkReport'),status=document.getElementById('copyStatus');try{await navigator.clipboard.writeText(report.value);status.textContent='已复制网络检测报告';}catch{report.focus();report.select();status.textContent='自动复制未获允许，请手动复制已选中的报告。';}});</script></html>`;
}
async function writeReport(dir, report) {
  const clean = sanitizeReport(report);
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await atomicWrite(path.join(dir, "network-diagnostic.local.json"), clean);
    const file = path.join(dir, "network-diagnostic.html");
    await fs.writeFile(file, reportHtml(clean), { mode: 0o600 });
    return file;
  } catch (error) { throw safeError("NET_REPORT_WRITE_FAILED", error, { stage: "network_report" }); }
}
module.exports = { collectDiagnostics, inspectSystem, systemChecks, privateAddresses, probe, writeReport, reportHtml };
