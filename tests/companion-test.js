const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const { chromium } = require("playwright");
const { createCompanion, atomicWrite } = require("../companion/server");
const { state, sw, now } = require("./time-test");
const { sanitizeState } = globalThis.__slaiState;
const { diagnoseError, codedError, diagnosticReport } = globalThis.__slaiErrors;
async function bridgeTest() {
  const storage = { attendanceState: state([sw("08:00", "进门")]), bridgeSettings: { enabled: true, token: "a".repeat(43) } };
  let mode = "ok", active = 0, maxActive = 0;
  const sent = [], alarms = [];
  const context = vm.createContext({ Date, TextEncoder, AbortController, setTimeout, clearTimeout,
    __slaiState: globalThis.__slaiState, __slaiErrors: globalThis.__slaiErrors,
    getState: async () => storage.attendanceState,
    fetch: async (_url, request) => {
      active++; maxActive = Math.max(maxActive, active); sent.push(JSON.parse(request.body));
      try {
        if (mode === "unreachable") throw new TypeError("PRIVATE_FIXTURE");
        if (mode === "slow") await new Promise(resolve => setTimeout(resolve, 30));
        return { ok: mode !== "token", status: mode === "token" ? 401 : 200, json: async () => ({ diagnostic: { code: "BRIDGE_TOKEN", stage: "companion_request", token: "PRIVATE_FIXTURE" } }) };
      } finally { active--; }
    },
    chrome: {
      storage: { local: { get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, storage[k]])), set: async value => Object.assign(storage, structuredClone(value)), remove: async key => { delete storage[key]; } } },
      permissions: { contains: async () => true }, runtime: { sendMessage: async () => {} },
      alarms: { create: async (name, options) => alarms.push({ name, options }), clear: async () => {} }
    }
  });
  vm.runInContext(await fs.readFile(path.join(__dirname, "../extension/bridge-utils.js"), "utf8"), context);
  await context.initializeBridge(); await context.queueBridgePush(storage.attendanceState);
  assert.equal(alarms[0].options.periodInMinutes, 1);
  const before = JSON.stringify(storage.attendanceState);
  mode = "unreachable"; await context.queueBridgePush(storage.attendanceState);
  assert.equal(storage.bridgeDiagnostic.code, "BRIDGE_UNREACHABLE");
  assert.equal(storage.bridgeDiagnostic.stage, "bridge_push"); assert.equal(storage.bridgeDiagnostic.errorName, "TypeError");
  assert(!diagnosticReport(storage.bridgeDiagnostic).includes("PRIVATE_FIXTURE"));
  assert.equal(JSON.stringify(storage.attendanceState), before);
  mode = "token"; await context.queueBridgePush(storage.attendanceState);
  assert.equal(storage.bridgeDiagnostic.code, "BRIDGE_TOKEN"); assert.equal(storage.bridgeDiagnostic.httpStatus, 401);
  context.chrome.permissions.contains = async () => false;
  const beforeDenied = sent.length; await context.queueBridgePush(storage.attendanceState);
  assert.equal(storage.bridgeDiagnostic.code, "BRIDGE_PERMISSION"); assert.equal(sent.length, beforeDenied);
  context.chrome.permissions.contains = async () => true;
  mode = "slow";
  const first = context.queueBridgePush(storage.attendanceState);
  await new Promise(resolve => setTimeout(resolve, 5));
  context.queueBridgePush(state([sw("09:00", "进门")]));
  await context.queueBridgePush({ ...state([sw("09:30", "进门")]), account: "PRIVATE_FIXTURE" });
  await first;
  assert.equal(maxActive, 1); assert.equal(storage.bridgeDiagnostic, null);
  assert.equal(sent.at(-1).state.lastCompleteToday.swipes[0].timestamp, "2030-04-08 09:30:00");
  assert(!JSON.stringify(sent).includes("PRIVATE_FIXTURE"));
  await context.configureBridge({ enabled: false });
  const count = sent.length; await context.queueBridgePush(storage.attendanceState); assert.equal(sent.length, count);
}
async function run() {
  await bridgeTest();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slai-companion-test-"));
  let service, browser;
  let failWrite = false;
  const start = () => createCompanion({ dir, readPort: 0, writePort: 0, now: () => now, persist: async (...args) => { if (failWrite) throw Object.assign(new Error("PRIVATE_FIXTURE"), { code: "ENOSPC" }); await atomicWrite(...args); } });
  try {
    service = await start();
    const write = () => `http://127.0.0.1:${service.writePort}/api/state`;
    const read = () => `http://127.0.0.1:${service.readPort}/api/state`;
    const payload = { schemaVersion: 1, state: state([sw("08:00", "进门"), sw("08:10", "进门")]) };
    const post = (body = payload, headers = {}) => fetch(write(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + service.config.writeToken, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const get = () => fetch(read(), { headers: { Authorization: "Bearer " + service.config.viewToken } }).then(r => r.json());
    await assert.rejects(createCompanion({ dir, readPort: service.readPort, writePort: 0 }), error => {
      const diagnostic = diagnoseError(error);
      assert.equal(diagnostic.code, "PORT_IN_USE"); assert.equal(diagnostic.port, service.readPort);
      assert.match(diagnosticReport(diagnostic), /地址已被占用/); return true;
    });
    await assert.rejects(createCompanion({ dir, lanHost: "0.0.0.0", readPort: 0, writePort: 0 }), error => error.code === "LISTEN_FAILED");
    assert.equal((await post()).status, 200);
    const live = await get(); assert.deepEqual(live.state, payload.state); assert.equal(live.lastSeenAt, new Date(now).toISOString());
    assert.equal((await fetch(read())).status, 401);
    assert.equal((await fetch(read(), { method: "POST" })).status, 405);
    assert.equal((await fetch(write())).status, 405);
    assert.equal((await post(payload, { Authorization: "Bearer " + service.config.viewToken })).status, 401);
    assert.equal((await post(payload, { Origin: "https://example.invalid" })).status, 403);
    assert.equal((await post({ ...payload, state: { ...payload.state, studentName: "PRIVATE_FIXTURE" } })).status, 400);
    assert.equal((await post({ schemaVersion: 1, state: {} })).status, 400);
    assert.equal((await post("{")).status, 400);
    assert.equal((await post("x".repeat(256 * 1024 + 1))).status, 413);
    const timeoutResponse = await new Promise((resolve, reject) => {
      const req = http.request(write(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + service.config.writeToken, "Content-Length": "100" } }, res => { let text = ""; res.on("data", data => text += data); res.on("end", () => { resolve({ status: res.statusCode, body: JSON.parse(text) }); req.destroy(); }); });
      req.on("error", reject); req.write("{");
    });
    assert.equal(timeoutResponse.status, 408); assert.equal(timeoutResponse.body.diagnostic.timeoutMs, 3000);
    assert.equal((await get()).state.updatedAt, payload.state.updatedAt);
    const privateText = await fs.readFile(path.join(dir, "attendance.json"), "utf8"); assert(!privateText.includes("PRIVATE_FIXTURE"));
    failWrite = true;
    const failure = await (await post()).json(); assert.equal(failure.diagnostic.code, "CACHE_WRITE_FAILED");
    assert.equal(failure.diagnostic.stage, "companion_write"); assert.match(diagnosticReport(failure.diagnostic), /存储空间不足/); assert(!JSON.stringify(failure).includes("PRIVATE_FIXTURE"));
    assert.deepEqual((await get()).state, payload.state); failWrite = false;
    const oldToken = service.config.writeToken;
    await service.close(); service = await start();
    assert.equal(service.config.writeToken, oldToken);
    assert.equal((await get()).lastSeenAt, null); assert.deepEqual((await get()).state, payload.state);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
    const context = await browser.newContext({ timezoneId: "America/Los_Angeles", viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${service.readPort}/#token=${service.config.viewToken}`);
    await page.locator("#todayDuration").filter({ hasText: "01:50:00" }).waitFor();
    assert.match(await page.locator("#dataSource").innerText(), /上次完整结果/);
    assert.equal(await page.locator("#login").count(), 0); assert.equal(await page.locator("#refresh").count(), 0);
    assert.equal(new URL(page.url()).hash, "");
    await post(); await page.locator("#reconnect").click();
    await page.waitForFunction(() => document.querySelector("#statusText").textContent.includes("08:10:00"));
    assert.equal(await page.locator(".day-row.today").count(), 1);
    await page.locator("#networkDetails summary").click();
    await page.locator("#checkNetwork").click();
    await page.waitForFunction(() => document.querySelector("#networkReport").textContent.includes("NET_BROWSER_OK"));
    assert.match(await page.locator("#networkReport").innerText(), /NET_EXTENSION_RECENT/);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.copiedNetwork = text; } } }));
    await page.locator("#copyNetwork").click();
    assert.equal(await page.locator("#networkCopyStatus").innerText(), "已复制网络检测报告");
    assert(!(await page.evaluate(() => window.copiedNetwork)).includes(service.config.viewToken));
    await fs.mkdir(path.join(__dirname, "../test-results"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../test-results/mobile.png"), fullPage: true });
    await service.close(); service = null;
    await page.locator("#reconnect").click();
    await page.waitForFunction(() => document.querySelector("#connectionReport").textContent.includes("VIEW_UNREACHABLE"));
    assert.match(await page.locator("#dataSource").innerText(), /上次完整结果/);
    assert.equal(await page.locator("#todayDuration").innerText(), "01:50:00");
    await page.locator("#checkNetwork").click();
    await page.waitForFunction(() => document.querySelector("#networkReport").textContent.includes("NET_REQUEST_FAILED"));
    assert.match(await page.locator("#networkReport").innerText(), /VIEW_UNREACHABLE/);
    assert(!(await page.locator("#networkReport").innerText()).includes("NET_BROWSER_OK"));
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("PRIVATE_FIXTURE"); }; });
    await page.locator("#copyNetwork").click();
    assert.match(await page.locator("#networkCopyStatus").innerText(), /手动复制/);
    assert.match(await page.evaluate(() => window.getSelection().toString()), /VIEW_UNREACHABLE/);
    assert.deepEqual(errors, []);
    await browser.close(); browser = null;
    await fs.writeFile(path.join(dir, "attendance.json"), '{"studentName":"PRIVATE_FIXTURE"}');
    service = await start(); const damaged = await get();
    assert.equal(damaged.state, null); assert.equal(damaged.diagnostic.code, "CACHE_READ_FAILED");
    assert(!JSON.stringify(damaged).includes("PRIVATE_FIXTURE"));
    await post(); assert.equal((await get()).diagnostic, null);
    for (const code of ["BRIDGE_TIMEOUT", "PORT_IN_USE", "INVALID_SCHEMA", "CACHE_WRITE_FAILED"]) {
      const d = diagnoseError(codedError(code, { stage: "bridge_push", timeoutMs: 3000, port: 32101, httpStatus: 500, message: "PRIVATE_FIXTURE" }));
      const clean = sanitizeState({ status: "error", diagnostic: d });
      const report = diagnosticReport(clean.diagnostic);
      assert(report.includes(code)); assert(report.includes("3 秒")); assert(!JSON.stringify(clean).includes("PRIVATE_FIXTURE"));
    }
    console.log("Passed: bridge serialization/isolation/recovery, strict protocol, token/origin/method/body/timeout checks, atomic recovery, phone UI and timezone, frozen source restart, and safe diagnostics.");
  } finally {
    if (browser) await browser.close(); if (service) await service.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
