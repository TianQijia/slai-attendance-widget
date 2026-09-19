// Fictional data only. This module is never included in the extension ZIP.
const now = "2026-09-19T14:20:00+08:00";
const updatedAt = new Date(now).toISOString();
const state = {
  schemaVersion: 5, status: "ok", month: "2026-09", updatedAt, summaryUpdatedAt: updatedAt,
  nextRefreshAt: "2026-09-19T06:50:00.000Z",
  days: Array.from({ length: 18 }, (_, index) => {
    const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
    const day = new Date(date + "T12:00:00+08:00").getUTCDay();
    return { date, weekday: "周" + "日一二三四五六"[day], type: day === 0 || day === 6 ? "休息日" : "工作日", duration: index % 4 ? "06:10:00" : "03:00:00" };
  }),
  todaySwipes: [
    { timestamp: "2026-09-19 09:00:00", direction: "进门" },
    { timestamp: "2026-09-19 10:20:00", direction: "出门" },
    { timestamp: "2026-09-19 12:20:00", direction: "进门" }
  ]
};
function bootstrap(config) {
  const NativeDate = Date;
  const instant = Date.parse(config.now);
  window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } };
  window.__fixtureState = structuredClone(config.state);
  window.__testMessages = [];
  const listeners = [];
  window.__fixtureNotify = message => listeners.forEach(fn => fn(message));
  window.chrome = {
    runtime: { getManifest: () => ({ version: "1.3.0" }), onMessage: { addListener: fn => listeners.push(fn) },
      sendMessage: async message => {
        window.__testMessages.push(message.type);
        if (message.type === "get-bridge" || message.type === "set-bridge") return { ok: true, enabled: message.enabled === true };
        if (["get-state", "refresh"].includes(message.type)) return { ok: true, state: structuredClone(window.__fixtureState) };
        return { ok: true };
      }
    },
    storage: { local: {
      get: async () => ({ desktopView: localStorage.getItem("slai-demo-view") }),
      set: async value => { localStorage.setItem("slai-demo-view", value.desktopView); }
    } },
    permissions: { request: async () => true }
  };
}
module.exports = { now, state, bootstrap };
