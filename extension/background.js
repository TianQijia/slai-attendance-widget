importScripts("state-utils.js");
const { sanitizeState } = globalThis.__slaiState;
const PORTAL_URL = "https://stu.slai.edu.cn/";
const REFRESH_ALARM = "slai-attendance-refresh";
const REFRESH_MINUTES = 30;
const REQUIRED_SECONDS = 6 * 60 * 60;
const STATE_KEY = "attendanceState";

let refreshPromise = null;

function defaultState() {
  return {
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
  const stored = await chrome.storage.local.get(STATE_KEY);
  return sanitizeState(stored[STATE_KEY] || defaultState());
}

async function migrateStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const stored = await chrome.storage.local.get(null);
  const obsolete = Object.keys(stored).filter((key) => ![STATE_KEY, "widgetWindowId"].includes(key));
  if (stored.widgetWindowId !== undefined && !Number.isInteger(stored.widgetWindowId)) obsolete.push("widgetWindowId");
  if (obsolete.length) await chrome.storage.local.remove(obsolete);
  if (stored[STATE_KEY]) await chrome.storage.local.set({ [STATE_KEY]: sanitizeState(stored[STATE_KEY]) });
}

async function saveState(state) {
  const next = sanitizeState(stateWithSchedule(state));
  if (next.status === "auth") {
    next.nextRefreshAt = null;
    await chrome.alarms.clear(REFRESH_ALARM);
  } else {
    await chrome.alarms.create(REFRESH_ALARM, { delayInMinutes: REFRESH_MINUTES });
  }
  await chrome.storage.local.set({ [STATE_KEY]: next });
  chrome.runtime.sendMessage({ type: "attendance-state", state: next }).catch(() => {});
  return next;
}

function isAuthUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.port && parsed.hostname.toLowerCase() === "sts.slai.edu.cn";
  } catch {
    return false;
  }
}

function isPortalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.port && parsed.hostname.toLowerCase() === "stu.slai.edu.cn";
  } catch {
    return false;
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function waitForTab(tabId, expectedUrlPart = "slai.edu.cn", timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const isExpected = (tab) =>
      tab?.status === "complete" &&
      typeof tab.url === "string" &&
      (!expectedUrlPart || tab.url.includes(expectedUrlPart));
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      callback(value);
    };
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete" && isExpected(tab)) finish(resolve, tab);
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(reject, new Error("采集页已关闭"));
    };
    const timer = setTimeout(() => finish(reject, new Error("学校页面加载超时")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.get(tabId).then((tab) => {
      if (isExpected(tab)) finish(resolve, tab);
    }).catch((error) => finish(reject, error));
  });
}

async function runReader(tabId, method) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["page-reader.js"] });
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (methodName) => globalThis.__slaiAttendance?.[methodName]?.() ?? null,
    args: [method]
  });
  return result[0]?.result ?? null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReader(tabId, method, accept, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let value = null;
  do {
    value = await runReader(tabId, method);
    if (accept(value)) return value;
    await delay(250);
  } while (Date.now() < deadline);
  return value;
}

async function scrapeAttendance({ sourceTabId = null } = {}) {
  let tab;
  let closeWhenDone = false;

  try {
    if (sourceTabId !== null) {
      tab = await chrome.tabs.get(sourceTabId);
    } else {
      tab = await chrome.tabs.create({ url: PORTAL_URL, active: false });
      closeWhenDone = true;
      tab = await waitForTab(tab.id, "slai.edu.cn");
    }

    if (isAuthUrl(tab.url)) {
      await saveState({
        ...(await getState()),
        status: "auth",
        message: "登录已过期，请重新登录"
      });
      return;
    }

    if (!isPortalUrl(tab.url)) throw new Error("学校系统跳转到了未知页面");

    let attendanceUrl = await runReader(tab.id, "findAttendanceUrl");
    if (!attendanceUrl) {
      await chrome.tabs.update(tab.id, { url: PORTAL_URL });
      tab = await waitForTab(tab.id, "slai.edu.cn");
      if (isAuthUrl(tab.url)) {
        await saveState({
          ...(await getState()),
          status: "auth",
          message: "登录已过期，请重新登录"
        });
        return;
      }
      attendanceUrl = await runReader(tab.id, "findAttendanceUrl");
    }

    if (!attendanceUrl) throw new Error("没有找到“学生考勤统计查询”页面");
    if (!isPortalUrl(attendanceUrl)) throw new Error("考勤地址无效");
    if (tab.url !== attendanceUrl) {
      await chrome.tabs.update(tab.id, { url: attendanceUrl });
      tab = await waitForTab(tab.id, "/edu/acm/swipe/attendList");
    }

    const data = await waitForReader(
      tab.id,
      "extractAttendance",
      (value) => Array.isArray(value?.days) && value.days.length > 0
    );
    if (!data || !Array.isArray(data.days) || data.days.length === 0) {
      throw new Error("考勤页面已打开，但没有识别到每日数据");
    }

    const { studentNumber, ...attendanceData } = data;
    let todaySwipes = [];
    if (studentNumber) {
      const recordsUrl = attendanceUrl.replace(
        /\/edu\/acm\/swipe\/attendList(?:[?#].*)?$/,
        `/edu/acm/swipe/list?userNo=${encodeURIComponent(studentNumber)}&swipeDate=${localDateKey()}`
      );
      if (recordsUrl !== attendanceUrl) {
        await chrome.tabs.update(tab.id, { url: recordsUrl });
        tab = await waitForTab(tab.id, "/edu/acm/swipe/list");
        const swipePage = await waitForReader(
          tab.id,
          "extractSwipePage",
          (value) => value?.ready === true
        );
        todaySwipes = swipePage?.records || [];
      }
    }

    await saveState({
      status: "ok",
      message: "考勤已更新",
      requiredSeconds: REQUIRED_SECONDS,
      ...attendanceData,
      todaySwipes,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    await saveState({
      ...(await getState()),
      status: "error",
      message: "读取考勤失败，请稍后重试或打开学校系统检查"
    });
  } finally {
    if (closeWhenDone && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function refreshAttendance(options = {}) {
  if (!refreshPromise) {
    refreshPromise = scrapeAttendance(options).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
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
  if (message?.type === "get-state") {
    getState().then((state) => sendResponse({ ok: true, state }));
    return true;
  }
  if (message?.type === "refresh") {
    refreshAttendance().then(() => getState()).then((state) => sendResponse({ ok: true, state }));
    return true;
  }
  if (message?.type === "login") {
    openLogin().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "open-portal") {
    chrome.tabs.create({ url: PORTAL_URL, active: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
