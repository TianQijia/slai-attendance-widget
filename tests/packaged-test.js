const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { unzipSync } = require("fflate");
const { chromium } = require("playwright");
const { lanAddresses } = require("../companion/cli");
const root = path.resolve(__dirname, "..");
const version = require("../package.json").version;
const list = require("../release-files.json");
async function until(check, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Synthetic package check did not complete within its deadline");
}
async function unpack(file, dir, names) {
  const entries = unzipSync(await fs.readFile(file));
  assert.deepEqual(Object.keys(entries).sort(), [...names].sort());
  for (const [name, bytes] of Object.entries(entries)) {
    assert(!path.isAbsolute(name) && !name.split("/").includes(".."));
    const output = path.join(dir, name); await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, bytes);
    if (name.endsWith(".command") || name === "runtime/node") await fs.chmod(output, 0o755);
  }
}
(async () => {
  const target = process.platform === "win32" ? "win-x64" : "darwin-arm64";
  assert(target === "win-x64" || process.arch === "arm64", "Package smoke test requires a native supported host");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "slai-package-test-"));
  const bundle = path.join(temp, "bundle with spaces"), extension = path.join(temp, "extension"), dir = path.join(temp, "private data");
  const runtimeName = target === "win-x64" ? "runtime/node.exe" : "runtime/node";
  let context, config, running = false;
  const host = lanAddresses()[0];
  const invoke = command => {
    const script = path.join(bundle, "companion", `${command}.${target === "win-x64" ? "cmd" : "command"}`);
    const options = { env: { ...process.env, PATH: "" }, timeout: command === "diagnose" ? 30000 : 15000 };
    if (target !== "win-x64") return execFile(script, ["--headless", "--data-dir", dir, ...(host ? ["--host", host] : [])], options);
    const line = `""${script}" --headless --data-dir "${dir}"${host ? ` --host ${host}` : ""}"`;
    return execFile(path.join(process.env.SystemRoot, "System32", "cmd.exe"), ["/d", "/s", "/c", line], { ...options, windowsVerbatimArguments: true });
  };
  const read = async () => {
    const response = await fetch("http://127.0.0.1:32100/api/state", { headers: { Authorization: `Bearer ${config.viewToken}` }, signal: AbortSignal.timeout(1000) });
    assert(response.ok); return response.json();
  };
  try {
    await unpack(path.join(root, "dist", `slai-attendance-companion-v${version}-${target}.zip`), bundle, [...list.companion, ...list.companionPlatforms[target], runtimeName, "runtime/LICENSE"]);
    await unpack(path.join(root, "dist", `slai-attendance-widget-v${version}.zip`), extension, list.archive);
    const runtime = await execFile(path.join(bundle, runtimeName), ["--version"], { env: { ...process.env, PATH: "" } });
    assert.equal(runtime.stdout.trim(), "v22.23.2");
    await invoke("start"); running = true;
    config = JSON.parse(await fs.readFile(path.join(dir, "config.local.json"), "utf8"));
    assert.equal((await read()).state, null);
    const profile = path.join(temp, "browser-profile");
    const launch = async () => {
      const next = await chromium.launchPersistentContext(profile, {
        channel: "chromium", headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
        ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging",
          "--host-resolver-rules=MAP stu.slai.edu.cn 127.0.0.1, MAP sts.slai.edu.cn 127.0.0.1"]
      });
      await next.route("https://stu.slai.edu.cn/**", route => route.fulfill({ status: 302, headers: { location: "https://sts.slai.edu.cn/signin" }, body: "" }));
      await next.route("https://sts.slai.edu.cn/**", route => route.fulfill({ body: "Synthetic school login", contentType: "text/html" }));
      return next;
    };
    // The preceding install-test loads the exact final ZIP without alterations.
    // Native first-consent UI cannot be confirmed by headless CI. In THIS
    // disposable integration fixture only, pre-authorize the declared localhost
    // origin at load time. All application scripts remain byte-identical to ZIP;
    // the shipped manifest is separately audited and never changed in dist/.
    const manifestFile = path.join(extension, "manifest.json");
    const shippedManifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    assert.deepEqual(shippedManifest.host_permissions, ["https://stu.slai.edu.cn/*", "https://sts.slai.edu.cn/*"]);
    assert.deepEqual(shippedManifest.optional_host_permissions, ["http://127.0.0.1/*"]);
    const consentFixture = { ...shippedManifest, host_permissions: [...shippedManifest.host_permissions, ...shippedManifest.optional_host_permissions], optional_host_permissions: [] };
    await fs.writeFile(manifestFile, JSON.stringify(consentFixture));
    context = await launch();
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: extension });
    const worker = context.serviceWorkers().find(worker => worker.url().includes(id)) || await context.waitForEvent("serviceworker");
    // onInstalled awaits migration and window creation before it starts the
    // initial school refresh. A worker being available does not mean that
    // refreshPromise has been assigned yet, especially on Windows runners.
    // Wait for a terminal startup result before publishing our bridge fixture.
    await until(() => worker.evaluate(async () =>
      (await getState()).status !== "loading" && refreshPromise === null
    ), 35000);
    const page = await context.newPage(); await page.goto(`chrome-extension://${id}/widget.html`);
    await page.locator("#bridgeSettings summary").click();
    await page.locator("#bridgeToken").fill(config.writeToken);
    await page.locator("#enableBridge").click();
    try { await page.waitForFunction(() => document.querySelector("#bridgeStatus").textContent.includes("已启用"), null, { timeout: 5000 }); }
    catch (error) {
      console.log("Synthetic pairing status:", await page.locator("#bridgeStatus").innerText(), await page.locator("#bridgeReport").innerText());
      console.log("Synthetic localhost permission:", await worker.evaluate(() => chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] })));
      throw error;
    }
    const complete = await worker.evaluate(async () => {
      const date = localDateKey(); const updatedAt = new Date().toISOString();
      return saveState({ status: "ok", month: date.slice(0, 7), days: [], updatedAt, summaryUpdatedAt: updatedAt,
        todaySwipes: [{ timestamp: date + " 00:00:00", direction: "进门" }, { timestamp: date + " 00:00:00", direction: "出门" }], studentName: "PRIVATE_FIXTURE" });
    });
    await until(async () => (await read()).state?.status === "ok");
    const pushed = await read(); assert.equal(pushed.state.schemaVersion, 4); assert.equal(pushed.state.updatedAt, complete.updatedAt);
    assert(!JSON.stringify(pushed).includes("PRIVATE_FIXTURE"));
    const network = await invoke("diagnose");
    assert.match(network.stdout, /NET_HTTP_OK/); assert.match(network.stdout, /NET_EXTENSION_RECENT/);
    assert.match(network.stdout, /NET_DATA_FRESH/); assert.match(network.stdout, /NET_PEER_UNVERIFIED/);
    assert(!network.stdout.includes(config.viewToken) && !network.stdout.includes(config.writeToken));
    const report = JSON.parse(await fs.readFile(path.join(dir, "network-diagnostic.local.json"), "utf8"));
    assert.equal(report.platform, process.platform);
    assert.equal(report.checks.some(check => check.id === "profile"), target === "win-x64");
    assert(report.checks.some(check => check.id === "firewall"));
    assert(!network.stdout.includes("NET_INSPECT_FAILED"), "Bundled native firewall inspector must execute on the CI host");
    assert.equal((await read()).state.updatedAt, complete.updatedAt, "Network diagnosis must preserve original data timestamps");
    if (host) {
      const lan = await fetch(`http://${host}:32100/api/state`, { headers: { Authorization: `Bearer ${config.viewToken}` }, signal: AbortSignal.timeout(3000) });
      assert.equal(lan.status, 200);
      await assert.rejects(fetch(`http://${host}:32101/api/state`, { method: "POST", signal: AbortSignal.timeout(1000) }), "The write port must not listen on LAN");
    }
    await invoke("stop"); running = false;
    await until(async () => { try { await read(); return false; } catch { return true; } });
    const offlineNetwork = await invoke("diagnose");
    assert.match(offlineNetwork.stdout, /ECONNREFUSED/);
    await worker.evaluate(async () => { await queueBridgePush(await getState()); });
    const failure = await worker.evaluate(async () => ({ state: await getState(), bridge: await getBridgeInfo() }));
    assert.equal(failure.state.status, "ok"); assert.equal(failure.bridge.diagnostic.code, "BRIDGE_UNREACHABLE");
    await invoke("start"); running = true;
    const recoveredCache = await read(); assert.equal(recoveredCache.state.updatedAt, complete.updatedAt); assert.equal(recoveredCache.lastSeenAt, null);
    await worker.evaluate(async () => initializeBridge());
    await until(async () => !!(await read()).lastSeenAt);
    assert.equal((await worker.evaluate(() => getBridgeInfo())).diagnostic, null);
    const mobile = await context.newPage();
    await mobile.goto(`http://127.0.0.1:32100/#token=${config.viewToken}`);
    await mobile.waitForFunction(() => document.querySelector("#todayDuration").textContent === "00:00:00");
    assert.equal(await mobile.locator("#login").count(), 0);
    assert(!JSON.stringify(await fs.readFile(path.join(dir, "attendance.json"), "utf8")).includes("PRIVATE_FIXTURE"));
    console.log(`Final ZIP smoke test passed (${target}): bundled Node with empty PATH, paths with spaces, extension bridge with declared localhost pre-authorized only in the temporary consent fixture and real localhost fetch, private read/write isolation, source failure, restart recovery, and phone page. Only synthetic data was used.`);
  } finally {
    if (context) await context.close();
    if (running) { await invoke("stop").catch(() => {}); await new Promise(resolve => setTimeout(resolve, 300)); }
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
