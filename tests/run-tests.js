const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
process.env.TZ = "Asia/Shanghai";
const root = path.resolve(__dirname, "..");
const extension = path.join(root, "extension");
require(path.join(extension, "time-utils.js"));
require(path.join(extension, "state-utils.js"));
const { attendanceSeconds } = globalThis.__slaiTime;
const { sanitizeState } = globalThis.__slaiState;
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
    sourceUrl: "https://example.invalid/private", message: "PRIVATE_FIXTURE",
    days: [{ ...fixtureState.days[1], extra: "PRIVATE_FIXTURE" }],
    todaySwipes: [{ ...swipe("06:00:00", "进门"), channel: "PRIVATE_FIXTURE" }]
  };
  const clean = sanitizeState(dirty);
  assert(!JSON.stringify(clean).includes("PRIVATE_FIXTURE"));
  assert(!("studentNumber" in clean) && !("sourceUrl" in clean));
  assert.equal(clean.requiredSeconds, 21600);
  assert.deepEqual(sanitizeState({ days: [null], todaySwipes: [null] }).days, []);
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
  context.importScripts = (name) => vm.runInContext(fs.readFileSync(path.join(extension, name), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(extension, "background.js"), "utf8"), context);
  await vm.runInContext("migrateStorage()", context);
  assert(!JSON.stringify(storage).includes("PRIVATE_FIXTURE"));
  await vm.runInContext("saveState({ status: 'ok' })", context);
  assert.equal(alarms.at(-1).delayInMinutes, 30);
  await vm.runInContext("refreshAttendance()", context);
  assert.equal(storage.attendanceState.status, "auth");
  assert.equal(storage.attendanceState.nextRefreshAt, null);
  assert.equal(removed.at(-1), "slai-attendance-refresh");
  const beforeAlarm = createdTabs;
  await callbacks.alarm({ name: "slai-attendance-refresh" });
  assert.equal(createdTabs, beforeAlarm, "Auth expiry pauses automatic requests");
  fail = true;
  await vm.runInContext("refreshAttendance()", context);
  assert.equal(storage.attendanceState.status, "error");
  assert(!JSON.stringify(storage).includes("PRIVATE_FIXTURE"));
  assert.equal(callbacks.message({ type: "refresh" }, { id: "fixture-extension", url: "https://stu.slai.edu.cn/" }, () => {}), false);
}

async function main() {
  testTimeAndPrivacy();
  await testBackground();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: "Asia/Shanghai", viewport: { width: 410, height: 640 } });
    const unexpected = [];
    await context.route("**/*", async (route) => {
      if (route.request().url().startsWith("https://stu.slai.edu.cn/")) {
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
    assert.deepEqual(await page.evaluate(() => __slaiAttendance.extractSwipePage()), { ready: true, records: [] });
    await page.close();

    const ui = await context.newPage();
    await ui.clock.install({ time: new Date("2030-04-08T10:00:00+08:00") });
    await ui.clock.pauseAt(new Date("2030-04-08T10:00:01+08:00"));
    await ui.addInitScript((state) => {
      window.fixtureState = state;
      window.messages = [];
      window.chrome = { runtime: {
        sendMessage: async (message) => { window.messages.push(message.type); return { state: window.fixtureState }; },
        onMessage: { addListener: (fn) => { window.deliverState = fn; } }
      } };
    }, sanitizeState(fixtureState));
    await ui.goto(pathToFileURL(path.join(extension, "widget.html")).href);
    await ui.waitForFunction(() => document.querySelector("#todayDuration").textContent === "03:00:01");
    await ui.clock.runFor(2000);
    assert.equal(await ui.locator("#todayDuration").innerText(), "03:00:03");
    assert.deepEqual(await ui.evaluate(() => window.messages), ["get-state"], "Local ticks must not issue server requests");
    await ui.evaluate(() => {
      window.fixtureState.todaySwipes.push({ timestamp: "2030-04-08 10:00:00", direction: "出门" });
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
    assert.deepEqual(unexpected, [], "No unexpected network requests during tests");
    console.log("Passed: privacy migration, safe errors, 30-minute scheduling, auth pause, gate filtering, re-entry, deterministic live UI and login UI.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
