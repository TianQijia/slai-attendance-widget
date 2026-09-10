(() => {
  const messages = {
    loading: "正在读取考勤…",
    ok: "考勤已更新",
    auth: "登录已过期，请在学校页面重新登录",
    error: "读取考勤失败，请稍后重试或打开学校系统检查"
  };
  const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const instant = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

  function sanitizeState(input = {}) {
    const state = input && typeof input === "object" ? input : {};
    const status = Object.hasOwn(messages, state.status) ? state.status : "loading";
    return {
      schemaVersion: 1,
      status,
      message: messages[status],
      requiredSeconds: 21600,
      month: typeof state.month === "string" && /^\d{4}-\d{2}$/.test(state.month) ? state.month : "",
      days: (Array.isArray(state.days) ? state.days : []).filter((day) => day && date(day.date)).map((day) => ({
        date: day.date,
        weekday: /^周[一二三四五六日天]$/.test(day.weekday) ? day.weekday : "",
        type: ["工作日", "法定节假日", "休息日", "调休日"].includes(day.type) ? day.type : "",
        duration: typeof day.duration === "string" && /^(?:\d{1,3}:[0-5]\d:[0-5]\d|0)$/.test(day.duration) ? day.duration : "0",
        qualified: day.qualified === true
      })),
      todaySwipes: (Array.isArray(state.todaySwipes) ? state.todaySwipes : []).filter((swipe) => swipe && ["进门", "出门"].includes(swipe.direction) && typeof swipe.timestamp === "string" && /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(swipe.timestamp)).map(({ direction, timestamp }) => ({ direction, timestamp })),
      updatedAt: instant(state.updatedAt),
      nextRefreshAt: instant(state.nextRefreshAt)
    };
  }

  globalThis.__slaiState = { sanitizeState };
})();
