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
  schemaVersion: 5,
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
  assert.equal(attendanceSeconds(fixtureState, new Date("2030-04-09T00:00:00+08:00").getTime()).seconds, 10800, "Stale same-attendance-day snapshot stays frozen across midnight");
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
  const invalidFacts = sanitizeState({ status: 'partial', diagnostic: { code: 'SWIPE_TIMEOUT',
    queryDate: '2030-04-09 PRIVATE_FIXTURE', filterStartDate: '2030-02-30', filterEndDate: 'PRIVATE_FIXTURE', tableState: 'PRIVATE_FIXTURE', pageRowCount: '000000000'
  } }).diagnostic;
  for (const key of ['queryDate', 'filterStartDate', 'filterEndDate', 'tableState', 'pageRowCount']) assert.equal(invalidFacts[key], undefined);
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
    let swipeMode = 'normal';
    const swipeRequests = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "https://stu.slai.edu.cn" && url.pathname === "/a/edu/acm/swipe/list") {
        // Keep the old table visible briefly after the page indicator advances.
        await new Promise(resolve => setTimeout(resolve, 300));
        const number = Number(url.searchParams.get('pageNo'));
        const size = Number(url.searchParams.get('pageSize') || 10);
        swipeRequests.push({ number, size });
        await route.fulfill({ json: swipeData(number, swipeMode, size) });
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
    await page.setContent(`<table>
      <tr><td>2楼-闸机-测试3-出_门禁通道_1</td><td>出门</td><td>${day} 10:00:00</td></tr>
      <tr><td>2楼-普通门禁-测试3</td><td>进门</td><td>${day} 09:00:00</td></tr>
      <tr><td>宿舍-闸机-测试1</td><td>进门</td><td>${day} 08:00:00</td></tr>
    </table><div>共3条</div>`);
    assert.deepEqual((await page.evaluate(() => __slaiAttendance.extractSwipePage())).records, [
      { direction: "出门", timestamp: `${day} 10:00:00` }
    ], "A campus gate may contain prefixes and suffixes, while ordinary access controls and dormitory gates stay excluded");
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
    vm.runInContext(fs.readFileSync(path.join(extension, 'collection.js'), 'utf8'), paginationContext);
    vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), paginationContext);
    paginationContext.runReader = async (_id, method) => page.evaluate((name) => globalThis.__slaiAttendance[name](), method);
    const threeVisits = await vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext);
    assert.equal(threeVisits.length, 6);
    assert.equal(attendanceSeconds({ schemaVersion: 5, status: "ok", updatedAt: "2030-04-08T04:00:00.000Z", days: [], todaySwipes: threeVisits }, instant('12:00:00')).seconds, 10800);
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
    assert.equal(attendanceSeconds({ schemaVersion: 5, status: "ok", updatedAt: "2030-04-08T04:00:00.000Z", days: [], todaySwipes: layuiVisits }, instant('12:00:00')).seconds, 10800);
    const lastPage = await page.evaluate(() => __slaiAttendance.extractSwipePage());
    assert.equal(lastPage.pagination.current, 3, "Read Layui's current page when hidden fields are blank");
    assert.equal(lastPage.pagination.hasNext, false, "Layui's disabled next button must stop collection");
    assert.equal(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), false);
    for (const emptyOptions of [{ emptyCount: true }, { emptyCount: false }, { emptyCount: false, emptyLabel: '', emptyPager: false }]) {
      await page.setContent(swipeHtml(day, { mode: 'empty', ...emptyOptions, pageSizeControl: true }));
      const empty = await page.evaluate(() => __slaiAttendance.extractSwipePage());
      assert.equal(empty.ready, true);
      assert.equal(empty.pagination.total, 0);
      assert.equal(empty.pagination.hasNext, false, 'An empty result must ignore the inert next control');
      if (emptyOptions.emptyCount) {
        await page.evaluate(() => document.querySelector('.layui-none').remove());
        assert.equal((await page.evaluate(() => __slaiAttendance.extractSwipePage())).ready, true, 'An explicit zero total is sufficient without the empty label');
      }
      assert.equal(await page.evaluate(() => __slaiAttendance.setSwipePageSize()), false, 'Empty results need no size-change request');
      assert.equal(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), false);
      assert.equal((await vm.runInContext("collectSwipePages(1, '2030-04-08', { pages: 1 })", paginationContext)).length, 0);
      await page.evaluate(() => document.querySelector('.layui-table-init').style.display = 'block');
      assert.equal((await page.evaluate(() => __slaiAttendance.extractSwipePage())).ready, false, 'A stale empty marker under loading is not complete');
    }
    await page.setContent(swipeHtml(day, { mode: 'empty', emptyCount: false, emptyLabel: '' }));
    await page.evaluate(() => document.querySelector('.layui-table-page').remove());
    assert.equal((await page.evaluate(() => __slaiAttendance.extractSwipePage())).ready, true, 'Layui can omit the pager entirely for no data');
    await page.evaluate(() => document.querySelector('.layui-none').style.display = 'none');
    assert.equal((await page.evaluate(() => __slaiAttendance.extractSwipePage())).ready, false);
    await page.setContent('<div class="layui-table-main"><table></table></div><p>暂无数据</p>');
    assert.equal((await page.evaluate(() => __slaiAttendance.extractSwipePage())).ready, false, 'Unrelated empty text cannot certify the table');
    for (const html of [
      '<table></table><div class="layui-none"></div>',
      '<div class="layui-table-view"><div class="layui-table-main"><table></table></div><div class="layui-none"></div></div>',
      '<div class="layui-table-view"><div class="layui-table-main"><table></table><div class="layui-none">请求异常</div></div></div>'
    ]) {
      await page.setContent(html);
      assert.equal((await page.evaluate(() => __slaiAttendance.extractSwipePage())).ready, false, 'An unrelated or error marker must not certify no records');
    }
    await page.setContent('<div class="layui-table-main"><table></table><div class="layui-none">暂无数据</div></div><div>共5条</div>');
    await assert.rejects(vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext), error => {
      assert.equal(error.code, 'SWIPE_INCOMPLETE');
      assert.equal(error.details.rowsRead, 0); assert.equal(error.details.expectedTotal, 5);
      return true;
    });
    swipeMode = 'wide'; swipeRequests.length = 0;
    await page.setContent(swipeHtml(day, { mode: 'wide', pageSizeControl: true }));
    const wideBudget = { pages: 0 };
    paginationContext.wideBudget = wideBudget;
    const wideRecords = await vm.runInContext("collectSwipePages(1, '2030-04-08', wideBudget)", paginationContext);
    assert.equal(wideRecords.length, 6, 'All campus visits survive resizing and the 90-row boundary');
    assert.equal(wideRecords[0].timestamp, day + ' 06:00:00');
    assert.deepEqual(swipeRequests, [{ number: 1, size: 90 }, { number: 2, size: 90 }]);
    assert.equal(wideBudget.pages, 3, 'The initial size-change request counts toward the shared request budget');
    assert.equal(await page.locator('.layui-laypage-limits select').inputValue(), '90');
    swipeRequests.length = 0;
    await page.setContent(swipeHtml(day, { mode: 'wide', pageSizeControl: true }));
    await assert.rejects(vm.runInContext("collectSwipePages(1, '2030-04-08', { pages: 49 })", paginationContext), error => error.code === 'SWIPE_LIMIT');
    assert.deepEqual(swipeRequests, [], 'Do not issue request 51 just to resize the last allowed page');
    swipeMode = 'normal'; swipeRequests.length = 0;
    await page.setContent(swipeHtml(day, { pageSizeControl: true }));
    assert.equal((await vm.runInContext("collectSwipePages(1, '2030-04-08')", paginationContext)).length, 6);
    assert.deepEqual(swipeRequests, [{ number: 1, size: 90 }], 'Fewer than 90 rows finish on the resized first page');
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
    let timeoutDiagnostic;
    paginationContext.runReader = async () => ({ ready: false, pagination: { current: 1, rowCount: 0 }, observation: {
      tableState: 'unrecognized', filterStartDate: '2030-04-09', filterEndDate: '2030-04-09', rawHtml: 'PRIVATE_FIXTURE'
    } });
    await assert.rejects(vm.runInContext("collectSwipePages(1, '2030-04-09', { pages: 3 })", paginationContext), error => {
      const diagnostic = diagnoseError(error);
      assert.equal(diagnostic.page, 1, 'The second civil date still starts at page 1');
      assert.equal(diagnostic.currentPage, 1);
      timeoutDiagnostic = sanitizeState({ status: 'partial', diagnostic }).diagnostic;
      assert.equal(timeoutDiagnostic.queryDate, '2030-04-09');
      assert.equal(timeoutDiagnostic.filterStartDate, '2030-04-09');
      assert.equal(timeoutDiagnostic.filterEndDate, '2030-04-09');
      assert.equal(timeoutDiagnostic.tableState, 'unrecognized');
      assert.equal(timeoutDiagnostic.pageRowCount, 0);
      assert.match(diagnosticReport(timeoutDiagnostic), /第 1 页明细加载超时/);
      assert(!JSON.stringify(timeoutDiagnostic).includes('PRIVATE_FIXTURE'));
      return true;
    });
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
    assert.deepEqual(await ui.evaluate(() => window.messages), ["get-state"], "Local ticks must not issue server requests");
    await ui.evaluate(() => {
      window.fixtureState.todaySwipes.push({ timestamp: "2030-04-08 10:00:00", direction: "出门" });
      window.fixtureState.lastCompleteToday.swipes = [...window.fixtureState.todaySwipes];
    });
    await ui.locator("#refresh").click();
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:00");
    await ui.clock.runFor(2000);
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:00");
    assert.match(await ui.locator("#statusText").innerText(), /已离校/);
    await ui.evaluate(() => {
      const badge = document.createElement("p");
      badge.textContent = "演示数据 · 非真实考勤";
      badge.style.cssText = "color:#d86b9f;font-size:12px;text-align:center;margin:8px 0";
      document.querySelector(".shell").prepend(badge);
    });
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await ui.screenshot({ path: path.join(root, "test-results", "demo.png"), fullPage: true });
    await ui.evaluate(() => window.deliverState({ type: "attendance-state", state: { status: "auth", message: "请登录学校系统", days: [], nextRefreshAt: null } }));
    assert.equal(await ui.locator("#authCard").isVisible(), true);
    assert.match(await ui.locator("#nextRefresh").textContent(), /自动刷新已暂停/);
    await ui.evaluate((state) => window.deliverState({ type: "attendance-state", state }), sanitizeState({
      ...sanitizeState(fixtureState), status: "partial", diagnostic: {
        code: "SWIPE_TIMEOUT", stage: "read_swipes", page: 2, currentPage: 1, rowsRead: 10, expectedTotal: 23, timeoutMs: 15000,
        occurredAt: "2030-04-08T02:10:00.000Z", message: "PRIVATE_FIXTURE", sourceUrl: "https://example.invalid/PRIVATE_FIXTURE"
      }, summaryUpdatedAt: "2030-04-08T02:10:00.000Z"
    }));
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:00");
    assert.equal(await ui.locator(".day-row").count(), 30);
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
    await ui.evaluate(() => { window.failCopy = false; });
    await ui.evaluate(diagnostic => window.deliverState({ type: 'attendance-state', state: { ...window.fixtureState, status: 'partial', diagnostic } }), timeoutDiagnostic);
    await ui.locator('#copyDiagnostic').click();
    const queryReport = await ui.evaluate(() => window.copiedReport);
    assert.match(queryReport, /正在查询：2030-04-09/);
    assert.match(queryReport, /页面开始日期：2030-04-09/);
    assert.match(queryReport, /页面结束日期：2030-04-09/);
    assert.match(queryReport, /存在表格，但未识别到明细行或有效空表标记/);
    assert.match(queryReport, /当前页已识别：0 条/);
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
    assert.deepEqual(unexpected, [], "No unexpected network requests during tests");
    console.log("Passed: 23-row pagination, summary fallback, direct error causes and context, privacy, clipboard success/fallback, background disconnect/recovery, pending navigation, scheduling, auth pause and live UI.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
