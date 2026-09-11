const assert = require("node:assert/strict");
require("../extension/time-utils"); require("../extension/error-utils"); require("../extension/state-utils");
const { attendanceSeconds, localDateKey, effectiveSwipes } = globalThis.__slaiTime;
const { sanitizeState } = globalThis.__slaiState;
const date = "2030-04-08";
const now = Date.parse(date + "T10:00:00+08:00");
const sw = (clock, direction) => ({ timestamp: `${date} ${clock}:00`, direction });
const state = records => sanitizeState({ status: "ok", todaySwipes: records, updatedAt: new Date(now).toISOString(), days: [] });
function run() {
  const entry = [sw("08:00", "进门"), sw("08:10", "进门")];
  let value = attendanceSeconds(state([...entry, sw("09:00", "出门")]), now);
  assert.equal(value.seconds, 3000); assert.equal(value.onCampus, false);
  value = attendanceSeconds(state(entry), now);
  assert.equal(value.seconds, 6600); assert.equal(value.enteredAt, Date.parse(date + "T08:10:00+08:00"));
  const exits = state([sw("07:00", "出门"), ...entry, sw("09:00", "出门"), sw("09:10", "出门")]);
  value = attendanceSeconds(exits, now); assert.equal(value.seconds, 3000); assert.equal(value.lastEffectiveSwipe.timestamp, date + " 09:00:00");
  assert.equal(attendanceSeconds(state([sw("08:00", "进门"), sw("08:00", "进门"), sw("09:00", "出门")]), now).seconds, 3600);
  assert.equal(attendanceSeconds(state([sw("05:00", "出门"), sw("08:00", "进门"), sw("08:30", "出门"), sw("09:00", "进门"), sw("09:30", "出门")]), now).seconds, 3600);
  for (const directions of [["进门", "出门"], ["出门", "进门"]]) {
    value = attendanceSeconds(state(directions.map(d => sw("10:00", d))), now);
    assert.equal(value.seconds, 0); assert.equal(value.onCampus, directions.at(-1) === "进门");
  }
  const highSchool = { ...exits, days: [{ date, duration: "08:00:00" }] };
  assert.equal(attendanceSeconds(highSchool, now).seconds, 3000, "Today's school total is never a lower bound");
  assert.equal(attendanceSeconds(state([]), now).available, true);
  assert.equal(attendanceSeconds(sanitizeState({ status: "partial", todaySwipes: entry }), now).available, false);
  const complete = state(entry);
  for (const status of ["partial", "error", "auth"]) {
    value = attendanceSeconds(sanitizeState({ ...complete, status, todaySwipes: [sw("09:59", "进门")] }), now + 60000);
    assert.equal(value.seconds, 6600); assert.equal(value.frozen, true);
  }
  assert.equal(attendanceSeconds(complete, now + 36 * 60000).seconds, 6600);
  assert.equal(attendanceSeconds(complete, now + 60000, { forceFreeze: true }).seconds, 6600);
  assert.equal(attendanceSeconds(complete, now + 86400000).available, false);
  const oldTz = process.env.TZ; process.env.TZ = "America/Los_Angeles";
  assert.equal(localDateKey(new Date("2030-04-07T16:00:00Z")), date);
  assert.equal(attendanceSeconds(complete, now).seconds, 6600);
  if (oldTz === undefined) delete process.env.TZ; else process.env.TZ = oldTz;
  assert.equal(sanitizeState({ ...complete, lastCompleteToday: { ...complete.lastCompleteToday, swipes: [{ timestamp: "PRIVATE_FIXTURE", direction: "进门" }] } }).lastCompleteToday, null);
  const unsafe = sanitizeState({ ...complete, lastCompleteToday: { ...complete.lastCompleteToday, swipes: entry.map(swipe => ({ ...swipe, account: "PRIVATE_FIXTURE" })), token: "PRIVATE_FIXTURE" } });
  assert(!JSON.stringify(unsafe).includes("PRIVATE_FIXTURE"));
  assert.equal(sanitizeState({ ...complete, lastCompleteToday: { ...complete.lastCompleteToday, date: "2030-02-30" } }).lastCompleteToday, null);
  const copy = JSON.stringify(entry); effectiveSwipes(entry, date); assert.equal(JSON.stringify(entry), copy);
  console.log("Passed: minimum closure, school next-day totals, exact status events, full snapshot freezing, empty success, midnight and school timezone.");
}
if (require.main === module) run();
module.exports = { run, state, sw, now };
