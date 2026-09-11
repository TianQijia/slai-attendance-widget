const REQUIRED_SECONDS = 6 * 60 * 60;
let currentState = null;
let ticker = null;

const $ = (id) => document.getElementById(id);
const { localDateKey, secondsFromDuration, attendanceSeconds } = globalThis.__slaiTime;
const { sanitizeState } = globalThis.__slaiState;
const { diagnoseError, describeDiagnostic, diagnosticReport } = globalThis.__slaiErrors;

function shortDuration(seconds, empty = "0 分钟") {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (!hours && !minutes) return empty;
  if (!hours) return `${minutes} 分钟`;
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function clockDuration(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
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
  return `${summaryOnly ? "汇总更新于" : "更新于"} ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))}`;
}

function formatMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || "");
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : "本月";
}

function latestTodaySwipe(state) {
  const today = localDateKey();
  return (state.todaySwipes || [])
    .filter((record) => record.timestamp?.startsWith(today))
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] || null;
}

function swipeClock(timestamp) {
  return timestamp?.match(/\s(\d{2}:\d{2}:\d{2})$/)?.[1] || "";
}

function renderDays(state) {
  const list = $("dayList");
  const days = Array.isArray(state.days) ? state.days : [];
  const today = localDateKey();
  if (!days.length) {
    list.innerHTML = '<div class="empty">还没有读取到本月记录。<br>登录后点击右上角刷新。</div>';
    $("monthSummary").textContent = "-- / -- 天达标";
    return;
  }

  const workdays = days.filter((day) => day.type === "工作日" && day.date <= today);
  const qualified = workdays.filter((day) => {
    const seconds = day.date === today ? attendanceSeconds(state).seconds : secondsFromDuration(day.duration);
    return seconds >= REQUIRED_SECONDS;
  }).length;
  $("monthSummary").textContent = `${qualified} / ${workdays.length} 天达标`;

  list.innerHTML = days.map((day) => {
    const seconds = day.date === today ? attendanceSeconds(state).seconds : secondsFromDuration(day.duration);
    const isOff = day.type !== "工作日";
    const isFuture = day.date > today;
    const tone = isOff || isFuture ? "off" : seconds >= REQUIRED_SECONDS ? "good" : "short";
    const dateParts = day.date.split("-");
    const label = `${Number(dateParts[1])}/${Number(dateParts[2])}`;
    const type = day.type || "未分类";
    const duration = day.date === today ? fullClockDuration(seconds) : (day.duration === "0" ? "0:00:00" : day.duration);
    return `
      <div class="day-row ${day.date === today ? "today" : ""}">
        <div class="day-date"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(day.weekday || "")}</span></div>
        <span class="day-type">${escapeHtml(type)}</span>
        <span class="day-time ${tone}" ${day.date === today ? 'id="todayRowDuration"' : ""}>${escapeHtml(duration)}</span>
      </div>`;
  }).join("");

  const todayRow = list.querySelector(".today");
  if (todayRow) todayRow.scrollIntoView({ block: "center" });
}

function renderToday(state) {
  const attendance = attendanceSeconds(state);
  const latestSwipe = latestTodaySwipe(state);
  const seconds = attendance.seconds;
  const remaining = Math.max(0, (state.requiredSeconds || REQUIRED_SECONDS) - seconds);
  const complete = remaining === 0;
  const progress = Math.min(1, seconds / (state.requiredSeconds || REQUIRED_SECONDS));

  $("todayDuration").textContent = fullClockDuration(seconds);
  const todayRowDuration = $("todayRowDuration");
  if (todayRowDuration) todayRowDuration.textContent = fullClockDuration(seconds);
  $("remainingLabel").textContent = complete ? "今日状态" : "距离完成";
  $("remaining").textContent = complete ? "已达标" : shortDuration(remaining);
  $("remaining").parentElement.classList.toggle("done", complete);
  $("progressRing").style.setProperty("--progress", `${progress * 360}deg`);
  $("monthTitle").textContent = formatMonth(state.month);
  $("updatedAt").textContent = formatUpdated(state);

  const statusDot = $("statusDot");
  statusDot.className = "status-dot";
  if (state.status === "ok") statusDot.classList.add("ok");
  if (state.status === "error") statusDot.classList.add("error");
  if (state.status === "ok" && attendance.onCampus) {
    $("statusText").textContent = `当前在校 · ${swipeClock(latestSwipe?.timestamp)} 起实时计时`;
  } else if (state.status === "ok" && latestSwipe?.direction === "出门") {
    $("statusText").textContent = `当前离校 · ${swipeClock(latestSwipe.timestamp)} 起暂停`;
  } else {
    $("statusText").textContent = state.message || "等待更新";
  }
}

function render(state) {
  state = sanitizeState(state);
  currentState = state;
  $("todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  renderToday(state);
  $("monthTitle").textContent = formatMonth(state.month);
  $("updatedAt").textContent = formatUpdated(state);
  $("authCard").classList.toggle("hidden", state.status !== "auth");
  renderDays(state);
  renderDiagnostic(state);
  updateNextRefresh();
}

function renderDiagnostic(state) {
  $("diagnosticCard").classList.toggle("hidden", !state.diagnostic);
  $("copyStatus").textContent = "";
  if (!state.diagnostic) {
    $("diagnosticReport").textContent = "";
    return;
  }
  let version = "";
  try { version = chrome.runtime.getManifest?.().version || ""; } catch { /* Old window after extension reload. */ }
  $("diagnosticAction").textContent = describeDiagnostic(state.diagnostic).action;
  $("diagnosticReport").textContent = diagnosticReport(state.diagnostic, { version, status: state.status });
}

async function copyDiagnostic() {
  const report = $("diagnosticReport").textContent;
  if (!report) return;
  try {
    await navigator.clipboard.writeText(report);
    $("copyStatus").textContent = "已复制排错信息";
  } catch {
    $("diagnosticDetails").open = true;
    const range = document.createRange();
    range.selectNodeContents($("diagnosticReport"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    $("copyStatus").textContent = "浏览器未允许自动复制，请手动复制已选中的信息。";
  }
}

function updateNextRefresh() {
  if (currentState) renderToday(currentState);
  if (!currentState?.nextRefreshAt) {
    $("nextRefresh").textContent = currentState?.status === "auth" ? "等待登录 · 自动刷新已暂停" : "每 30 分钟自动刷新";
    return;
  }
  const seconds = Math.max(0, Math.ceil((new Date(currentState.nextRefreshAt).getTime() - Date.now()) / 1000));
  const minutes = Math.ceil(seconds / 60);
  $("nextRefresh").textContent = seconds ? `${minutes} 分钟后自动刷新` : "即将自动刷新";
}

async function send(type) {
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response) throw Object.assign(new Error("No background response"), { code: "WIDGET_DISCONNECTED" });
    if (response.ok === false) render({ ...currentState, status: "error", diagnostic: response.diagnostic || diagnoseError(null, { stage: "widget_request" }) });
    return response;
  } catch (error) {
    render({ ...currentState, status: "error", diagnostic: diagnoseError(error, { stage: "widget_request", operation: type.replaceAll("-", "_") }) });
    return null;
  }
}

async function refresh() {
  const button = $("refresh");
  button.classList.add("spinning");
  button.disabled = true;
  try {
    const response = await send("refresh");
    if (response?.state) render(response.state);
  } finally {
    button.classList.remove("spinning");
    button.disabled = false;
  }
}

$("refresh").addEventListener("click", refresh);
$("login").addEventListener("click", () => send("login"));
$("openPortal").addEventListener("click", () => send("open-portal"));
$("copyDiagnostic").addEventListener("click", copyDiagnostic);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "attendance-state" && message.state) render(message.state);
});

send("get-state").then((response) => { if (response?.state) render(response.state); });
ticker = setInterval(updateNextRefresh, 1000);
