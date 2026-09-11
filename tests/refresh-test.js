const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { WebSocket } = require("ws");
const { chromium, webkit } = require("playwright");
const { createCompanion, atomicWrite } = require("../companion/server");
const { sanitizeState } = globalThis.__slaiState;
const { codedError, diagnoseError, diagnosticReport } = globalThis.__slaiErrors;
const originHeader = "chrome-extension://" + "a".repeat(32);
const until = async (check, timeout = 7000) => {
  const start = Date.now();
  while (!await check()) { if (Date.now() - start > timeout) throw new Error("Synthetic refresh condition timed out"); await new Promise(resolve => setTimeout(resolve, 20)); }
};
async function peer(service, token = service.config.writeToken) {
  const socket = new WebSocket(`ws://127.0.0.1:${service.writePort}/api/control`, { headers: { Origin: originHeader } });
  const messages = [];
  socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
  socket.on("error", () => {});
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.send(JSON.stringify({ schemaVersion: 1, type: "hello", token }));
  await until(() => messages.length);
  return { socket, messages, send: value => socket.send(JSON.stringify({ schemaVersion: 1, ...value })) };
}
async function protocolTest() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slai-refresh-protocol-"));
  let clock = Date.now(), service, client;
  const start = () => createCompanion({ dir, readPort: 0, writePort: 0, now: () => clock });
  try {
    service = await start();
    const base = () => `http://127.0.0.1:${service.readPort}`;
    const read = () => fetch(base() + "/api/state", { headers: { Authorization: "Bearer " + service.config.viewToken } }).then(r => r.json());
    const post = (body, extra = {}) => fetch(base() + "/api/refresh", { method: "POST", headers: { Origin: base(), "Content-Type": "application/json", Authorization: "Bearer " + service.config.viewToken, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const request = id => ({ schemaVersion: 1, id: id.repeat(32) });
    assert.equal((await post(request("a"), { Authorization: "Bearer " + service.config.writeToken })).status, 401);
    assert.equal((await post(request("a"), { Origin: "https://example.invalid" })).status, 403);
    assert.equal((await post(request("a"), { Origin: "" })).status, 403);
    assert.equal((await post({ ...request("a"), target: "PRIVATE_FIXTURE" })).status, 400);
    assert.equal((await post({ schemaVersion: 2, id: "a".repeat(32) })).status, 400);
    assert.equal((await post("x".repeat(256 * 1024 + 1))).status, 413);
    assert.equal((await fetch(base() + "/api/refresh")).status, 405);
    assert.equal((await fetch(base() + "/api/state", { method: "POST" })).status, 405);
    const offline = await (await post(request("a"))).json();
    assert.equal(offline.diagnostic.code, "REFRESH_CHANNEL_UNAVAILABLE");
    assert.equal((await read()).refresh.request, null);
    const bad = await peer(service, service.config.viewToken);
    assert.equal(bad.messages[0].diagnostic.code, "BRIDGE_TOKEN"); bad.socket.terminate();
    for (const [port, origin, status] of [[service.readPort, originHeader, 405], [service.writePort, "https://example.invalid", 403]]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/control`, { headers: { Origin: origin } });
      socket.on("error", () => {});
      const code = await new Promise(resolve => socket.on("unexpected-response", (_req, res) => { res.resume(); socket.terminate(); resolve(res.statusCode); }));
      assert.equal(code, status);
    }
    client = await peer(service);
    assert.equal(client.messages[0].type, "ready");
    const duplicate = await peer(service);
    assert.equal(duplicate.messages[0].diagnostic.code, "REFRESH_CHANNEL_BUSY"); duplicate.socket.terminate();
    assert.equal((await post(request("a"))).status, 202);
    await until(() => client.messages.some(message => message.type === "refresh"));
    const joined = await (await post(request("b"))).json();
    assert.equal(joined.refresh.request.id, "a".repeat(32));
    assert.equal(client.messages.filter(message => message.type === "refresh").length, 1);
    clock += 10001;
    await until(async () => (await read()).refresh.request.status === "failed");
    assert.equal((await read()).refresh.request.diagnostic.code, "REFRESH_ACK_TIMEOUT");
    assert.equal((await (await post(request("a"))).json()).refresh.request.status, "failed", "Retry must not replay the same request");
    assert.equal((await (await post(request("b"))).json()).refresh.request.id, "a".repeat(32), "A joined request whose response was lost must also remain idempotent after completion");
    await post(request("d"));
    client.send({ type: "result", id: "d".repeat(32), status: "running", diagnostic: null });
    await until(async () => (await read()).refresh.request.status === "running");
    clock += 1200001;
    client.send({ type: "ping" });
    await until(async () => (await read()).refresh.request.diagnostic?.code === "REFRESH_RESULT_TIMEOUT");
    assert.equal((await read()).refresh.request.diagnostic.timeoutMs, 1200000);
    await post(request("e"));
    client.send({ type: "result", id: "e".repeat(32), status: "running", diagnostic: null });
    await until(async () => (await read()).refresh.request.status === "running");
    client.send({ type: "result", id: "e".repeat(32), status: "failed", diagnostic: { code: "SWIPE_INCOMPLETE", stage: "read_swipes", page: 2, rowsRead: 10, expectedTotal: 23, message: "PRIVATE_FIXTURE", token: service.config.writeToken } });
    await until(async () => (await read()).refresh.request.status === "failed");
    const failed = (await read()).refresh.request;
    assert.match(diagnosticReport(failed.diagnostic), /已读取：10 条/);
    assert.match(diagnosticReport(failed.diagnostic), /预期总数：23 条/);
    assert(!JSON.stringify(failed).includes("PRIVATE_FIXTURE") && !JSON.stringify(failed).includes(service.config.writeToken));
    const cooling = await post(request("c")); assert.equal(cooling.status, 429);
    assert.equal((await cooling.json()).diagnostic.retryAfterSeconds, 10);
    clock += 10001;
    await post(request("c"));
    client.send({ type: "result", id: "c".repeat(32), status: "running", diagnostic: null });
    await until(async () => (await read()).refresh.request.status === "running");
    client.socket.terminate();
    await until(async () => (await read()).refresh.request.diagnostic?.code === "REFRESH_CHANNEL_LOST");
    await service.close(); service = await start();
    assert.equal((await read()).refresh.request, null, "Restart must not replay a command");
    assert.equal((await read()).refresh.available, false);
    assert.equal((await read()).state, null, "Phone refresh cannot supply attendance data");
    console.log("Passed: refresh origin/token/schema/body/method checks, localhost-only authenticated command channel, idempotent/coalesced requests, acknowledgement timeout, cooldown, safe school diagnostics, disconnect and no replay after restart.");
  } finally { if (client) client.socket.terminate(); if (service) await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
function fixtureState(status = "ok", diagnostic = null) {
  const date = globalThis.__slaiTime.localDateKey();
  const updatedAt = new Date().toISOString();
  return sanitizeState({ schemaVersion: 4, status, diagnostic, month: date.slice(0, 7), days: [], updatedAt, summaryUpdatedAt: updatedAt,
    lastCompleteToday: { date, updatedAt, swipes: [{ timestamp: date + " 00:00:00", direction: "进门" }, { timestamp: date + " 00:00:00", direction: "出门" }] } });
}
async function integrationTest() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slai-refresh-integration-"));
  let service, context, clockOffset = 0, failWrite = false, calls = 0, finish;
  let gate;
  const browsers = [], pages = [], schoolRequests = [];
  const storage = { attendanceState: fixtureState() };
  const start = (readPort = 0, writePort = 0) => createCompanion({ dir, readPort, writePort, now: () => Date.now() + clockOffset, persist: async (...args) => { if (failWrite) throw Object.assign(new Error("PRIVATE_FIXTURE"), { code: "ENOSPC" }); await atomicWrite(...args); } });
  const read = () => fetch(`http://127.0.0.1:${service.readPort}/api/state`, { headers: { Authorization: "Bearer " + service.config.viewToken } }).then(r => r.json());
  const begin = () => { gate = new Promise(resolve => { finish = resolve; }); };
  try {
    service = await start();
    storage.bridgeSettings = { enabled: true, token: service.config.writeToken };
    const event = () => ({ addListener() {} });
    class LocalSocket extends WebSocket {
      constructor(url) { assert.equal(url, "ws://127.0.0.1:32101/api/control"); super(`ws://127.0.0.1:${service.writePort}/api/control`, { headers: { Origin: originHeader } }); }
    }
    context = vm.createContext({ Date, TextEncoder, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, WebSocket: LocalSocket,
      fixtureCollect: async () => { calls++; return gate; },
      fetch: (url, options) => { assert.equal(url, "http://127.0.0.1:32101/api/state"); return fetch(`http://127.0.0.1:${service.writePort}/api/state`, options); },
      chrome: {
        storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, storage[key]])), set: async value => Object.assign(storage, structuredClone(value)), remove: async key => { delete storage[key]; } } },
        permissions: { contains: async () => true }, runtime: { sendMessage: async () => {}, onInstalled: event(), onStartup: event(), onMessage: event() },
        alarms: { create: async () => {}, clear: async () => {}, onAlarm: event() }, action: { onClicked: event() }, windows: { onRemoved: event() }, tabs: { onUpdated: event() }
      }
    });
    context.importScripts = (...names) => names.forEach(name => vm.runInContext(fsSync.readFileSync(path.join(__dirname, "../extension", name), "utf8"), context));
    vm.runInContext(fsSync.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8"), context);
    // Keep the actual refresh serializer, cache/diagnostic sanitizers, bridge and
    // WebSocket scripts. Only school responses are represented by a gated fixture.
    vm.runInContext("scrapeAttendance = async () => { await saveState(await fixtureCollect()); };", context);
    await context.initializeBridge();
    await until(async () => (await read()).refresh.available && (await read()).state?.status === "ok");
    for (const engine of [chromium, ...(process.platform === "darwin" ? [webkit] : [])]) {
      const browser = await engine.launch({ headless: true, ...(engine === chromium && process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
      browsers.push(browser);
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.on("request", request => { if (request.url().endsWith("/api/refresh")) schoolRequests.push(request.method()); });
      await page.goto(`http://127.0.0.1:${service.readPort}/#token=${service.config.viewToken}`);
      await page.waitForFunction(() => document.querySelector("#refreshView").disabled === false);
      assert.equal(await page.locator("#accessCard").evaluate(el => el.open), false);
      assert.equal(await page.locator("#connectionDetails").evaluate(el => el.open), false);
      assert((await page.locator("#accessCard").boundingBox()).y > (await page.locator(".month-section").boundingBox()).y);
      pages.push(page);
    }
    assert.equal(calls, 0); assert.deepEqual(schoolRequests, []);
    begin();
    // A desktop/automatic refresh already running must be joined by phone work.
    const desktopRefresh = context.refreshAttendance();
    await pages[0].locator("#refreshView").click();
    for (const page of pages.slice(1)) await page.evaluate(() => requestSchoolRefresh());
    await until(async () => (await read()).refresh.request?.status === "running");
    assert.equal(calls, 1);
    for (const page of pages) {
      await page.evaluate(() => fetchState());
      assert.match(await page.locator("#schoolRefreshStatus").innerText(), /正在抓取/);
      assert.equal(await page.locator("#refreshView").isDisabled(), true);
    }
    finish(fixtureState()); await desktopRefresh;
    for (const page of pages) await page.waitForFunction(() => document.querySelector("#schoolRefreshStatus").textContent.includes("学校数据已更新"));
    assert.equal((await read()).refresh.request.status, "succeeded");
    const advance = async () => {
      clockOffset += 11000;
      vm.runInContext('refreshSocket.send(JSON.stringify({ schemaVersion: 1, type: "ping" }));', context);
      for (const page of pages) await page.evaluate(() => fetchState());
      await pages[0].waitForFunction(() => document.querySelector("#refreshView").disabled === false);
    };
    await advance(); begin(); await pages[0].locator("#refreshView").click();
    await until(() => calls === 2);
    finish(fixtureState("partial", { code: "SWIPE_INCOMPLETE", stage: "read_swipes", page: 2, rowsRead: 10, expectedTotal: 23, raw: "PRIVATE_FIXTURE" }));
    await pages[0].waitForFunction(() => document.querySelector("#schoolRefreshStatus").textContent.includes("已读 10 / 23 条"));
    await pages[0].locator("#connectionDetails > summary").click();
    await pages[0].evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
    await pages[0].locator("#copyConnection").click();
    const report = await pages[0].getByRole("textbox", { name: "可手动复制的报告" }).inputValue();
    assert.match(report, /SWIPE_INCOMPLETE/); assert.match(report, /目标页：第 2 页/); assert.match(report, /预期总数：23 条/); assert(!report.includes("PRIVATE_FIXTURE"));
    await pages[0].getByRole("button", { name: "关闭手动复制" }).click();
    await advance(); begin(); failWrite = true; await pages[0].locator("#refreshView").click();
    await until(() => calls === 3); finish(fixtureState());
    await pages[0].waitForFunction(() => document.querySelector("#schoolRefreshStatus").textContent.includes("原子保存"));
    assert.equal(storage.attendanceState.status, "ok", "Bridge storage failure cannot overwrite the school result");
    assert.match(await pages[0].locator("#connectionReport").innerText(), /ENOSPC/);
    failWrite = false;
    await advance(); begin(); await pages[0].locator("#refreshView").click();
    await until(() => calls === 4); finish(fixtureState());
    await pages[0].waitForFunction(() => document.querySelector("#schoolRefreshStatus").textContent.includes("学校数据已更新"));
    assert.doesNotMatch(await pages[0].locator("#connectionReport").innerText(), /SWIPE_INCOMPLETE|ENOSPC/);
    await advance(); begin(); await pages[0].locator("#refreshView").click(); await until(() => calls === 5);
    const ports = [service.readPort, service.writePort];
    await service.close(); service = await start(...ports);
    await pages[0].evaluate(() => fetchState());
    assert.match(await pages[0].locator("#schoolRefreshStatus").innerText(), /服务进程已更换/);
    await until(async () => (await read()).refresh.available);
    finish(fixtureState()); await until(() => vm.runInContext("remoteRefreshWork === null", context));
    assert.equal((await read()).refresh.request, null);
    assert.equal(calls, 5, "Reconnect must not start another school collection");
    const phone = pages[0], heldRequests = [], attemptedIds = [];
    phone.on("request", request => { if (request.url().endsWith("/api/refresh")) attemptedIds.push(request.postDataJSON().id); });
    await phone.route("**/api/refresh", route => { heldRequests.push(route); });
    await phone.locator("#refreshView").click();
    await phone.waitForFunction(() => document.querySelector("#connectionReport").textContent.includes("REFRESH_SEND_TIMEOUT"));
    assert.match(await phone.locator("#connectionReport").innerText(), /等待上限：3 秒/);
    assert.equal(calls, 5, "A request stalled before delivery must not scrape school data");
    await phone.unroute("**/api/refresh");
    for (const route of heldRequests) await route.abort().catch(() => {});
    begin(); await phone.locator("#refreshView").click();
    await until(() => calls === 6); finish(fixtureState());
    await phone.waitForFunction(() => document.querySelector("#schoolRefreshStatus").textContent.includes("学校数据已更新"));
    assert.equal(attemptedIds[0], attemptedIds[1], "An uncertain delivery must reuse its request identifier");
    assert.doesNotMatch(await phone.locator("#connectionReport").innerText(), /REFRESH_SEND_TIMEOUT/);
    await advance();
    await phone.route("**/api/refresh", route => route.fulfill({ status: 404, contentType: "application/json", body: '{"raw":"PRIVATE_FIXTURE"}' }));
    await phone.locator("#refreshView").click();
    await phone.waitForFunction(() => document.querySelector("#connectionReport").textContent.includes("REFRESH_UNSUPPORTED"));
    assert.match(await phone.locator("#connectionReport").innerText(), /404/);
    assert.doesNotMatch(await phone.locator("#connectionReport").innerText(), /PRIVATE_FIXTURE/);
    assert(schoolRequests.every(method => method === "POST"));
    assert(!JSON.stringify(storage.refreshDiagnostic).includes("PRIVATE_FIXTURE"));
    console.log("Passed: phone POST through real extension control/bridge/cache scripts and refresh serializer, Chrome/WebKit UI, collapsed bottom settings, desktop/phone coalescing, complete/partial/persistence failure/recovery, safe copy, service restart, timeout/idempotent retry, unsupported service and no automatic scrape.");
  } finally {
    if (context) context.stopRemoteRefresh();
    for (const browser of browsers) await browser.close();
    if (service) await service.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
(async () => {
  for (const code of ["REFRESH_CHANNEL_UNAVAILABLE", "REFRESH_CHANNEL_LOST", "REFRESH_CHANNEL_FAILED", "REFRESH_ACK_TIMEOUT", "REFRESH_RESULT_TIMEOUT", "REFRESH_RESULT_UNKNOWN", "REFRESH_COOLDOWN", "REFRESH_SEND_TIMEOUT", "REFRESH_SEND_FAILED", "REFRESH_UNSUPPORTED", "REFRESH_SERVER_RESTARTED"]) {
    const clean = sanitizeState({ status: "error", diagnostic: diagnoseError(codedError(code, { timeoutMs: 10000, retryAfterSeconds: 10, message: "PRIVATE_FIXTURE", token: "PRIVATE_FIXTURE" }), { stage: "remote_refresh", operation: "refresh" }) });
    const report = diagnosticReport(clean.diagnostic);
    assert(report.includes(code)); assert.match(report, /手机请求学校刷新/); assert.match(report, /10 秒/); assert(!JSON.stringify(clean).includes("PRIVATE_FIXTURE"));
  }
  await protocolTest(); await integrationTest();
})().catch(error => { console.error(error); process.exitCode = 1; });
