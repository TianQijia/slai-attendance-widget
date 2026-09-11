const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { unzipSync } = require("fflate");
const { chromium } = require("playwright");
const { swipeData, swipeHtml } = require("./swipe-fixture");
const root = path.resolve(__dirname, "..");

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "slai-install-test-"));
  const extension = path.join(temporary, "extension");
  fs.mkdirSync(extension);
  const data = unzipSync(fs.readFileSync(path.join(root, "dist", `slai-attendance-widget-v${require("../package.json").version}.zip`)));
  assert.deepEqual(Object.keys(data).sort(), require("../release-files.json").archive.sort());
  for (const [name, bytes] of Object.entries(data)) {
    assert.equal(path.basename(name), name);
    fs.writeFileSync(path.join(extension, name), bytes);
  }
  let context;
  let mode = "auth";
  let testDate;
  const visitedPages = [];
  try {
    context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
      channel: "chromium", headless: true, timezoneId: "Asia/Shanghai",
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging",
        "--host-resolver-rules=MAP stu.slai.edu.cn 127.0.0.1, MAP sts.slai.edu.cn 127.0.0.1"]
    });
    await context.route("https://stu.slai.edu.cn/**", async route => {
      const url = new URL(route.request().url());
      if (mode === "auth") return route.fulfill({ status: 302, headers: { location: "https://sts.slai.edu.cn/signin" }, body: "" });
      if (url.pathname.endsWith("/swipe/attendList")) return route.fulfill({ contentType: "text/html; charset=utf-8", body:
        `<h1>月度考勤统计汇总（虚构测试）</h1><input value="${testDate.slice(0, 7)}"><p>学号: 000000000</p><table><tr><td>${testDate}</td><td>周一</td><td>工作日</td><td>02:00:00</td><td>否</td></tr></table>` });
      if (url.pathname.endsWith("/swipe/list")) {
        if (mode === "auth-on-swipes") return route.fulfill({ status: 302, headers: { location: "https://sts.slai.edu.cn/signin" }, body: "" });
        const number = Number(url.searchParams.get("pageNo") || 1);
        visitedPages.push(number);
        if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html; charset=utf-8", body: swipeHtml(testDate) });
        await new Promise(resolve => setTimeout(resolve, 300));
        if (mode === "timeout") return route.fulfill({ status: 503, body: "Simulated page failure" });
        return route.fulfill({ json: swipeData(number, mode) });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<a href="/a/edu/acm/swipe/attendList">学生考勤统计查询</a>' });
    });
    await context.route("https://sts.slai.edu.cn/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>模拟学校登录页</h1>" }));
    // Load after routing is installed, using the browser's extension test API.
    // https://chromedevtools.github.io/devtools-protocol/tot/Extensions/#method-loadUnpacked
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send("Extensions.loadUnpacked", { path: extension });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).hostname;
    await worker.evaluate(async () => {
      const deadline = Date.now() + 35000;
      while ((await getState()).status === "loading" && Date.now() < deadline) await delay(50);
      if (refreshPromise) await refreshPromise;
    });
    // Create the simulated login tab through Playwright so its initial navigation
    // is intercepted before Chrome starts a request from an extension-created tab.
    const loginPage = await context.newPage();
    await loginPage.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>模拟学校登录页</h1>" }));
    await loginPage.goto("https://sts.slai.edu.cn/signin");
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "https://sts.slai.edu.cn/signin" });
      await scrapeAttendance({ sourceTabId: tab.id });
    });
    const state = await worker.evaluate(async () => (await chrome.storage.local.get("attendanceState")).attendanceState);
    assert.equal(state.status, "auth");
    assert.equal(state.nextRefreshAt, null);
    assert(!("sourceUrl" in state) && !("studentNumber" in state));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/widget.html`);
    await page.locator("#authCard:not(.hidden)").waitFor();
    assert.match(await page.locator("#nextRefresh").innerText(), /自动刷新已暂停/);
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    assert.equal(version, require("../package.json").version);

    mode = "normal";
    testDate = await worker.evaluate(() => localDateKey());
    await worker.evaluate(() => saveState({ status: "loading", days: [] }));
    const school = await context.newPage();
    const summaryUrl = "https://stu.slai.edu.cn/a/edu/acm/swipe/attendList";
    async function refreshFixture() {
      visitedPages.length = 0;
      await worker.evaluate(async () => saveState({ ...await getState(), status: "loading" }));
      await school.goto(summaryUrl);
      return worker.evaluate(async url => {
        const [tab] = await chrome.tabs.query({ url });
        await scrapeAttendance({ sourceTabId: tab.id });
        return getState();
      }, summaryUrl);
    }
    const complete = await refreshFixture();
    assert.equal(complete.status, "ok");
    assert.equal(complete.todaySwipes.length, 6);
    assert.deepEqual(visitedPages, [1, 2, 3], "The installed extension must click Layui controls through its isolated reader");
    await page.waitForFunction(() => document.querySelector("#todayDuration").textContent === "03:00:00");

    mode = "timeout";
    const partial = await refreshFixture();
    assert.equal(partial.status, "partial");
    assert.equal(partial.errorCode, "SWIPE_TIMEOUT");
    assert.equal(partial.diagnostic.stage, "read_swipes");
    assert.equal(partial.diagnostic.page, 2);
    assert.equal(partial.diagnostic.rowsRead, 10);
    assert.equal(partial.diagnostic.expectedTotal, 23);
    assert.equal(partial.diagnostic.timeoutMs, 15000);
    assert.equal(partial.updatedAt, complete.updatedAt);
    assert.equal(partial.days.length, 1);
    assert.deepEqual(partial.todaySwipes, []);
    assert.deepEqual(visitedPages, [1, 2]);
    await page.waitForFunction(() => document.querySelector("#statusText").textContent.includes("学校汇总"));
    assert.equal(await page.locator("#todayDuration").innerText(), "02:00:00");
    assert.match(await page.locator("#updatedAt").innerText(), /汇总更新于/);
    await page.locator("#diagnosticDetails summary").click();
    assert.match(await page.locator("#diagnosticReport").innerText(), /目标页：第 2 页/);
    assert.match(await page.locator("#diagnosticReport").innerText(), /预期总数：23 条/);
    assert.match(await page.locator("#diagnosticReport").innerText(), /等待上限：15 秒/);
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 1);

    mode = "changed";
    const changed = await refreshFixture();
    assert.equal(changed.status, "partial");
    assert.equal(changed.errorCode, "SWIPE_CHANGED");
    assert.equal(changed.diagnostic.expectedTotal, 23);
    assert.equal(changed.diagnostic.actualTotal, 24);
    assert.match(changed.message, /23 条变为 24 条/);
    assert.deepEqual(changed.todaySwipes, []);
    assert.deepEqual(visitedPages, [1, 2]);

    mode = "auth-on-swipes";
    const expired = await refreshFixture();
    assert.equal(expired.status, "auth");
    assert.equal(expired.errorCode, "AUTH_EXPIRED", "Login redirects must not be mislabeled as page timeouts");
    assert.equal(expired.nextRefreshAt, null);

    mode = "normal";
    const recovered = await refreshFixture();
    assert.equal(recovered.status, "ok");
    assert.equal(recovered.errorCode, "");
    assert.equal(recovered.diagnostic, null);
    assert.equal(recovered.todaySwipes.length, 6);
    assert.deepEqual(visitedPages, [1, 2, 3]);
    assert(!JSON.stringify(recovered).includes("000000000"));
    await page.locator("#diagnosticCard").waitFor({ state: "hidden" });
    console.log("ZIP installation passed: real extension scripting, 23-row Layui pagination, detailed timeout/count diagnostics through storage and UI, login redirects, recovery and auth pause. All school responses were simulated.");
  } finally {
    if (context) await context.close();
    // Only remove this test's verified, freshly-created temporary directory.
    assert(path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("slai-install-test-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
