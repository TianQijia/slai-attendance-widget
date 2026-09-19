importScripts("time-utils.js", "error-utils.js", "state-utils.js", "collection.js");
const { sanitizeState } = globalThis.__slaiState;
const { diagnoseError } = globalThis.__slaiErrors;
const PORTAL_URL = "https://stu.slai.edu.cn/";
const REFRESH_ALARM = "slai-attendance-refresh";
const REFRESH_MINUTES = 30;
const REQUIRED_SECONDS = 6 * 60 * 60;
const STATE_KEY = "attendanceState";

function defaultState() {
  return {
    schemaVersion: 5,
    status: "loading",
    message: "正在读取考勤…",
    requiredSeconds: REQUIRED_SECONDS,
    days: [],
    updatedAt: null,
    nextRefreshAt: null
  };
}

function stateWithSchedule(state) {
  return {
    ...state,
    requiredSeconds: REQUIRED_SECONDS,
    nextRefreshAt: new Date(Date.now() + REFRESH_MINUTES * 60 * 1000).toISOString()
  };
}

async function getState() {
  try {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return sanitizeState(stored[STATE_KEY] || defaultState());
  } catch (error) {
    throw readerError("STORAGE_READ_FAILED", "无法读取本机缓存", { stage: "read_cache", operation: "storage_get" });
  }
}

async function migrateStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const stored = await chrome.storage.local.get(null);
  const obsolete = Object.keys(stored).filter((key) => ![STATE_KEY, "widgetWindowId", "desktopView"].includes(key));
  if (stored.desktopView !== undefined && !["calendar", "list"].includes(stored.desktopView)) obsolete.push("desktopView");
  if (stored.widgetWindowId !== undefined && !Number.isInteger(stored.widgetWindowId)) obsolete.push("widgetWindowId");
  if (obsolete.length) await chrome.storage.local.remove(obsolete);
  if (stored[STATE_KEY]) await chrome.storage.local.set({ [STATE_KEY]: sanitizeState(stored[STATE_KEY]) });
}

async function saveState(state) {
  const next = sanitizeState(stateWithSchedule(state));
  try {
    if (next.status === "auth") {
      next.nextRefreshAt = null;
      await chrome.alarms.clear(REFRESH_ALARM);
    } else {
      await chrome.alarms.create(REFRESH_ALARM, { delayInMinutes: REFRESH_MINUTES });
    }
  } catch {
    throw readerError("SCHEDULE_FAILED", "无法设置自动刷新", { operation: "schedule" });
  }
  try {
    await chrome.storage.local.set({ [STATE_KEY]: next });
  } catch {
    throw readerError("STORAGE_WRITE_FAILED", "无法保存考勤结果", { stage: "save_state", operation: "storage_set" });
  }
  chrome.runtime.sendMessage({ type: "attendance-state", state: next }).catch(() => {});
  return next;
}

async function openWidget() {
  const stored = await chrome.storage.local.get("widgetWindowId");
  const widgetUrl = chrome.runtime.getURL("widget.html");
  if (stored.widgetWindowId) {
    try {
      const existingWindow = await chrome.windows.get(stored.widgetWindowId, { populate: true });
      const existingWidgetTab = existingWindow.tabs?.find((tab) => tab.url === widgetUrl);
      if (!existingWidgetTab && existingWindow.tabs?.length === 1) {
        await chrome.tabs.update(existingWindow.tabs[0].id, { url: widgetUrl });
      } else if (!existingWidgetTab) {
        throw new Error("Stored widget window no longer contains the widget");
      }
      await chrome.windows.update(stored.widgetWindowId, { focused: true });
      return;
    } catch {
      await chrome.storage.local.remove("widgetWindowId");
    }
  }

  const window = await chrome.windows.create({
    url: widgetUrl,
    type: "popup",
    width: 410,
    height: 620,
    focused: true
  });
  await chrome.storage.local.set({ widgetWindowId: window.id });
}

async function openLogin() {
  await saveState({
    ...(await getState()),
    status: "auth",
    diagnostic: null,
    errorCode: "",
    message: "请在学校页面完成登录"
  });
  await chrome.tabs.create({ url: PORTAL_URL, active: true });
}

chrome.runtime.onInstalled.addListener(async () => {
  await migrateStorage();
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  await openWidget();
  await refreshAttendance();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateStorage();
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  await openWidget();
  await refreshAttendance();
});

chrome.action.onClicked.addListener(() => openWidget());
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === REFRESH_ALARM && (await getState()).status !== "auth") refreshAttendance();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.local.get("widgetWindowId");
  if (stored.widgetWindowId === windowId) await chrome.storage.local.remove("widgetWindowId");
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isPortalUrl(tab.url)) return;
  const state = await getState();
  if (state.status === "auth") refreshAttendance();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id || sender?.url !== chrome.runtime.getURL("widget.html")) return false;
  const respond = (work, operation) => {
    Promise.resolve().then(work).then(sendResponse).catch((error) => sendResponse({
      ok: false, diagnostic: diagnoseError(error, { stage: "widget_request", operation })
    }));
    return true;
  };
  if (message?.type === "get-state") {
    return respond(async () => ({ ok: true, state: await getState() }), "get_state");
  }
  if (message?.type === "refresh") {
    return respond(async () => { await refreshAttendance(); return { ok: true, state: await getState() }; }, "refresh");
  }
  if (message?.type === "login") {
    return respond(async () => { await openLogin(); return { ok: true }; }, "login");
  }
  if (message?.type === "open-portal") {
    return respond(async () => { await chrome.tabs.create({ url: PORTAL_URL, active: true }); return { ok: true }; }, "open_portal");
  }
  return false;
});
