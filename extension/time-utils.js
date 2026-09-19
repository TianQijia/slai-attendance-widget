(() => {
  const TIME_ZONE = "Asia/Shanghai";
  const STALE_MS = 35 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  function localDateKey(date = new Date()) {
    const parts = dateFormatter.formatToParts(date);
    const value = (type) => parts.find(part => part.type === type).value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  }
  // Keep civil dates for portal queries/timestamp validation. Attendance dates
  // are separate: midnight is NOT a school-day boundary.
  function attendanceDateKey(date = new Date()) {
    return localDateKey(new Date(Number(date) - 5 * 60 * 60 * 1000));
  }
  function attendanceWindow(date = attendanceDateKey()) {
    const start = Date.parse(date + "T05:00:00+08:00");
    return { date, start, end: start + DAY_MS };
  }
  function attendanceQueryDates(now = Date.now()) {
    return [...new Set([attendanceDateKey(new Date(now)), localDateKey(new Date(now))])];
  }
  function secondsFromDuration(value) {
    if (typeof value !== "string" || !/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(value)) return 0;
    const [hours, minutes, seconds] = value.split(":").map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }
  function timestampMs(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)) return NaN;
    const at = Date.parse(value.replace(" ", "T") + "+08:00");
    return Number.isFinite(at) && localDateKey(new Date(at)) === value.slice(0, 10) ? at : NaN;
  }
  function effectiveSwipes(records, date) {
    const window = attendanceWindow(date);
    const seen = new Set();
    const sorted = (Array.isArray(records) ? records : []).filter(record => {
      const at = timestampMs(record?.timestamp);
      if (!record || !["进门", "出门"].includes(record.direction) || !Number.isFinite(at) || at < window.start || at >= window.end) return false;
      const key = record.timestamp + record.direction;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const result = [];
    for (const record of sorted) {
      const event = { timestamp: record.timestamp, direction: record.direction };
      if (result.at(-1)?.direction !== event.direction) result.push(event);
      else if (event.direction === "进门") result[result.length - 1] = event;
    }
    return result;
  }
  function attendanceIntervals(records, date, end = Date.now()) {
    const window = attendanceWindow(date);
    const events = effectiveSwipes((Array.isArray(records) ? records : []).filter(event => timestampMs(event?.timestamp) <= end), date);
    const segments = [];
    let enteredAt = null;
    for (const event of events) {
      const at = timestampMs(event.timestamp);
      if (event.direction === "进门") enteredAt = at;
      else if (enteredAt !== null) {
        if (at > enteredAt) segments.push({ start: enteredAt, end: at, estimated: false });
        enteredAt = null;
      }
    }
    // An unclosed stay is provisional only inside its own attendance day.
    // Never clip it at 05:00: the WHOLE cross-boundary stay is invalid.
    if (enteredAt !== null && end >= enteredAt && end < window.end) {
      segments.push({ start: enteredAt, end, estimated: true });
    }
    return { segments, enteredAt, lastEffectiveSwipe: events.at(-1) || null };
  }
  function attendanceSeconds(state, now = Date.now(), { forceFreeze = false } = {}) {
    const today = attendanceDateKey(new Date(now));
    const snapshot = state.schemaVersion === 5 && (state.lastCompleteToday || (state.status === "ok" && Number.isFinite(Date.parse(state.updatedAt)) ? {
      date: attendanceDateKey(new Date(state.updatedAt)), swipes: state.todaySwipes || [], updatedAt: state.updatedAt
    } : null));
    const empty = { seconds: 0, segments: [], available: false, frozen: true, source: "unavailable", onCampus: false, enteredAt: null, lastEffectiveSwipe: null, updatedAt: null };
    if (!snapshot || snapshot.date !== today || !Number.isFinite(Date.parse(snapshot.updatedAt))) return empty;
    const updated = Date.parse(snapshot.updatedAt);
    const frozen = forceFreeze || state.status !== "ok" || now - updated > STALE_MS || updated > now + 60000;
    const end = frozen ? Math.min(updated, now) : now;
    const result = attendanceIntervals(snapshot.swipes.filter(event => timestampMs(event.timestamp) <= updated), today, end);
    const seconds = result.segments.reduce((sum, segment) => sum + Math.floor((segment.end - segment.start) / 1000), 0);
    return { ...result, seconds, available: true, frozen, source: frozen ? "snapshot" : "live", onCampus: result.enteredAt !== null,
      updatedAt: snapshot.updatedAt };
  }
  globalThis.__slaiTime = { TIME_ZONE, STALE_MS, localDateKey, attendanceDateKey, attendanceWindow, attendanceQueryDates, secondsFromDuration, timestampMs, effectiveSwipes, attendanceIntervals, attendanceSeconds };
})();
