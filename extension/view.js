const REQUIRED_SECONDS = 6 * 60 * 60;
let currentState = null;
let lastRenderedDate = null;
let viewNow = () => Date.now();
let forceFreeze = () => false;
let mobileView = false;

const $ = (id) => document.getElementById(id);
const { localDateKey, secondsFromDuration, attendanceSeconds } = globalThis.__slaiTime;
const { sanitizeState } = globalThis.__slaiState;
const { diagnoseError, describeDiagnostic, diagnosticReport } = globalThis.__slaiErrors;
const { setReportText, copyReport } = globalThis.__slaiReports;

function shortDuration(seconds, empty = "0 分钟") {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (!hours && !minutes) return empty;
  if (!hours) return `${minutes} 分钟`;
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function fullClockDuration(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUpdated(state) {
  const summaryOnly = state.summaryUpdatedAt && (!state.updatedAt || Date.parse(state.summaryUpdatedAt) > Date.parse(state.updatedAt));
  const value = summaryOnly ? state.summaryUpdatedAt : state.updatedAt;
  if (!value) return "尚未更新";
  return `${summaryOnly ? "汇总更新于" : "更新于"} ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }).format(new Date(value))}`;
}

function formatMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || "");
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : "本月";
}

function swipeClock(timestamp) {
  return timestamp?.match(/\s(\d{2}:\d{2}:\d{2})$/)?.[1] || "";
}

function renderDays(state) {
  const list = $("dayList");
  const days = [...(state.days || [])];
  const today = localDateKey(new Date(viewNow()));
  if (!days.some(day => day.date === today)) days.push({ date: today, weekday: "", type: "", duration: "0" });
  days.sort((a, b) => a.date.localeCompare(b.date));

  const workdays = days.filter((day) => day.type === "工作日" && day.date < today);
  const qualified = workdays.filter((day) => {
    const seconds = day.date === today ? attendanceSeconds(state, viewNow(), { forceFreeze: forceFreeze() }).seconds : secondsFromDuration(day.duration);
    return seconds >= REQUIRED_SECONDS;
  }).length;
  $("monthSummary").textContent = `${qualified} / ${workdays.length} 天达标 · 历史`;

  list.innerHTML = days.map((day) => {
    const seconds = day.date === today ? attendanceSeconds(state, viewNow(), { forceFreeze: forceFreeze() }).seconds : secondsFromDuration(day.duration);
    const isOff = day.type !== "工作日";
    const isFuture = day.date > today;
    const tone = isOff || isFuture ? "off" : seconds >= REQUIRED_SECONDS ? "good" : "short";
    const dateParts = day.date.split("-");
    const label = `${Number(dateParts[1])}/${Number(dateParts[2])}`;
    const type = day.date === today ? "今日估算" : day.type || "未分类";
    const duration = day.date === today ? (attendanceSeconds(state, viewNow(), { forceFreeze: forceFreeze() }).available ? fullClockDuration(seconds) : "--:--:--") : (day.duration === "0" ? "0:00:00" : day.duration);
    return `
      <div class="day-row ${day.date === today ? "today" : ""}">
        <div class="day-date"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(day.weekday || "")}</span></div>
        <span class="day-type">${escapeHtml(type)}</span>
        <span class="day-time ${tone}" ${day.date === today ? 'id="todayRowDuration"' : ""}>${escapeHtml(duration)}</span>
      </div>`;
  }).join("");

  const todayRow = list.querySelector(".today");
  // Center within the history list without moving the phone's whole page.
  if (todayRow) list.scrollTop = todayRow.offsetTop - (list.clientHeight - todayRow.clientHeight) / 2;
}

function renderToday(state) {
  const attendance = attendanceSeconds(state, viewNow(), { forceFreeze: forceFreeze() });
  const latestSwipe = attendance.lastEffectiveSwipe;
  const seconds = attendance.seconds;
  const remaining = Math.max(0, (state.requiredSeconds || REQUIRED_SECONDS) - seconds);
  const complete = attendance.available && remaining === 0;
  const progress = Math.min(1, seconds / (state.requiredSeconds || REQUIRED_SECONDS));

  $("todayDuration").textContent = attendance.available ? fullClockDuration(seconds) : "--:--:--";
  const todayRowDuration = $("todayRowDuration");
  if (todayRowDuration) todayRowDuration.textContent = $("todayDuration").textContent;
  $("remainingLabel").textContent = complete ? "今日状态" : "距离完成";
  $("remaining").textContent = !attendance.available ? "--" : complete ? "已达标" : shortDuration(remaining);
  $("remaining").parentElement.classList.toggle("done", complete);
  $("progressRing").style.setProperty("--progress", `${progress * 360}deg`);
  $("monthTitle").textContent = formatMonth(state.month);
  $("updatedAt").textContent = formatUpdated(state);
  if ($("summaryUpdatedAt")) $("summaryUpdatedAt").textContent = "学校汇总更新于 " + formatInstant(state.summaryUpdatedAt);

  const statusDot = $("statusDot");
  statusDot.className = "status-dot";
  if (state.status === "ok" && !attendance.frozen) statusDot.classList.add("ok");
  if (state.status === "error") statusDot.classList.add("error");
  const source = $("dataSource");
  if (source) source.textContent = attendance.available ? (attendance.frozen ? "上次完整结果 · " : "今日按进出明细估算 · ") + "同步于 " + formatInstant(attendance.updatedAt) : "暂无可靠数据";
  if (!attendance.available) {
    $("statusText").textContent = ["partial", "auth", "error"].includes(state.status) ? state.message : "暂无可靠数据";
  } else if (attendance.frozen) {
    $("statusText").textContent = state.status === "ok" ? "估算已暂停 · 上次完整结果" : state.message;
  } else if (attendance.onCampus) {
    $("statusText").textContent = `当前在校 · ${swipeClock(latestSwipe?.timestamp)} 起实时计时`;
  } else if (state.status === "ok" && latestSwipe?.direction === "出门") {
    $("statusText").textContent = `当前离校 · ${swipeClock(latestSwipe.timestamp)} 起暂停`;
  } else {
    $("statusText").textContent = "今日完整明细暂无校园进出记录";
  }
}

function formatInstant(value) {
  if (!value) return "尚未更新";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}
function render(state) {
  state = sanitizeState(state);
  currentState = state;
  $("todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date(viewNow()));
  lastRenderedDate = localDateKey(new Date(viewNow()));
  renderToday(state);
  $("monthTitle").textContent = formatMonth(state.month);
  $("updatedAt").textContent = formatUpdated(state);
  if ($("summaryUpdatedAt")) $("summaryUpdatedAt").textContent = "学校汇总更新于 " + formatInstant(state.summaryUpdatedAt);
  $("authCard").classList.toggle("hidden", mobileView || state.status !== "auth");
  renderDays(state);
  renderDiagnostic(state);
  updateNextRefresh();
}

function renderDiagnostic(state) {
  $("diagnosticCard").classList.toggle("hidden", !state.diagnostic);
  if (!state.diagnostic) {
    setReportText($("diagnosticReport"), "", $("copyStatus"));
    return;
  }
  let version = "";
  try { version = chrome.runtime.getManifest?.().version || ""; } catch { /* Old window after extension reload. */ }
  $("diagnosticAction").textContent = describeDiagnostic(state.diagnostic).action;
  setReportText($("diagnosticReport"), diagnosticReport(state.diagnostic, { version, status: state.status }), $("copyStatus"));
}

async function copyDiagnostic() {
  await copyReport($("diagnosticReport"), $("copyStatus"), "已复制排错信息");
}

function updateNextRefresh() {
  if (currentState && lastRenderedDate !== localDateKey(new Date(viewNow()))) { render(currentState); return; }
  if (mobileView) { if (currentState) renderToday(currentState); return; }
  if (currentState) renderToday(currentState);
  if (!currentState?.nextRefreshAt) {
    $("nextRefresh").textContent = currentState?.status === "auth" ? "等待登录 · 自动刷新已暂停" : "每 30 分钟自动刷新";
    return;
  }
  const seconds = Math.max(0, Math.ceil((new Date(currentState.nextRefreshAt).getTime() - Date.now()) / 1000));
  const minutes = Math.ceil(seconds / 60);
  $("nextRefresh").textContent = seconds ? `${minutes} 分钟后自动刷新` : "即将自动刷新";
}


$("copyDiagnostic").addEventListener("click", copyDiagnostic);
