const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { swipeData, swipeHtml } = require("./swipe-fixture");
process.env.TZ = "Asia/Shanghai";
const root = path.resolve(__dirname, "..");
const extension = path.join(root, "extension");
require(path.join(extension, "time-utils.js"));
require(path.join(extension, "error-utils.js"));
require(path.join(extension, "state-utils.js"));
const { attendanceSeconds } = globalThis.__slaiTime;
const { sanitizeState } = globalThis.__slaiState;
const { diagnoseError, diagnosticReport } = globalThis.__slaiErrors;
const day = "2030-04-08";
const instant = (clock) => new Date(`${day}T${clock}+08:00`).getTime();
const swipe = (clock, direction) => ({ timestamp: `${day} ${clock}`, direction });
const fixtureState = {
  status: "ok", month: "2030-04", requiredSeconds: 21600,
  days: [
    { date: "2030-04-07", weekday: "周日", type: "休息日", duration: "01:00:00" },
    { date: day, weekday: "周一", type: "工作日", duration: "02:00:00" }
  ],
  todaySwipes: [swipe("06:00:00", "进门"), swipe("08:00:00", "出门"), swipe("09:00:00", "进门")],
  updatedAt: "2030-04-08T02:00:00.000Z", nextRefreshAt: "2030-04-08T02:30:00.000Z"
};

function testTimeAndPrivacy() {
  const start = attendanceSeconds(fixtureState, instant("10:00:00"));
  assert.equal(start.seconds, 10800, "2h on campus + 1h away + 1h on campus = 3h");
  assert.equal(start.onCampus, true);
  assert.equal(attendanceSeconds(fixtureState, instant("10:00:01")).seconds, 10801);
  const exited = { ...fixtureState, todaySwipes: [...fixtureState.todaySwipes, swipe("10:00:00", "出门")] };
  assert.equal(attendanceSeconds(exited, instant("12:00:00")).seconds, 10800);
  assert.equal(attendanceSeconds(exited, instant("12:00:00")).onCampus, false);
  const duplicate = { ...fixtureState, todaySwipes: [swipe("05:00:00", "出门"), swipe("06:00:00", "进门"), swipe("06:00:00", "进门"), swipe("08:00:00", "出门")] };
  assert.equal(attendanceSeconds(duplicate, instant("10:00:00")).seconds, 7200);
  assert.equal(attendanceSeconds(fixtureState, new Date("2030-04-09T00:00:00+08:00").getTime()).seconds, 0);
  const dirty = {
    ...fixtureState, studentNumber: "000000000", studentName: "DEMO_ONLY",
    sourceUrl: "https://example.invalid/private", message: "PRIVATE_FIXTURE", errorCode: "PRIVATE_FIXTURE",
    days: [{ ...fixtureState.days[1], extra: "PRIVATE_FIXTURE" }],
    todaySwipes: [{ ...swipe("06:00:00", "进门"), channel: "PRIVATE_FIXTURE" }]
  };
  const clean = sanitizeState(dirty);
  assert(!JSON.stringify(clean).includes("PRIVATE_FIXTURE"));
  assert(!("studentNumber" in clean) && !("sourceUrl" in clean));
  assert.equal(clean.requiredSeconds, 21600);
  assert.deepEqual(sanitizeState({ days: [null], todaySwipes: [null] }).days, []);
  const partial = sanitizeState({ ...fixtureState, status: "partial", errorCode: "SWIPE_TIMEOUT" });
  assert.deepEqual(partial.todaySwipes, []);
  assert.match(partial.message, /超时.*学校汇总/);
  assert.equal(attendanceSeconds({ ...sanitizeState(fixtureState), status: "partial" }, instant("12:00:00")).seconds, 10800);
  const diagnostic = diagnoseError(Object.assign(new TypeError("PRIVATE_FIXTURE https://example.invalid/session"), {
    code: "SWIPE_INCOMPLETE", details: { stage: "read_swipes", page: 2, rowsRead: 10, expectedTotal: 23,
      sourceUrl: "PRIVATE_FIXTURE", studentNumber: "000000000", message: "PRIVATE_FIXTURE", readerMethod: "PRIVATE_FIXTURE" }
  }));
  const storedError = sanitizeState({ ...fixtureState, status: "partial", diagnostic });
  assert.match(storedError.message, /10 \/ 23 条/);
  assert.equal(storedError.diagnostic.page, 2);
  const report = diagnosticReport(storedError.diagnostic, { version: require("../package.json").version, status: "partial" });
  assert.match(report, /失败阶段：读取明细分页/);
  assert.match(report, /异常类型：TypeError/);
  assert.match(report, /错误代码：SWIPE_INCOMPLETE/);
  assert(!/PRIVATE_FIXTURE|example.invalid|000000000|sourceUrl/.test(report + JSON.stringify(storedError)));
  assert.equal(sanitizeState({ ...storedError, status: "ok" }).diagnostic, null, "Success removes old diagnostics");
  const unknown = diagnoseError(new TypeError("PRIVATE_FIXTURE"), { stage: "find_attendance" });
  assert.match(diagnosticReport(unknown), /直接原因尚未识别/);
  assert.equal(unknown.stage, "find_attendance");
  assert.equal(unknown.errorName, "TypeError");
}

async function testBackground() {
  const callbacks = {};
  const alarms = [];
  const removed = [];
  let createdTabs = 0;
  let fail = false;
  const storage = { oldSession: "PRIVATE_FIXTURE", attendanceState: { ...fixtureState, sourceUrl: "PRIVATE_FIXTURE" }, widgetWindowId: 7 };
  const event = (name) => ({ addListener: (fn) => { callbacks[name] = fn; }, removeListener: () => {} });
  const context = vm.createContext({
    console, URL, Date, setTimeout, clearTimeout,
    chrome: {
      storage: { local: {
        get: async (key) => key === null ? structuredClone(storage) : { [key]: structuredClone(storage[key]) },
        set: async (values) => Object.assign(storage, structuredClone(values)),
        remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
        setAccessLevel: async (value) => assert.equal(value.accessLevel, "TRUSTED_CONTEXTS")
      } },
      runtime: { id: "fixture-extension", getURL: (file) => `chrome-extension://fixture-extension/${file}`, sendMessage: async () => {}, onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message") },
      alarms: { create: async (name, options) => alarms.push({ name, ...options }), clear: async (name) => removed.push(name), onAlarm: event("alarm") },
      tabs: {
        create: async () => { createdTabs++; if (fail) throw new Error("PRIVATE_FIXTURE"); return { id: 8, status: "complete", url: "https://sts.slai.edu.cn/signin" }; },
        get: async () => ({ id: 8, status: "complete", url: "https://sts.slai.edu.cn/signin" }),
        remove: async () => {}, onUpdated: event("tabUpdated"), onRemoved: event("tabRemoved")
      },
      action: { onClicked: event("clicked") }, windows: { onRemoved: event("windowRemoved") }
    }
  });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(extension, name), "utf8"), context));
  vm.runInContext(fs.readFileSync(path.join(extension, "background.js"), "utf8"), context);
  const originalReader = context.runReader;
  const originalGetTab = context.chrome.tabs.get;
  context.chrome.tabs.get = async () => ({ id: 8, status: "complete", url: "about:blank", pendingUrl: "https://stu.slai.edu.cn/" });
  let navigationSettled = false;
  const navigation = vm.runInContext("waitForTab(8)", context).then(tab => { navigationSettled = true; return tab; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(navigationSettled, false, "A new tab's pending navigation must not be classified as an unexpected redirect");
  callbacks.tabUpdated(8, { status: "complete" }, { id: 8, status: "complete", url: "https://stu.slai.edu.cn/" });
  assert.equal((await navigation).url, "https://stu.slai.edu.cn/");
  context.chrome.tabs.get = originalGetTab;
  await vm.runInContext("migrateStorage()", context);
  assert(!JSON.stringify(storage).includes("PRIVATE_FIXTURE"));
  await vm.runInContext("saveState({ status: 'ok' })", context);
  assert.equal(alarms.at(-1).delayInMinutes, 30);
  await vm.runInContext("refreshAttendance()", context);
  assert.equal(storage.attendanceState.status, "auth");
  assert.equal(storage.attendanceState.nextRefreshAt, null);
  assert.equal(storage.attendanceState.diagnostic.code, "AUTH_EXPIRED");
  assert.equal(removed.at(-1), "slai-attendance-refresh");
  const beforeAlarm = createdTabs;
  await callbacks.alarm({ name: "slai-attendance-refresh" });
  assert.equal(createdTabs, beforeAlarm, "Auth expiry pauses automatic requests");
  fail = true;
  await vm.runInContext("refreshAttendance()", context);
  assert.equal(storage.attendanceState.status, "error");
  assert(!JSON.stringify(storage).includes("PRIVATE_FIXTURE"));
  assert.equal(callbacks.message({ type: "refresh" }, { id: "fixture-extension", url: "https://stu.slai.edu.cn/" }, () => {}), false);

  // An error after the summary succeeds must leave a usable, clearly partial UI.
  let tabUrl = "https://stu.slai.edu.cn/a/edu/acm/swipe/attendList";
  context.chrome.tabs.get = async () => ({ id: 8, status: "complete", url: tabUrl });
  context.chrome.tabs.update = async (_id, update) => { tabUrl = update.url; };
  context.runReader = async (_id, method) => method === "findAttendanceUrl" ? "https://stu.slai.edu.cn/a/edu/acm/swipe/attendList" :
    { ready: true, month: fixtureState.month, days: fixtureState.days, studentNumber: "000000000" };
  const lastSuccess = fixtureState.updatedAt;
  storage.attendanceState = structuredClone(fixtureState);
  context.collectSwipePages = async () => { throw Object.assign(new Error("PRIVATE_FIXTURE"), { code: "SWIPE_INCOMPLETE" }); };
  await vm.runInContext("scrapeAttendance({ sourceTabId: 8 })", context);
  assert.equal(storage.attendanceState.status, "partial");
  assert.equal(storage.attendanceState.errorCode, "SWIPE_INCOMPLETE");
  assert.deepEqual(storage.attendanceState.days, sanitizeState(fixtureState).days);
  assert.deepEqual(storage.attendanceState.todaySwipes, []);
  assert.equal(storage.attendanceState.updatedAt, lastSuccess, "Partial reads do not advance the last full success timestamp");
  assert(storage.attendanceState.summaryUpdatedAt);
  assert.match(storage.attendanceState.message, /条数不齐.*学校汇总/);
  assert(!JSON.stringify(storage).includes("PRIVATE_FIXTURE"));
  assert.equal(alarms.at(-1).delayInMinutes, 30);
  context.collectSwipePages = async () => { throw Object.assign(new Error("PRIVATE_FIXTURE"), { code: "AUTH_EXPIRED" }); };
  await vm.runInContext("scrapeAttendance({ sourceTabId: 8 })", context);
  assert.equal(storage.attendanceState.status, "auth");
  assert.equal(storage.attendanceState.nextRefreshAt, null);

  context.runReader = async () => null;
  await vm.runInContext("scrapeAttendance({ sourceTabId: 8 })", context);
  assert.equal(storage.attendanceState.errorCode, "ATTENDANCE_LINK_MISSING");
  assert.equal(storage.attendanceState.diagnostic.stage, "find_attendance");
  assert.match(storage.attendanceState.message, /未找到.*考勤统计查询/);

  context.runReader = async (_id, method) => method === "findAttendanceUrl" ? "https://stu.slai.edu.cn/a/edu/acm/swipe/attendList" :
    { ready: true, month: fixtureState.month, days: fixtureState.days, studentNumber: "" };
  await vm.runInContext("scrapeAttendance({ sourceTabId: 8 })", context);
  assert.equal(storage.attendanceState.status, "partial");
  assert.equal(storage.attendanceState.errorCode, "STUDENT_NUMBER_MISSING", "Missing query identity cannot be reported as full success");

  context.runReader = async (_id, method) => method === "findAttendanceUrl" ? "https://stu.slai.edu.cn/a/edu/acm/swipe/attendList" :
    { ready: true, month: "2030-04", days: [], studentNumber: "000000000" };
  context.collectSwipePages = async () => [];
  await vm.runInContext("scrapeAttendance({ sourceTabId: 8 })", context);
  assert.equal(storage.attendanceState.status, "ok", "A loaded empty summary must still collect today's swipes");
  assert.deepEqual(storage.attendanceState.lastCompleteToday.swipes, []);
  assert.equal(storage.attendanceState.diagnostic, null);

  context.chrome.scripting = { executeScript: async () => { throw new Error("Cannot access contents of url https://example.invalid/PRIVATE_FIXTURE. Extension manifest must request permission"); } };
  await assert.rejects(originalReader(8, "extractSwipePage"), error => {
    const diagnostic = diagnoseError(error, { stage: "read_swipes" });
    assert.equal(diagnostic.code, "SCRIPT_PERMISSION");
    assert.equal(diagnostic.operation, "inject_reader");
    assert.equal(diagnostic.readerMethod, "extractSwipePage");
    assert(!JSON.stringify(diagnostic).includes("PRIVATE_FIXTURE"));
    return true;
  });
  context.chrome.storage.local.get = async () => { throw new Error("PRIVATE_FIXTURE"); };
  const reply = await new Promise(resolve => callbacks.message({ type: "get-state" },
    { id: "fixture-extension", url: "chrome-extension://fixture-extension/widget.html" }, resolve));
  assert.equal(reply.ok, false);
  assert.equal(reply.diagnostic.code, "STORAGE_READ_FAILED", "Storage failures must answer the UI instead of leaving it waiting");
  assert.equal(reply.diagnostic.stage, "read_cache");
  assert(!JSON.stringify(reply).includes("PRIVATE_FIXTURE"));
}

async function main() {
  testTimeAndPrivacy();
  await testBackground();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const context = await browser.newContext({ timezoneId: "Asia/Shanghai", viewport: { width: 410, height: 640 } });
    const unexpected = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "https://stu.slai.edu.cn" && url.pathname === "/a/edu/acm/swipe/list") {
        // Keep the old table visible briefly after the page indicator advances.
        await new Promise(resolve => setTimeout(resolve, 300));
        await route.fulfill({ json: swipeData(Number(url.searchParams.get("pageNo"))) });
      } else if (route.request().url().startsWith("https://stu.slai.edu.cn/")) {
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: route.request().url().includes("/sys/user/main") ? "<p>演示首页</p>" : '<iframe src="/a;JSESSIONID=test-session/sys/user/main"></iframe><a onclick="addTabs({url: \'/edu/acm/swipe/attendList\'})">学生考勤统计查询</a>' });
      } else if (route.request().url().startsWith("file:")) await route.continue();
      else { unexpected.push(route.request().url()); await route.abort(); }
    });
    const page = await context.newPage();
    await page.goto("https://stu.slai.edu.cn/");
    await page.addScriptTag({ path: path.join(extension, "page-reader.js") });
    assert.equal(await page.evaluate(() => __slaiAttendance.findAttendanceUrl()), "https://stu.slai.edu.cn/a;JSESSIONID=test-session/edu/acm/swipe/attendList");
    await page.setContent('<input value="2030-04"><p>学号: 000000000</p><table><tr><td>2030-04-08</td><td>周一</td><td>工作日</td><td>02:00:00</td><td>否</td></tr></table>');
    const attendance = await page.evaluate(() => __slaiAttendance.extractAttendance());
    assert.equal(attendance.studentNumber, "000000000");
    await page.setContent('<h1>月度考勤统计汇总</h1><input value="2030-04"><p>学号: 000000000</p><table><tr><td>暂无数据</td></tr></table>');
    const emptySummary = await page.evaluate(() => __slaiAttendance.extractAttendance());
    assert.equal(emptySummary.ready, true); assert.deepEqual(emptySummary.days, []);
    await page.evaluate(() => document.querySelector("table").setAttribute("aria-busy", "true"));
    assert.equal((await page.evaluate(() => __slaiAttendance.extractAttendance())).ready, false);
    await page.setContent('<input value="2030-04"><table></table>');
    assert.equal((await page.evaluate(() => __slaiAttendance.extractAttendance())).ready, false, "An unrecognized/loading table must not become an empty success");
    assert.equal(attendance.days[0].duration, "02:00:00");
    const rows = [
      ["宿舍_道闸出2", "出门", "05:30:00"], ["闸机-东1-入", "进门", "06:00:00"],
      ["宿舍_道闸入1", "进门", "07:00:00"], ["闸机-东1-出", "出门", "08:00:00"],
      ["宿舍_道闸出1", "出门", "08:30:00"], ["闸机-西1-入", "进门", "09:00:00"]
    ];
    await page.setContent(`<table>${rows.map(([gate, direction, time]) => `<tr><td>${gate}</td><td>${direction}</td><td>${day} ${time}</td></tr>`).join("")}</table><div>共6条</div>`);
    const parsed = await page.evaluate(() => __slaiAttendance.extractSwipePage());
    assert.equal(parsed.ready, true);
    assert.deepEqual(parsed.records, fixtureState.todaySwipes);
    await page.setContent('<table><tr><td>宿舍_道闸入1</td><td>进门</td><td>2030-04-08 09:00:00</td></tr></table><div>共1条</div>');
    assert.deepEqual((await page.evaluate(() => __slaiAttendance.extractSwipePage())).records, []);
    // Three visits, newest first; a dorm-only middle page must not end collection.
    await page.evaluate(() => {
      window.renderSwipeFixture = (number) => {
        const pages = [
          [['闸机-东', '出门', '11:00:00'], ['闸机-东', '进门', '10:00:00'], ['闸机-东', '出门', '09:00:00']],
          [['宿舍_道闸', '出门', '08:45:00']],
          [['闸机-东', '进门', '08:00:00'], ['闸机-东', '出门', '07:00:00'], ['闸机-东', '进门', '06:00:00']]
        ];
        document.body.innerHTML = `<table>${pages[number - 1].map(([gate, direction, time]) => `<tr><td>${gate}</td><td>${direction}</td><td>2030-04-08 ${time}</td></tr>`).join('')}</table><div>共7条</div><div class="pagination"><span class="active">${number}</span><li class="${number === 3 ? 'disabled' : ''}"><a href="#" onclick="renderSwipeFixture(${number + 1});return false">下一页</a></li></div>`;
      };
      renderSwipeFixture(1);
    });
    const listener = { addListener() {}, removeListener() {} };
    const paginationContext = vm.createContext({ URL, Date, setTimeout, clearTimeout,
      importScripts() {}, __slaiTime: globalThis.__slaiTime, __slaiState: { sanitizeState }, __slaiErrors: globalThis.__slaiErrors,
      chrome: { runtime: { onInstalled: listener, onStartup: listener, onMessage: listener },
        alarms: { onAlarm: listener }, action: { onClicked: listener }, windows: { onRemoved: listener },
        tabs: { onUpdated: listener, get: async () => ({ status: 'complete', url: 'https://stu.slai.edu.cn/a/edu/acm/swipe/list' }) } }
    });
    vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), paginationContext);
    paginationContext.runReader = async (_id, method) => page.evaluate((name) => globalThis.__slaiAttendance[name](), method);
    const threeVisits = await vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext);
    assert.equal(threeVisits.length, 6);
    assert.equal(attendanceSeconds({ status: "ok", updatedAt: "2030-04-08T04:00:00.000Z", days: [], todaySwipes: threeVisits }, instant('12:00:00')).seconds, 10800);
    await page.evaluate(() => { renderSwipeFixture(1); document.querySelector('.pagination').remove(); });
    await assert.rejects(vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext), error => {
      assert.equal(error.code, "SWIPE_INCOMPLETE");
      assert.equal(error.details.rowsRead, 3);
      assert.equal(error.details.expectedTotal, 7);
      assert.equal(error.details.page, 1);
      return true;
    });
    await page.evaluate(() => { renderSwipeFixture(1); document.querySelector('.pagination a').setAttribute('href', 'https://example.invalid/'); });
    assert.equal(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), false);
    await page.setContent(swipeHtml());
    const layui = await page.evaluate(() => __slaiAttendance.extractSwipePage());
    assert.equal(layui.pagination.hasNext, true, "Layui's icon-only next button must be recognized");
    assert.equal(layui.pagination.rowCount, 10, "Ignore the table's fixed-column copies");
    const layuiVisits = await vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext);
    assert.equal(layuiVisits.length, 6);
    assert.equal(attendanceSeconds({ status: "ok", updatedAt: "2030-04-08T04:00:00.000Z", days: [], todaySwipes: layuiVisits }, instant('12:00:00')).seconds, 10800);
    const lastPage = await page.evaluate(() => __slaiAttendance.extractSwipePage());
    assert.equal(lastPage.pagination.current, 3, "Read Layui's current page when hidden fields are blank");
    assert.equal(lastPage.pagination.hasNext, false, "Layui's disabled next button must stop collection");
    assert.equal(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), false);
    await page.close();

    let readerCalls = 0;
    paginationContext.runReader = async () => { readerCalls++; throw new Error("Cannot access contents of url https://example.invalid/PRIVATE_FIXTURE"); };
    await assert.rejects(vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext), error => {
      const diagnostic = diagnoseError(error);
      assert.equal(diagnostic.code, "SCRIPT_PERMISSION", "A permission failure must not become a timeout");
      assert.equal(diagnostic.page, 1);
      assert.equal(diagnostic.stage, "read_swipes");
      return true;
    });
    assert.equal(readerCalls, 1);
    let virtualNow = 0;
    paginationContext.Date = class extends Date { static now() { return virtualNow; } };
    paginationContext.delay = async ms => { virtualNow += ms; };
    paginationContext.runReader = async () => { throw new Error("Execution context was destroyed, PRIVATE_FIXTURE"); };
    await assert.rejects(vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext), error => {
      const diagnostic = diagnoseError(error);
      assert.equal(diagnostic.code, "SCRIPT_CONTEXT_LOST", "Repeated context loss retains its cause after retries");
      assert.equal(diagnostic.timeoutMs, 15000);
      assert(!JSON.stringify(diagnostic).includes("PRIVATE_FIXTURE"));
      return true;
    });

    const ui = await context.newPage();
    await ui.clock.install({ time: new Date("2030-04-08T10:00:00+08:00") });
    await ui.clock.pauseAt(new Date("2030-04-08T10:00:01+08:00"));
    await ui.addInitScript(({ state, version }) => {
      window.fixtureState = state;
      window.messages = [];
      window.chrome = { runtime: {
        getManifest: () => ({ version }),
        sendMessage: async (message) => {
          window.messages.push(message.type);
          if (window.failRequest) throw new Error("Could not establish connection. Receiving end does not exist. PRIVATE_FIXTURE");
          return { state: window.fixtureState };
        },
        onMessage: { addListener: (fn) => { (window.stateListeners ||= []).push(fn); window.deliverState = message => window.stateListeners.forEach(listener => listener(message)); } }
      } };
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => {
        if (window.failCopy) throw new Error("Simulated clipboard refusal");
        window.copiedReport = text;
      } } });
    }, { state: sanitizeState(fixtureState), version: require("../package.json").version });
    await ui.goto(pathToFileURL(path.join(extension, "widget.html")).href);
    await ui.waitForFunction(() => document.querySelector("#todayDuration").textContent === "03:00:01");
    await ui.clock.runFor(2000);
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:03");
    assert.deepEqual(await ui.evaluate(() => window.messages), ["get-state", "get-bridge"], "Local ticks must not issue server requests");
    await ui.evaluate(() => {
      window.fixtureState.todaySwipes.push({ timestamp: "2030-04-08 10:00:00", direction: "出门" });
      window.fixtureState.lastCompleteToday.swipes = [...window.fixtureState.todaySwipes];
    });
    await ui.locator("#refresh").click();
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:00");
    await ui.clock.runFor(2000);
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:00");
    assert.match(await ui.locator("#statusText").innerText(), /当前离校/);
    await ui.evaluate(() => {
      const badge = document.createElement("p");
      badge.textContent = "演示数据 · 非真实考勤";
      badge.style.cssText = "color:#72e4ad;font-size:12px;text-align:center;margin:8px 0";
      document.querySelector(".shell").prepend(badge);
    });
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    const screenshot = await ui.screenshot({ path: path.join(root, "test-results", "demo.png"), fullPage: true });
    if (process.env.UPDATE_DEMO === "1") {
      fs.mkdirSync(path.join(root, "docs"), { recursive: true });
      fs.writeFileSync(path.join(root, "docs", "demo.png"), screenshot);
    }
    await ui.evaluate(() => window.deliverState({ type: "attendance-state", state: { status: "auth", message: "请登录学校系统", days: [], nextRefreshAt: null } }));
    assert.equal(await ui.locator("#authCard").isVisible(), true);
    assert.match(await ui.locator("#nextRefresh").innerText(), /自动刷新已暂停/);
    await ui.evaluate((state) => window.deliverState({ type: "attendance-state", state }), sanitizeState({
      ...sanitizeState(fixtureState), status: "partial", diagnostic: {
        code: "SWIPE_TIMEOUT", stage: "read_swipes", page: 2, currentPage: 1, rowsRead: 10, expectedTotal: 23, timeoutMs: 15000,
        occurredAt: "2030-04-08T02:10:00.000Z", message: "PRIVATE_FIXTURE", sourceUrl: "https://example.invalid/PRIVATE_FIXTURE"
      }, summaryUpdatedAt: "2030-04-08T02:10:00.000Z"
    }));
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:00");
    assert.equal(await ui.locator(".day-row").count(), 2);
    assert.match(await ui.locator("#updatedAt").innerText(), /汇总更新于/);
    assert.match(await ui.locator("#statusText").innerText(), /超时.*学校汇总/);
    await ui.clock.runFor(2000);
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:00");
    assert.equal(await ui.locator("#diagnosticCard").isVisible(), true);
    await ui.locator("#copyDiagnostic").click();
    const copiedReport = await ui.evaluate(() => window.copiedReport);
    assert.match(copiedReport, /目标页：第 2 页/);
    assert.match(copiedReport, /已读取：10 条/);
    assert.match(copiedReport, /预期总数：23 条/);
    assert.match(copiedReport, /等待上限：15 秒/);
    assert(!copiedReport.includes("PRIVATE_FIXTURE"));
    assert.match(await ui.locator("#copyStatus").innerText(), /已复制/);
    await ui.evaluate(() => { window.failCopy = true; });
    await ui.locator("#copyDiagnostic").click();
    assert.match(await ui.locator("#copyStatus").innerText(), /手动复制/);
    const manualReport = ui.getByRole("textbox", { name: "可手动复制的报告" });
    assert.equal(await manualReport.inputValue(), copiedReport);
    assert.equal(await manualReport.evaluate(el => el.selectionEnd - el.selectionStart), copiedReport.length);
    await ui.getByRole("button", { name: "关闭手动复制" }).click();
    await ui.screenshot({ path: path.join(root, "test-results", "summary-fallback.png"), fullPage: true });
    await ui.evaluate(() => { window.failRequest = true; });
    await ui.locator("#refresh").click();
    assert.match(await ui.locator("#statusText").innerText(), /后台.*连接已断开/);
    await ui.locator("#diagnosticDetails summary").click();
    assert.match(await ui.locator("#diagnosticReport").innerText(), /WIDGET_DISCONNECTED/);
    assert.equal(await ui.locator("#refresh").isEnabled(), true);
    assert.doesNotMatch(await ui.locator("body").innerText(), /PRIVATE_FIXTURE/);
    await ui.evaluate(() => { window.failRequest = false; });
    await ui.locator("#refresh").click();
    assert.equal(await ui.locator("#diagnosticCard").isVisible(), false, "Recovery removes stale error details");
    await ui.evaluate(() => {
      window.failCopy = false;
      window.deliverState({ type: "bridge-state", diagnostic: { code: "BRIDGE_TIMEOUT", stage: "bridge_push", timeoutMs: 3000, token: "PRIVATE_FIXTURE" } });
    });
    await ui.locator("#bridgeSettings summary").click();
    assert.match(await ui.locator("#bridgeReport").innerText(), /BRIDGE_TIMEOUT/);
    await ui.locator("#copyBridge").click();
    const bridgeReport = await ui.evaluate(() => window.copiedReport);
    assert.match(bridgeReport, /3 秒/); assert(!bridgeReport.includes("PRIVATE_FIXTURE"));
    assert.match(await ui.locator("#bridgeStatus").innerText(), /已复制/);
    await ui.evaluate(() => { window.failCopy = true; });
    await ui.locator("#copyBridge").click();
    assert.equal(await ui.evaluate(() => window.getSelection().toString()), bridgeReport);
    await ui.evaluate(() => window.deliverState({ type: "bridge-state", diagnostic: null }));
    assert.equal(await ui.locator("#bridgeReport").innerText(), "");
    assert.deepEqual(unexpected, [], "No unexpected network requests during tests");
    console.log("Passed: 23-row pagination, summary fallback, direct error causes and context, privacy, clipboard success/fallback, background disconnect/recovery, pending navigation, scheduling, auth pause and live UI.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
