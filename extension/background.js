importScripts("time-utils.js", "error-utils.js", "state-utils.js", "refresh-utils.js", "bridge-utils.js", "remote-refresh.js");
const { sanitizeState } = globalThis.__slaiState;
const { diagnoseError } = globalThis.__slaiErrors;
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
  const obsolete = Object.keys(stored).filter((key) => ![STATE_KEY, "widgetWindowId", "bridgeSettings", "bridgeDiagnostic", "refreshDiagnostic"].includes(key));
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
  queueBridgePush(next);
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

const { localDateKey } = globalThis.__slaiTime;

function waitForTab(tabId, expectedUrlPart = "slai.edu.cn", timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const isExpected = (tab) =>
      tab?.status === "complete" &&
      typeof tab.url === "string" &&
      !tab.pendingUrl && tab.url !== "about:blank" &&
      (!expectedUrlPart || tab.url.includes(expectedUrlPart) || isAuthUrl(tab.url) || !isPortalUrl(tab.url));
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
      if (removedTabId === tabId) finish(reject, readerError("TAB_CLOSED", "采集页已关闭", { operation: "navigate" }));
    };
    const timer = setTimeout(() => finish(reject, readerError("PAGE_TIMEOUT", "学校页面加载超时", { operation: "navigate", timeoutMs })), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.get(tabId).then((tab) => {
      if (isExpected(tab)) finish(resolve, tab);
    }).catch((error) => finish(reject, withErrorDetails(error, { operation: "get_tab" })));
  });
}

async function runReader(tabId, method) {
  let operation = "inject_reader";
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["page-reader.js"] });
    operation = method === "advanceSwipePage" ? "advance_page" : "read_page";
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (methodName) => globalThis.__slaiAttendance?.[methodName]?.() ?? null,
      args: [method]
    });
    return result[0]?.result ?? null;
  } catch (error) {
    throw withErrorDetails(error, { operation, readerMethod: method });
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readerError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function withErrorDetails(error, details) {
  const wrapped = new Error(typeof error?.message === "string" ? error.message : "Unknown error");
  return Object.assign(wrapped, { name: error?.name || "Error", code: error?.code, details: { ...details, ...error?.details } });
}

function requirePortal(tab, code = "PORTAL_URL") {
  if (isAuthUrl(tab?.url)) throw readerError("AUTH_EXPIRED", "登录已过期");
  if (!isPortalUrl(tab?.url)) throw readerError(code, "学校页面地址无效");
}

async function waitForReader(tabId, method, accept, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let value = null;
  do {
    requirePortal(await chrome.tabs.get(tabId));
    value = await runReader(tabId, method);
    if (accept(value)) return value;
    await delay(250);
  } while (Date.now() < deadline);
  return value;
}

async function collectSwipePages(tabId, queryDate) {
  const records = new Map();
  const visited = new Set();
  let previous = null;
  let rowsRead = 0;
  let expectedTotal = null;
  for (let index = 0; index < 50; index++) {
    const deadline = Date.now() + 15000;
    let page = null;
    let lastReaderError = null;
    const details = { stage: "read_swipes", page: index + 1, rowsRead, expectedTotal, timeoutMs: 15000 };
    do {
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
        requirePortal(tab, "SWIPE_URL");
      } catch (error) {
        throw withErrorDetails(error, { ...details, operation: "get_tab" });
      }
      if (tab.status === 'complete') {
        try {
          const candidate = await runReader(tabId, 'extractSwipePage');
          lastReaderError = null;
          if (candidate?.pagination) details.currentPage = candidate.pagination.current;
          if (candidate?.ready && candidate.pagination && (!previous ||
            (candidate.pagination.current === previous.current + 1 && candidate.pagination.signature !== previous.signature))) {
            page = candidate;
            break;
          }
        } catch (error) {
          // Retry destroyed navigation contexts, but keep the actual exception.
          const diagnostic = diagnoseError(error);
          if (diagnostic.code !== "SCRIPT_CONTEXT_LOST") throw withErrorDetails(error, details);
          lastReaderError = error;
        }
      }
      await delay(250);
    } while (Date.now() < deadline);
    if (!page) throw lastReaderError ? withErrorDetails(lastReaderError, details) : readerError('SWIPE_TIMEOUT', '刷卡分页读取未完成', details);
    const meta = page.pagination;
    const pageDetails = { ...details, currentPage: meta.current, actualTotal: meta.total };
    if (visited.has(meta.signature) || (index === 0 && meta.current !== 1)) throw readerError('SWIPE_DUPLICATE', '刷卡分页重复', pageDetails);
    visited.add(meta.signature);
    if (expectedTotal === null) expectedTotal = meta.total;
    if (expectedTotal !== meta.total) throw readerError('SWIPE_CHANGED', '刷卡记录在读取期间变化', pageDetails);
    rowsRead += meta.rowCount;
    for (const record of page.records) {
      if (record.timestamp.startsWith(queryDate + ' ')) records.set(record.timestamp + '|' + record.direction, record);
    }
    if (!meta.hasNext) {
      if (expectedTotal !== null && rowsRead !== expectedTotal) throw readerError('SWIPE_INCOMPLETE', '刷卡记录未读取完整', { ...pageDetails, rowsRead, expectedTotal });
      return [...records.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }
    if (index === 49) break;
    previous = meta;
    // Each page is an additional school request, so never fetch pages concurrently.
    await delay(1500);
    try {
      if (!await runReader(tabId, 'advanceSwipePage')) throw readerError('SWIPE_NEXT', '无法翻到下一页');
    } catch (error) {
      throw withErrorDetails(error, { stage: "advance_swipes", operation: "advance_page", page: index + 2, currentPage: meta.current, rowsRead, expectedTotal });
    }
  }
  throw readerError('SWIPE_LIMIT', '刷卡页数超过安全上限', { stage: "read_swipes", page: 50, rowsRead, expectedTotal });
}

async function scrapeAttendance({ sourceTabId = null } = {}) {
  let tab;
  let closeWhenDone = false;
  let attendanceData = null;
  let summaryUpdatedAt = null;
  let stage = "open_portal";

  try {
    if (sourceTabId !== null) {
      tab = await chrome.tabs.get(sourceTabId);
    } else {
      tab = await chrome.tabs.create({ url: PORTAL_URL, active: false });
      closeWhenDone = true;
      tab = await waitForTab(tab.id, "slai.edu.cn");
    }

    requirePortal(tab);

    stage = "find_attendance";
    let attendanceUrl = await runReader(tab.id, "findAttendanceUrl");
    if (!attendanceUrl) {
      await chrome.tabs.update(tab.id, { url: PORTAL_URL });
      tab = await waitForTab(tab.id, "slai.edu.cn");
      requirePortal(tab);
      attendanceUrl = await runReader(tab.id, "findAttendanceUrl");
    }

    if (!attendanceUrl) throw readerError("ATTENDANCE_LINK_MISSING", "没有找到考勤入口");
    if (!isPortalUrl(attendanceUrl)) throw readerError("PORTAL_URL", "考勤地址无效");
    stage = "open_summary";
    if (tab.url !== attendanceUrl) {
      await chrome.tabs.update(tab.id, { url: attendanceUrl });
      tab = await waitForTab(tab.id, "/edu/acm/swipe/attendList");
    }

    stage = "read_summary";
    const data = await waitForReader(
      tab.id,
      "extractAttendance",
      (value) => value?.ready === true
    );
    if (!data || data.ready !== true || !Array.isArray(data.days)) {
      throw readerError("SUMMARY_MISSING", "考勤页面已打开，但没有识别到每日数据", { timeoutMs: 10000 });
    }

    const { studentNumber, ready, ...summary } = data;
    attendanceData = summary;
    summaryUpdatedAt = new Date().toISOString();
    if (!studentNumber) throw readerError("STUDENT_NUMBER_MISSING", "缺少查询明细所需的学号");
    stage = "open_swipes";
    let todaySwipes = [];
    const queryDate = localDateKey();
    if (studentNumber) {
      const recordsUrl = attendanceUrl.replace(
        /\/edu\/acm\/swipe\/attendList(?:[?#].*)?$/,
        `/edu/acm/swipe/list?userNo=${encodeURIComponent(studentNumber)}&swipeDate=${queryDate}`
      );
      if (recordsUrl !== attendanceUrl) {
        await chrome.tabs.update(tab.id, { url: recordsUrl });
        tab = await waitForTab(tab.id, "/edu/acm/swipe/list");
        stage = "read_swipes";
        todaySwipes = await collectSwipePages(tab.id, queryDate);
      } else {
        throw readerError("SWIPE_ROUTE_MISSING", "无法确定今日明细地址");
      }
    }

    stage = "save_state";
    const completedAt = new Date().toISOString();
    await saveState({
      schemaVersion: 4,
      lastCompleteToday: { date: queryDate, swipes: todaySwipes, updatedAt: completedAt },
      status: "ok",
      message: "考勤已更新",
      requiredSeconds: REQUIRED_SECONDS,
      ...attendanceData,
      todaySwipes,
      summaryUpdatedAt,
      updatedAt: completedAt
    });
  } catch (error) {
    const diagnostic = diagnoseError(error, { stage });
    const cached = await getState();
    const summaryOnly = attendanceData && diagnostic.code !== 'AUTH_EXPIRED';
    await saveState({
      ...cached,
      ...(summaryOnly ? { ...attendanceData, todaySwipes: [], summaryUpdatedAt } : {}),
      status: diagnostic.code === 'AUTH_EXPIRED' ? 'auth' : summaryOnly ? 'partial' : 'error',
      diagnostic
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
    diagnostic: null,
    errorCode: "",
    message: "请在学校页面完成登录"
  });
  await chrome.tabs.create({ url: PORTAL_URL, active: true });
}

chrome.runtime.onInstalled.addListener(async () => {
  await migrateStorage();
  await initializeBridge();
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  await openWidget();
  await refreshAttendance();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateStorage();
  await initializeBridge();
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  await openWidget();
  await refreshAttendance();
});

chrome.action.onClicked.addListener(() => openWidget());
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BRIDGE_ALARM) { ensureRemoteRefresh(); queueBridgePush(await getState()); return; }
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
  if (message?.type === "get-bridge") return respond(getBridgeInfo, "configure_bridge");
  if (message?.type === "set-bridge") return respond(() => configureBridge(message), "configure_bridge");
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
