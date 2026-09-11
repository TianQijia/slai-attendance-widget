const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createCompanion, atomicWrite, loadConfig, isPrivate } = require("./server");
const { codedError, diagnoseError, diagnosticReport } = globalThis.__slaiErrors;
const root = path.resolve(__dirname, "..");
function dataDirectory() {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SLAIAttendance");
  return path.join(os.homedir(), "Library", "Application Support", "SLAIAttendance");
}
function lanAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal && isPrivate(a.address)).map(a => a.address))];
}
function escape(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
async function connectionInfo(dir, host) {
  const config = await loadConfig(dir);
  const url = `http://${host || "127.0.0.1"}:32100/#token=${config.viewToken}`;
  const file = path.join(dir, "connection.html");
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SLAI 本机连接信息</title><style>body{font:16px/1.7 system-ui;background:#101b1a;color:#f3faf7;max-width:680px;margin:40px auto;padding:24px}input,textarea{box-sizing:border-box;width:100%;font:14px/1.6 monospace;padding:12px;background:#263b36;color:#fff;border:1px solid #507060;border-radius:8px}a{color:#72e4ad}p{color:#c2d2cd}</style><h1>SLAI 手机查看</h1><p>1. 在 Chrome 扩展小窗展开“手机查看”，粘贴下方本机配对码，再点击启用。</p><input aria-label="本机配对码" readonly value="${escape(config.writeToken)}"><p>本机配对码仅交给电脑扩展，不发送到手机。</p><p>2. 手机与电脑连接同一 Wi-Fi，将下方查看链接传到自己的手机浏览器打开。</p><textarea aria-label="手机查看链接" readonly rows="3">${escape(url)}</textarea><p><a href="${escape(url)}" rel="noreferrer">在本机打开查看页</a></p><p>${host ? "已选择局域网地址：" + escape(host) : "未找到局域网地址，目前仅可本机查看。连接 Wi-Fi 后重新启动。"}</p><p>查看链接含访问令牌，请仅交给自己的设备。此版本使用局域网 HTTP；可信 Wi-Fi 内使用。</p><pre>${host ? "" : escape(diagnosticReport({ code: "LAN_UNAVAILABLE", stage: "companion_start" }))}</pre><p>学校次日才提供累计时长，今天按完整进出明细估算。电脑保持 Chrome 与伴随服务运行。</p></html>`;
  // Keep the diagnostic entry available even when the HTTP service is down.
  const help = '<section><h2>网络检测</h2><p>手机打不开时，双击 companion 文件夹内的 diagnose.command（Mac）或 diagnose.cmd（Windows）。检测会打开可复制的脱敏报告；服务未启动时也能运行。</p><p>检测只读取状态，不更改网络和防火墙。校园网是否允许设备互访，仍需手机访问确认。</p></section>';
  await fs.writeFile(file, html.replace("</html>", help + "</html>"), { mode: 0o600 });
  return file;
}
function openFile(file) {
  const child = spawn(process.platform === "win32" ? "explorer.exe" : "open", [file], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {}); child.unref();
}
async function status(dir) {
  try {
    const config = await loadConfig(dir);
    const res = await fetch("http://127.0.0.1:32100/api/state", { headers: { Authorization: `Bearer ${config.viewToken}` }, signal: AbortSignal.timeout(1000), redirect: "error" });
    if (!res.ok) return null;
    const value = await res.json();
    return value.schemaVersion === 1 ? value : null;
  } catch { return null; }
}
async function chooseHost(dir, requested, interactive) {
  const addresses = lanAddresses();
  if (requested) {
    if (!addresses.includes(requested)) throw codedError("LISTEN_FAILED", { stage: "companion_start", port: 32100 });
    await atomicWrite(path.join(dir, "network.local.json"), { host: requested }); return requested;
  }
  try { const saved = JSON.parse(await fs.readFile(path.join(dir, "network.local.json"), "utf8")); if (addresses.includes(saved.host)) return saved.host; } catch { /* Re-select a changed network. */ }
  if (addresses.length === 0) return null;
  let host = addresses[0];
  if (addresses.length > 1) {
    if (!interactive) throw codedError("LAN_SELECTION", { stage: "companion_start" });
    const rl = require("node:readline/promises").createInterface({ input: process.stdin, output: process.stdout });
    try {
      addresses.forEach((address, index) => process.stdout.write(`${index + 1}. ${address}\n`));
      const answer = await rl.question("选择手机所在局域网的地址编号：");
      host = addresses[Number(answer) - 1];
      if (!host) throw codedError("LAN_SELECTION", { stage: "companion_start" });
    } finally { rl.close(); }
  }
  await atomicWrite(path.join(dir, "network.local.json"), { host }); return host;
}
function startupDefinition(dir) {
  if (process.platform === "win32") return { file: path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "SLAI-Attendance.cmd"),
    content: `@echo off\r\n"${process.execPath}" "${path.join(__dirname, "cli.js")}" start --headless --data-dir "${dir}"\r\n` };
  return { file: path.join(os.homedir(), "Library", "LaunchAgents", "cn.slai.attendance.plist"),
    content: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>cn.slai.attendance</string><key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(__dirname, "cli.js"))}</string><string>start</string><string>--headless</string><string>--data-dir</string><string>${escape(dir)}</string></array><key>RunAtLoad</key><true/></dict></plist>` };
}
async function main(args = process.argv.slice(2)) {
  const command = args[0] || "start";
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const dir = path.resolve(option("--data-dir") || dataDirectory());
  if (command === "diagnose") {
    const { collectDiagnostics, writeReport } = require("./network-diagnostics");
    const { reportText } = require("./network-report");
    const report = await collectDiagnostics({ dir });
    console.log(reportText(report));
    const file = await writeReport(dir, report);
    if (!args.includes("--headless")) openFile(file);
    return;
  }
  await loadConfig(dir);
  const diagnosticFile = path.join(dir, "startup-diagnostic.local.json");
  if (command === "autostart" || command === "remove-autostart") {
    try {
      const entry = startupDefinition(dir);
      if (command === "autostart") { await fs.mkdir(path.dirname(entry.file), { recursive: true }); await fs.writeFile(entry.file, entry.content, { mode: 0o600 }); }
      else await fs.rm(entry.file, { force: true });
      console.log(command === "autostart" ? "已设置下次登录后自动启动。请将软件保留在当前文件夹。" : "已取消下次登录后自动启动。运行中的服务可用停止工具关闭。"); return;
    } catch { throw codedError("AUTOSTART_FAILED", { stage: "autostart" }); }
  }
  if (command === "stop") {
    const live = await status(dir);
    if (!live) { console.log("未检测到可联系的伴随服务。"); return; }
    try {
      const instance = JSON.parse(await fs.readFile(path.join(dir, "instance.local.json"), "utf8"));
      if (!Number.isSafeInteger(instance.pid) || instance.pid <= 1 || instance.instanceId !== live.instanceId) throw new Error();
      process.kill(instance.pid, "SIGTERM"); console.log("已向此伴随服务发送停止信号。"); return;
    } catch { throw codedError("STOP_FAILED", { stage: "companion_start" }); }
  }
  if (!["start", "serve", "info"].includes(command)) throw codedError("CONFIG_FAILED", { stage: "companion_start" });
  const host = await chooseHost(dir, option("--host"), process.stdin.isTTY);
  if (command === "info") {
    const file = await connectionInfo(dir, host); if (!args.includes("--headless")) openFile(file);
    console.log("已生成本机连接信息。配对码和查看链接仅保存在用户数据目录的 connection.html。"); return;
  }
  if (command === "start") {
    if (!await status(dir)) {
      await fs.rm(diagnosticFile, { force: true });
      const child = spawn(process.execPath, [path.join(__dirname, "cli.js"), "serve", "--data-dir", dir, ...(host ? ["--host", host] : [])], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      for (let i = 0; i < 40; i++) {
        if (await status(dir)) break;
        try { const diagnostic = JSON.parse(await fs.readFile(diagnosticFile, "utf8")); throw codedError(diagnostic.code, diagnostic); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        if (i === 39) throw codedError("BRIDGE_TIMEOUT", { stage: "companion_start", timeoutMs: 10000 });
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    const file = await connectionInfo(dir, host); if (!args.includes("--headless")) openFile(file);
    console.log("伴随服务已启动。查看端口 32100；写入端口仅在本机 32101。使用连接信息工具查看配对码和手机链接。"); return;
  }
  let service;
  try {
    service = await createCompanion({ dir, lanHost: host });
    await atomicWrite(path.join(dir, "instance.local.json"), { pid: process.pid, instanceId: service.instanceId });
    await connectionInfo(dir, host);
    const stop = async () => { await service.close(); process.exit(0); };
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
  } catch (error) {
    if (service) await service.close();
    await atomicWrite(diagnosticFile, diagnoseError(error, { stage: "companion_start" }));
    throw error;
  }
}
if (require.main === module) main().catch(error => { console.error(diagnosticReport(diagnoseError(error, { stage: "companion_start" }))); process.exitCode = 1; });
module.exports = { main, dataDirectory, lanAddresses, startupDefinition };
