const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { createCompanion } = require("../companion/server");
const { state, sw, now } = require("./time-test");
const { sanitizeState } = globalThis.__slaiState;
const { codedError, diagnoseError, diagnosticReport } = globalThis.__slaiErrors;
const waitForText = (page, id, text) => page.waitForFunction(({ id, text }) => document.getElementById(id).textContent.includes(text), { id, text });
const rememberedKey = "slaiRememberedViewToken";
async function browserTests(engine, service) {
  const browser = await engine.launch({ headless: true, ...(engine === chromium && process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const origin = `http://127.0.0.1:${service.readPort}`;
  const link = `${origin}/#token=${service.config.viewToken}`;
  const errors = [], requests = [], foreign = [];
  async function newContext() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: "America/Los_Angeles" });
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    await context.route("**/*", route => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) { foreign.push(request.method()); return route.abort(); }
      requests.push({ method: request.method(), path: new URL(request.url()).pathname });
      return route.continue();
    });
    return context;
  }
  try {
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(link);
    await waitForText(page, "accessMessage", "已取得查看权限");
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(await page.evaluate(() => scrollY), 0, "Initial history rendering must keep the top refresh button in view");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), rememberedKey), null, "Persistence requires opt-in");
    await page.reload();
    await waitForText(page, "accessMessage", "已取得查看权限");
    const tab = await context.newPage();
    await tab.goto(origin);
    await waitForText(tab, "connectionReport", "VIEW_TOKEN_MISSING");
    assert.equal(await tab.locator("#statusText").innerText(), "暂无可靠数据");
    assert.doesNotMatch(await tab.locator("#connectionReport").innerText(), /HTTP 状态/);
    const refreshBox = await tab.locator("#refreshView").boundingBox();
    assert(refreshBox.y >= 0 && refreshBox.y + refreshBox.height < 120, "Refresh is visible at the top");
    assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // No Clipboard API is the normal case on an iPhone's LAN HTTP page.
    await tab.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
    await tab.locator("#copyConnection").click();
    const manual = tab.getByRole("textbox", { name: "可手动复制的报告" });
    const captured = await manual.inputValue();
    assert.match(captured, /VIEW_TOKEN_MISSING/);
    await tab.waitForTimeout(1200); // The old one-second render destroyed selection and the copy hint.
    assert.equal(await manual.inputValue(), captured);
    assert.equal(await manual.evaluate(el => el.selectionEnd - el.selectionStart), captured.length);
    assert.match(await tab.locator("#connectionCopyStatus").innerText(), /手动复制/);
    assert.doesNotMatch(await tab.locator("#connectionCopyStatus").innerText(), /已复制/);
    await tab.evaluate(() => fetchState());
    assert.equal(await manual.inputValue(), captured, "Polling must not change the manual-copy snapshot");
    assert.equal(await manual.evaluate(el => el.selectionEnd - el.selectionStart), captured.length);
    assert.equal(await manual.evaluate(el => getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect), "text");
    await tab.getByRole("button", { name: "关闭手动复制" }).click();

    await tab.locator("#viewLink").fill("PRIVATE_FIXTURE");
    await tab.locator("#connectView").click();
    await waitForText(tab, "connectionReport", "VIEW_LINK_INVALID");
    assert.equal(await tab.locator("#viewLink").inputValue(), "");
    await tab.locator("#viewLink").fill("https://example.invalid/#token=" + service.config.viewToken);
    await tab.locator("#connectView").click();
    await waitForText(tab, "connectionReport", "VIEW_LINK_ORIGIN");
    assert.deepEqual(foreign, []);
    assert(!(await tab.locator("body").innerText()).includes(service.config.viewToken));
    await tab.locator("#rememberView").check();
    await tab.locator("#viewLink").fill(`${origin}/#token=${"x".repeat(43)}`);
    await tab.locator("#connectView").click();
    await waitForText(tab, "connectionReport", "VIEW_TOKEN_REJECTED");
    assert.match(await tab.locator("#connectionReport").innerText(), /HTTP 状态：401/);
    assert.equal(await tab.evaluate(key => localStorage.getItem(key), rememberedKey), null, "Rejected keys must not be persisted");
    assert.equal(await tab.evaluate(() => sessionStorage.getItem("viewToken")), null);
    await tab.locator("#viewLink").fill(link);
    await tab.locator("#connectView").click();
    await waitForText(tab, "accessMessage", "已取得查看权限");
    assert.equal(await tab.evaluate(({ key, token }) => localStorage.getItem(key) === token, { key: rememberedKey, token: service.config.viewToken }), true);
    assert.doesNotMatch(await tab.locator("#connectionReport").innerText(), /VIEW_TOKEN_|VIEW_LINK_/);
    assert.equal(await tab.locator("#viewLink").inputValue(), "");
    await tab.close();
    const reopened = await context.newPage();
    await reopened.goto(origin);
    await waitForText(reopened, "accessMessage", "已取得查看权限");
    await reopened.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitForText(reopened, "viewerRefreshStatus", "已读取电脑结果");

    // The top button coalesces requests, shows progress, and only reads the local cache.
    let release, seen;
    const blocked = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { seen = resolve; });
    let count = 0;
    await reopened.route("**/api/state", async route => { count++; seen(); await blocked; await route.continue(); });
    await reopened.locator("#refreshView").click();
    await started;
    assert.equal(await reopened.locator("#refreshView").isDisabled(), true);
    assert.equal(await reopened.locator("#reconnect").isDisabled(), true);
    assert.match(await reopened.locator("#viewerRefreshStatus").innerText(), /正在读取/);
    const coalesced = reopened.evaluate(() => fetchState());
    release(); await coalesced;
    await waitForText(reopened, "viewerRefreshStatus", "已读取电脑结果");
    assert.equal(count, 1);
    await reopened.unroute("**/api/state");

    // A response that began before logout must not restore access or attendance.
    let releaseOld, seenOld;
    const oldBlocked = new Promise(resolve => { releaseOld = resolve; });
    const oldStarted = new Promise(resolve => { seenOld = resolve; });
    await reopened.route("**/api/state", async route => { seenOld(); await oldBlocked; await route.continue(); });
    await reopened.locator("#refreshView").click(); await oldStarted;
    await reopened.locator("#forgetView").click();
    releaseOld(); await reopened.evaluate(async () => { if (activeRequest) await activeRequest; });
    assert.equal(await reopened.locator("#todayDuration").innerText(), "--:--:--");
    assert.equal(await reopened.evaluate(key => localStorage.getItem(key), rememberedKey), null);
    assert.equal(await reopened.evaluate(() => sessionStorage.getItem("viewToken")), null);
    await reopened.unroute("**/api/state");
    await reopened.reload(); await waitForText(reopened, "connectionReport", "VIEW_TOKEN_MISSING");
    // Reopening a full link in the same page may only change the fragment.
    await reopened.evaluate(value => { location.hash = new URL(value).hash; }, link);
    await waitForText(reopened, "accessMessage", "已取得查看权限");
    assert.equal(new URL(reopened.url()).hash, "");
    await context.close();

    const deniedContext = await newContext();
    await deniedContext.addInitScript(() => {
      window.blockStorage = true;
      for (const method of ["getItem", "setItem", "removeItem"]) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (...args) {
          if (window.blockStorage) throw new DOMException("PRIVATE_FIXTURE token account session", "SecurityError");
          return original.apply(this, args);
        };
      }
    });
    const denied = await deniedContext.newPage();
    await denied.goto(link);
    await waitForText(denied, "accessMessage", "已取得查看权限");
    await waitForText(denied, "connectionReport", "VIEW_STORAGE_UNAVAILABLE");
    const report = await denied.locator("#connectionReport").innerText();
    assert.match(report, /读取或保存查看权限/); assert.match(report, /SecurityError/);
    assert(!report.includes(service.config.viewToken)); assert(!report.includes("PRIVATE_FIXTURE"));
    assert.equal(new URL(denied.url()).hash, "");
    await denied.evaluate(() => { window.blockStorage = false; });
    await denied.locator("#refreshView").click();
    await denied.waitForFunction(() => !document.querySelector("#connectionReport").textContent.includes("VIEW_STORAGE_UNAVAILABLE"));
    // Validation must still run if reading/writing storage throws.
    const malformed = await deniedContext.newPage();
    const before = requests.filter(r => r.path === "/api/state").length;
    await malformed.goto(`${origin}/#token=PRIVATE_FIXTURE`);
    await waitForText(malformed, "connectionReport", "VIEW_LINK_INVALID");
    assert.equal(requests.filter(r => r.path === "/api/state").length, before);
    assert.doesNotMatch(await malformed.locator("body").innerText(), /PRIVATE_FIXTURE/);
    await deniedContext.close();
    assert.deepEqual(foreign, []);
    assert(requests.every(request => request.method === "GET"), "The phone must never write state or trigger collection");
    assert.deepEqual(errors, []);
    console.log(`Passed (${engine.name()}): tab reload/reopen, opt-in persistence, same-page link recovery, missing/rejected/foreign/malformed links, blocked storage/recovery/privacy, HTTP manual-copy selection across refresh, top refresh coalescing, logout race and read-only requests.`);
  } finally { await browser.close(); }
}
async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slai-viewer-test-"));
  let service;
  try {
    service = await createCompanion({ dir, readPort: 0, writePort: 0, now: () => now });
    const response = await fetch(`http://127.0.0.1:${service.writePort}/api/state`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + service.config.writeToken }, body: JSON.stringify({ schemaVersion: 1, state: state([sw("08:00", "进门")]) }) });
    assert.equal(response.status, 200);
    for (const code of ["VIEW_TOKEN_MISSING", "VIEW_TOKEN_REJECTED", "VIEW_LINK_INVALID", "VIEW_LINK_ORIGIN", "VIEW_STORAGE_UNAVAILABLE"]) {
      const error = codedError(code, { httpStatus: 401, token: "PRIVATE_FIXTURE", url: "PRIVATE_FIXTURE", message: "PRIVATE_FIXTURE" }, new DOMException("PRIVATE_FIXTURE", "SecurityError"));
      const clean = sanitizeState({ status: "error", diagnostic: diagnoseError(error, { stage: "viewer_access", operation: "storage_set" }) });
      const report = diagnosticReport(clean.diagnostic);
      assert(report.includes(code)); assert.match(report, /HTTP 状态：401/); assert.match(report, /读取或保存查看权限/);
      assert.match(report, /SecurityError/); assert(!JSON.stringify(clean).includes("PRIVATE_FIXTURE"));
    }
    for (const engine of [chromium, ...(process.platform === "darwin" ? [webkit] : [])]) {
      await browserTests(engine, service);
      // A real process restart, with an isolated synthetic profile, exercises
      // the iPhone failure mode beyond simply reloading or creating a tab.
      const profile = path.join(dir, engine.name() + "-profile");
      const launch = () => engine.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, ...(engine === chromium && process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
      let context = await launch();
      try {
        let page = await context.newPage();
        await page.goto(`http://127.0.0.1:${service.readPort}/#token=${service.config.viewToken}`);
        await waitForText(page, "accessMessage", "已取得查看权限");
        await page.locator("#rememberView").check();
        await context.close(); context = await launch();
        page = await context.newPage();
        await page.goto(`http://127.0.0.1:${service.readPort}/`);
        await waitForText(page, "accessMessage", "已取得查看权限");
        assert.equal(await page.locator("#rememberView").isChecked(), true);
        console.log(`Passed (${engine.name()}): remembered view permission survives a full browser process restart with a temporary synthetic profile.`);
      } finally { await context.close(); }
    }
  } finally { if (service) await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
