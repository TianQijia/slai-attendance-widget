(() => {
  const { sanitizeDiagnostic, describeDiagnostic } = globalThis.__slaiErrors;
  const messages = {
    loading: "正在读取考勤…",
    ok: "考勤已更新",
    partial: "今日明细读取失败，暂显示学校汇总",
    auth: "登录已过期，请在学校页面重新登录",
    error: "直接原因尚未记录，请重新刷新以生成排错信息"
  };
  const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const instant = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

  function sanitizeState(input = {}) {
    const state = input && typeof input === "object" ? input : {};
    const status = Object.hasOwn(messages, state.status) ? state.status : "loading";
    const diagnostic = ["partial", "error", "auth"].includes(status) ? sanitizeDiagnostic(state.diagnostic ||
      (state.errorCode ? { code: state.errorCode, stage: status === "partial" ? "read_swipes" : "unknown" } : null)) : null;
    const description = describeDiagnostic(diagnostic);
    const errorCode = diagnostic?.code || "";
    const reason = description?.reason || messages[status];
    const message = status === "partial" ? `${description?.reason || "今日明细的失败原因尚未记录"}；暂显示学校汇总` : reason;
    return {
      schemaVersion: 3,
      status,
      message,
      errorCode,
      diagnostic,
      requiredSeconds: 21600,
      month: typeof state.month === "string" && /^\d{4}-\d{2}$/.test(state.month) ? state.month : "",
      days: (Array.isArray(state.days) ? state.days : []).filter((day) => day && date(day.date)).map((day) => ({
        date: day.date,
        weekday: /^周[一二三四五六日天]$/.test(day.weekday) ? day.weekday : "",
        type: ["工作日", "法定节假日", "休息日", "调休日"].includes(day.type) ? day.type : "",
        duration: typeof day.duration === "string" && /^(?:\d{1,3}:[0-5]\d:[0-5]\d|0)$/.test(day.duration) ? day.duration : "0",
        qualified: day.qualified === true
      })),
      todaySwipes: (status !== "partial" && Array.isArray(state.todaySwipes) ? state.todaySwipes : []).filter((swipe) => swipe && ["进门", "出门"].includes(swipe.direction) && typeof swipe.timestamp === "string" && /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(swipe.timestamp)).map(({ direction, timestamp }) => ({ direction, timestamp })),
      updatedAt: instant(state.updatedAt),
      summaryUpdatedAt: instant(state.summaryUpdatedAt),
      nextRefreshAt: instant(state.nextRefreshAt)
    };
  }

  globalThis.__slaiState = { sanitizeState };
})();
