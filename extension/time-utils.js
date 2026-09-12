(() => {
  const TIME_ZONE = "Asia/Shanghai";
  const STALE_MS = 35 * 60 * 1000;
  const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  function localDateKey(date = new Date()) {
    const parts = dateFormatter.formatToParts(date);
    const value = (type) => parts.find(part => part.type === type).value;
    return `${value("year")}-${value("month")}-${value("day")}`;
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
    const seen = new Set();
    const sorted = (Array.isArray(records) ? records : []).filter(record => {
      if (!record || !["进门", "出门"].includes(record.direction) || !Number.isFinite(timestampMs(record.timestamp)) || !record.timestamp.startsWith(date + " ")) return false;
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
  function attendanceSeconds(state, now = Date.now(), { forceFreeze = false } = {}) {
    const today = localDateKey(new Date(now));
    // Legacy compatibility requires an explicitly successful, dated snapshot.
    const snapshot = state.lastCompleteToday || (state.schemaVersion !== 4 && state.status === "ok" && Number.isFinite(Date.parse(state.updatedAt)) ? {
      date: localDateKey(new Date(state.updatedAt)), swipes: state.todaySwipes || [], updatedAt: state.updatedAt
    } : null);
    const empty = { seconds: 0, available: false, frozen: true, source: "unavailable", onCampus: false, enteredAt: null, lastEffectiveSwipe: null, updatedAt: null };
    if (!snapshot || snapshot.date !== today || !Number.isFinite(Date.parse(snapshot.updatedAt))) return empty;
    const updated = Date.parse(snapshot.updatedAt);
    const frozen = forceFreeze || state.status !== "ok" || now - updated > STALE_MS || updated > now + 60000;
    const end = frozen ? updated : now;
    const events = effectiveSwipes(snapshot.swipes, today);
    let enteredAt = null;
    let seconds = 0;
    for (const event of events) {
      const at = timestampMs(event.timestamp);
      if (event.direction === "进门") enteredAt = at;
      else if (enteredAt !== null) {
        seconds += Math.max(0, Math.floor((at - enteredAt) / 1000));
        enteredAt = null;
      }
    }
    if (enteredAt !== null) seconds += Math.max(0, Math.floor((end - enteredAt) / 1000));
    return { seconds, available: true, frozen, source: frozen ? "snapshot" : "live", onCampus: enteredAt !== null,
      enteredAt, lastEffectiveSwipe: events.at(-1) || null, updatedAt: snapshot.updatedAt };
  }
  globalThis.__slaiTime = { TIME_ZONE, STALE_MS, localDateKey, secondsFromDuration, timestampMs, effectiveSwipes, attendanceSeconds };
})();
