// Shared school collector. Host provides chrome.tabs/scripting, getState and saveState.
// Session URLs and student numbers live only in this collection call.
let refreshPromise = null;

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

const { localDateKey, attendanceDateKey, attendanceWindow, attendanceQueryDates, timestampMs } = globalThis.__slaiTime;

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

async function collectSwipePages(tabId, queryDate, budget = { pages: 0 }, window = attendanceWindow(queryDate)) {
  const records = new Map();
  const visited = new Set();
  let previous = null;
  let rowsRead = 0;
  let expectedTotal = null;
  for (let index = 0; index < 50; index++) {
    if (budget.pages >= 50) break;
    const deadline = Date.now() + 15000;
    let page = null;
    let lastReaderError = null;
    const details = { stage: "read_swipes", page: budget.pages + 1, rowsRead, expectedTotal, timeoutMs: 15000 };
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
    budget.pages++;
    const pageDetails = { ...details, currentPage: meta.current, actualTotal: meta.total };
    if (visited.has(meta.signature) || (index === 0 && meta.current !== 1)) throw readerError('SWIPE_DUPLICATE', '刷卡分页重复', pageDetails);
    visited.add(meta.signature);
    if (expectedTotal === null) expectedTotal = meta.total;
    if (expectedTotal !== meta.total) throw readerError('SWIPE_CHANGED', '刷卡记录在读取期间变化', pageDetails);
    rowsRead += meta.rowCount;
    for (const record of page.records) {
      const at = timestampMs(record.timestamp);
      if (at >= window.start && at < window.end) records.set(record.timestamp + '|' + record.direction, record);
    }
    if (!meta.hasNext) {
      if (expectedTotal !== null && rowsRead !== expectedTotal) throw readerError('SWIPE_INCOMPLETE', '刷卡记录未读取完整', { ...pageDetails, rowsRead, expectedTotal });
      return [...records.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }
    if (budget.pages >= 50) break;
    previous = meta;
    // Each page is an additional school request, so never fetch pages concurrently.
    await delay(1500);
    try {
      const advanced = await runReader(tabId, 'advanceSwipePage');
      if (advanced?.errorCode === 'SWIPE_SCRIPT_URL') throw readerError('SWIPE_SCRIPT_URL', '分页控件使用未支持的脚本链接');
      if (advanced !== true) throw readerError('SWIPE_NEXT', '无法翻到下一页');
    } catch (error) {
      throw withErrorDetails(error, { stage: "advance_swipes", operation: "advance_page", page: budget.pages + 1, currentPage: meta.current, rowsRead, expectedTotal });
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
    const queryDate = attendanceDateKey();
    const window = attendanceWindow(queryDate);
    const queried = new Set();
    const records = new Map();
    const budget = { pages: 0 };
    // A school summary can switch calendar months at midnight, five hours
    // before our attendance month. Keep only a correctly labelled summary.
    if (summary.month === localDateKey().slice(0, 7) && summary.month !== queryDate.slice(0, 7)) {
      const cached = await getState();
      const matching = cached.month === queryDate.slice(0, 7);
      attendanceData = { month: queryDate.slice(0, 7), days: matching ? cached.days : [] };
      summaryUpdatedAt = matching ? cached.summaryUpdatedAt : null;
    }
    // Re-evaluate civil dates after each query: a refresh can cross midnight.
    // The budget covers BOTH queries, not fifty pages per date.
    while (true) {
      if (attendanceDateKey() !== queryDate) throw readerError("ATTENDANCE_DAY_CHANGED", "读取期间已跨过05:00", { stage: "read_swipes" });
      const civilDate = attendanceQueryDates().find(value => !queried.has(value));
      if (!civilDate) break;
      if (budget.pages >= 50) throw readerError("SWIPE_LIMIT", "刷卡页数超过安全上限", { stage: "read_swipes", page: 50 });
      if (queried.size) await delay(1500);
      stage = "open_swipes";
      const recordsUrl = attendanceUrl.replace(
        /\/edu\/acm\/swipe\/attendList(?:[?#].*)?$/,
        `/edu/acm/swipe/list?userNo=${encodeURIComponent(studentNumber)}&swipeDate=${civilDate}`
      );
      if (recordsUrl !== attendanceUrl) {
        await chrome.tabs.update(tab.id, { url: recordsUrl });
        tab = await waitForTab(tab.id, "/edu/acm/swipe/list");
        stage = "read_swipes";
        for (const record of await collectSwipePages(tab.id, civilDate, budget, window)) records.set(record.timestamp + "|" + record.direction, record);
        queried.add(civilDate);
      } else {
        throw readerError("SWIPE_ROUTE_MISSING", "无法确定今日明细地址");
      }
    }

    stage = "save_state";
    const completedAt = new Date().toISOString();
    if (attendanceDateKey(new Date(completedAt)) !== queryDate) throw readerError("ATTENDANCE_DAY_CHANGED", "读取期间已跨过05:00", { stage: "save_state" });
    const todaySwipes = [...records.values()].filter(record => timestampMs(record.timestamp) <= Date.parse(completedAt)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    await saveState({
      schemaVersion: 5,
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

