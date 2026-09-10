(() => {
  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function secondsFromDuration(value) {
    if (!value || value === "0") return 0;
    const parts = value.split(":").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  function timestampMs(value) {
    if (!value) return NaN;
    return new Date(value.replace(" ", "T")).getTime();
  }

  function attendanceSeconds(state, now = Date.now()) {
    const today = localDateKey(new Date(now));
    const todayRecord = (state.days || []).find((day) => day.date === today);
    const portalSeconds = secondsFromDuration(todayRecord?.duration);
    const swipes = (state.todaySwipes || [])
      .filter((record) => record.timestamp?.startsWith(today))
      .slice()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!swipes.length) return { seconds: portalSeconds, onCampus: false, enteredAt: null };

    let enteredAt = null;
    let calculatedSeconds = 0;
    for (const swipe of swipes) {
      const at = timestampMs(swipe.timestamp);
      if (!Number.isFinite(at)) continue;
      if (swipe.direction === "进门" && enteredAt === null) enteredAt = at;
      if (swipe.direction === "出门" && enteredAt !== null && at >= enteredAt) {
        calculatedSeconds += Math.floor((at - enteredAt) / 1000);
        enteredAt = null;
      }
    }

    if (enteredAt !== null) calculatedSeconds += Math.max(0, Math.floor((now - enteredAt) / 1000));
    return {
      seconds: Math.max(portalSeconds, calculatedSeconds),
      onCampus: enteredAt !== null,
      enteredAt
    };
  }

  globalThis.__slaiTime = { localDateKey, secondsFromDuration, attendanceSeconds };
})();
