const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const swipe = (date, time, direction) => ({ timestamp: `${date} ${time}`, direction });
const before = "2030-04-08", after = "2030-04-09";

function harness({ instant, pages, onRead = () => {}, summaryMonth = "2030-04", cached = null }) {
  let now = Date.parse(instant), url = "https://stu.slai.edu.cn/a/edu/acm/swipe/attendList", page = 0;
  const queries = [], delays = [], reads = [];
  const store = { attendanceState: cached, desktopView: "list", bridgeSettings: { enabled: false }, obsolete: "PRIVATE_FIXTURE" };
  const event = { addListener() {}, removeListener() {} };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ Date: Clock, URL, setTimeout, clearTimeout, console, chrome: {
    storage: { local: { setAccessLevel: async () => {}, get: async key => key === null ? structuredClone(store) : { [key]: structuredClone(store[key]) }, set: async values => Object.assign(store, structuredClone(values)), remove: async keys => { for (const key of keys) delete store[key]; } } },
    runtime: { onInstalled: event, onStartup: event, onMessage: event, sendMessage: async () => {} },
    alarms: { onAlarm: event, create: async () => {}, clear: async () => {} }, action: { onClicked: event }, windows: { onRemoved: event },
    tabs: { onUpdated: event, onRemoved: event, get: async () => ({ id: 1, url, status: "complete" }), update: async (_id, value) => { url = value.url; page = 0; queries.push(new URL(url).searchParams.get("swipeDate")); } }
  } });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(root, "extension", name), "utf8"), context));
  vm.runInContext(fs.readFileSync(path.join(root, "extension/background.js"), "utf8"), context);
  context.delay = async ms => delays.push(ms);
  context.runReader = async (_id, method) => {
    if (method === "findAttendanceUrl") return "https://stu.slai.edu.cn/a/edu/acm/swipe/attendList";
    if (method === "extractAttendance") return { ready: true, studentNumber: "000000000", month: summaryMonth, days: [] };
    if (method === "advanceSwipePage") { page++; return true; }
    const date = new URL(url).searchParams.get("swipeDate");
    const list = pages[date] || [[]];
    const records = list[page];
    reads.push({ date, page: page + 1 });
    const result = { ready: true, records, pagination: { current: page + 1, total: list.flat().length, rowCount: records.length, signature: JSON.stringify(records), hasNext: page < list.length - 1 } };
    onRead({ date, page, result, setTime: value => { now = Date.parse(value); } });
    return result;
  };
  return { context, queries, delays, reads, store, run: () => vm.runInContext("scrapeAttendance({ sourceTabId: 1 })", context) };
}

(async () => {
  const pages = {
    [before]: [[swipe(before, "22:00:00", "进门"), swipe(before, "23:00:00", "出门"), swipe(before, "23:30:00", "进门")]],
    [after]: [[swipe(after, "00:30:00", "出门"), swipe(after, "04:00:00", "进门")]]
  };
  const normal = harness({ instant: after + "T04:30:00+08:00", pages });
  await normal.run();
  assert.deepEqual(normal.queries, [before, after]);
  assert.deepEqual(normal.delays, [1500]);
  const complete = normal.store.attendanceState;
  assert.equal(complete.schemaVersion, 5); assert.equal(complete.lastCompleteToday.date, before);
  assert.equal(complete.todaySwipes.length, 5);
  assert.equal(vm.runInContext("globalThis.__slaiTime.attendanceSeconds", normal.context)(complete, Date.parse(after + "T04:30:00+08:00")).seconds, 9000);

  const midnight = harness({ instant: before + "T23:59:59+08:00", pages,
    onRead: ({ date, setTime }) => { if (date === before) setTime(after + "T00:00:01+08:00"); } });
  await midnight.run(); assert.deepEqual(midnight.queries, [before, after]);
  assert.equal(midnight.store.attendanceState.status, "ok");

  const crossing = harness({ instant: after + "T04:59:59+08:00", pages, cached: complete,
    onRead: ({ setTime }) => setTime(after + "T05:00:00+08:00") });
  await crossing.run();
  assert.equal(crossing.store.attendanceState.status, "partial");
  assert.equal(crossing.store.attendanceState.diagnostic.code, "ATTENDANCE_DAY_CHANGED");
  assert.equal(crossing.store.attendanceState.updatedAt, complete.updatedAt);
  assert.match(vm.runInContext("globalThis.__slaiErrors.diagnosticReport", crossing.context)(crossing.store.attendanceState.diagnostic), /05:00/);

  const failure = harness({ instant: after + "T04:30:00+08:00", pages, cached: complete,
    onRead: ({ date, result }) => { if (date === after) result.pagination.total++; } });
  await failure.run();
  assert.equal(failure.store.attendanceState.status, "partial");
  assert.equal(failure.store.attendanceState.diagnostic.code, "SWIPE_INCOMPLETE");
  assert.deepEqual(failure.store.attendanceState.todaySwipes, []);
  assert.deepEqual(failure.store.attendanceState.lastCompleteToday, complete.lastCompleteToday);

  const many = harness({ instant: after + "T04:30:00+08:00", pages: {
    [before]: Array.from({ length: 49 }, (_, i) => [swipe(before, `06:${String(i).padStart(2, "0")}:00`, "进门")]),
    [after]: [[swipe(after, "01:00:00", "出门")], [swipe(after, "02:00:00", "出门")]]
  } });
  await many.run(); assert.equal(many.reads.length, 50);
  assert.equal(many.store.attendanceState.diagnostic.code, "SWIPE_LIMIT");

  const old = { ...complete, schemaVersion: 4, month: "2030-04", days: [{ date: "2030-04-29", duration: "06:00:00" }] };
  const migrated = harness({ instant: "2030-05-01T02:00:00+08:00", pages: {}, cached: old, summaryMonth: "2030-05" });
  await vm.runInContext("migrateStorage()", migrated.context);
  assert.equal(migrated.store.desktopView, "list"); assert.equal(migrated.store.obsolete, undefined);
  assert.equal(migrated.store.attendanceState.lastCompleteToday, null);
  await migrated.run(); assert.equal(migrated.store.attendanceState.month, "2030-04");
  assert.equal(migrated.store.attendanceState.days[0].duration, "06:00:00");
  assert(!JSON.stringify(migrated.store).includes("PRIVATE_FIXTURE"));
  console.log("Passed: two civil queries, midnight race, 05:00 race, shared 50-page budget, partial freeze, month attribution and preference/cache migration.");
})().catch(error => { console.error(error); process.exitCode = 1; });
