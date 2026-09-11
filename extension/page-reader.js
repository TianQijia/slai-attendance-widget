(() => {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const absoluteUrl = (value) => {
    try {
      return new URL(value, location.href).href;
    } catch {
      return null;
    }
  };

  function findAttendanceUrl() {
    const bodyText = clean(document.body?.innerText);
    if (bodyText.includes("月度考勤统计汇总") && document.querySelector("table")) {
      return location.href;
    }

    const attendanceFrame = document.querySelector('iframe[src*="/edu/acm/swipe/attendList"]');
    if (attendanceFrame) return absoluteUrl(attendanceFrame.getAttribute("src"));

    const links = Array.from(document.querySelectorAll("a[href]"));
    const exact = links.find((link) => clean(link.textContent) === "学生考勤统计查询");
    const fuzzy = links.find((link) => clean(link.textContent).includes("考勤统计查询"));
    const link = exact || fuzzy || Array.from(document.querySelectorAll("a")).find((item) =>
      clean(item.textContent).includes("考勤统计查询")
    );
    const href = link?.getAttribute("href");
    if (href && href !== "#" && !href.startsWith("javascript:")) return absoluteUrl(href);

    const onclick = link?.getAttribute("onclick") || "";
    const route = onclick.match(/url\s*:\s*['\"]([^'\"]+)/)?.[1];
    if (!route) return null;

    const mainFrame = document.querySelector('iframe[src*="/sys/user/main"]');
    const sessionPath = mainFrame?.getAttribute("src")?.match(/^(\/a(?:;JSESSIONID=[^/]+)?)/)?.[1];
    return absoluteUrl(`${sessionPath || "/a"}${route.startsWith("/") ? route : `/${route}`}`);
  }

  function extractAttendance() {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const durationPattern = /^(?:\d{1,3}:[0-5]\d:[0-5]\d|0)$/;
    const monthPattern = /^\d{4}-\d{2}$/;
    const daysByDate = new Map();

    for (const row of document.querySelectorAll("tr")) {
      const cells = Array.from(row.querySelectorAll("th,td")).map((cell) => clean(cell.innerText));
      const dateIndex = cells.findIndex((cell) => datePattern.test(cell));
      if (dateIndex < 0) continue;

      const durationIndex = cells.findIndex((cell, index) => index > dateIndex && durationPattern.test(cell));
      if (durationIndex < 0) continue;

      const type = cells.find((cell) => /^(?:工作日|法定节假日|休息日|调休日)$/.test(cell)) || "";
      const weekday = cells.find((cell) => /^周[一二三四五六日天]$/.test(cell)) || "";
      const qualifiedCell = cells.slice(durationIndex + 1).find((cell) => /^(?:是|否)$/.test(cell));
      const record = {
        date: cells[dateIndex],
        weekday,
        type,
        duration: cells[durationIndex],
        qualified: qualifiedCell === "是"
      };

      const previous = daysByDate.get(record.date);
      if (!previous || cells.length > previous.cellCount) {
        daysByDate.set(record.date, { ...record, cellCount: cells.length });
      }
    }

    const monthValues = Array.from(document.querySelectorAll("input,select"))
      .map((element) => clean(element.value))
      .filter((value) => monthPattern.test(value));
    const sortedDays = Array.from(daysByDate.values())
      .map(({ cellCount, ...day }) => day)
      .sort((a, b) => a.date.localeCompare(b.date));
    const inferredMonth = sortedDays.find((day) => day.date)?.date.slice(0, 7) || "";
    const month = monthValues[0] || inferredMonth;
    const days = month ? sortedDays.filter((day) => day.date.startsWith(month)) : sortedDays;

    const pageText = clean(document.body?.innerText);
    const studentNumber = pageText.match(/学号[：:]?\s*(\d{6,})/)?.[1] || "";
    // An explicitly empty, loaded monthly table is valid at the start of a month.
    const busy = Array.from(document.querySelectorAll(".layui-table-loading, [aria-busy=\"true\"]")).some(element => getComputedStyle(element).display !== "none");
    const emptyReady = !busy && !!month && !!document.querySelector("table") && pageText.includes("月度考勤统计汇总") && /暂无数据|暂无记录|无记录|无数据/.test(pageText);
    return {
      ready: days.length > 0 || emptyReady,
      month,
      days,
      studentNumber
    };
  }

  function swipeRows() {
    // Layui also renders fixed-column copies. Count only its main table.
    const main = document.querySelector('.layui-table-main');
    return Array.from((main || document).querySelectorAll('tr'));
  }

  function extractSwipeRecords() {
    const timePattern = /^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/;
    const records = [];

    for (const row of swipeRows()) {
      const cells = Array.from(row.querySelectorAll("td")).map((cell) => clean(cell.innerText));
      // 学校的月度考勤只使用“闸机-…”校园道闸；“宿舍_道闸…”不计入。
      const campusGate = cells.find((cell) => /^闸机[-_]/.test(cell) && !cell.includes("宿舍"));
      const timestamp = cells.find((cell) => timePattern.test(cell));
      const direction = cells.find((cell) => /^(?:进门|出门)$/.test(cell));
      if (!campusGate || !timestamp || !direction) continue;
      records.push({
        direction,
        timestamp
      });
    }

    return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  function extractSwipePage() {
    const records = extractSwipeRecords();
    const pageText = clean(document.body?.innerText);
    const pager = document.querySelector('.layui-laypage, .pagination, .pager, [aria-label="分页"]');
    const current = Number(clean(pager?.querySelector('.layui-laypage-curr, .active, [aria-current="page"]')?.textContent)) ||
      Number(document.querySelector('[name="pageNo"]')?.value) ||
      Number(new URL(location.href).searchParams.get('pageNo')) || 1;
    const countText = [clean(pager?.querySelector('.layui-laypage-count')?.textContent), clean(pager?.textContent), pageText]
      .find((text) => /共\s*\d+\s*条/.test(text)) || '';
    const total = Number(countText.match(/共\s*(\d+)\s*条/)?.[1]);
    const rowTimes = swipeRows().map((row) =>
      clean(row.textContent).match(/\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d/)?.[0]
    ).filter(Boolean);
    const next = nextSwipeControl(current);
    const loading = Array.from(document.querySelectorAll('.layui-table-init')).some((el) => el.getClientRects().length > 0);
    return {
      ready: !loading && (records.length > 0 || /共\s*\d+\s*条/.test(countText)),
      records,
      pagination: {
        current, total: Number.isFinite(total) ? total : null,
        rowCount: rowTimes.length, signature: JSON.stringify(rowTimes),
        hasNext: Boolean(next)
      }
    };
  }

  function nextSwipeControl(current) {
    const controls = Array.from(document.querySelectorAll('.layui-laypage a, .pagination a, .pagination button, .pager a, .pager button, a[rel="next"], [aria-label="分页"] a, [aria-label="分页"] button'));
    const enabled = controls.filter((el) => !el.closest('.layui-disabled, .disabled, [aria-disabled="true"]') && !el.disabled);
    const next = enabled.find((el) => el.classList.contains('layui-laypage-next') || el.rel === 'next' || /^(?:下一页|下页)\s*[›»>]*$/.test(clean(el.textContent)) ||
      /^(?:下一页|下页)$/.test(el.getAttribute('title') || el.getAttribute('aria-label') || ''));
    if (next) return next;
    // Numbered links are useful when the portal renders only numeric navigation.
    return enabled.find((el) => clean(el.textContent) === String(current + 1)) || null;
  }

  function advanceSwipePage() {
    const page = extractSwipePage();
    const next = nextSwipeControl(page.pagination.current);
    if (!next) return false;
    // Use the portal's own control, preserving its form filters and session.
    const href = next.getAttribute('href');
    if (href && !href.startsWith('javascript:') && href !== '#') {
      const target = new URL(href, location.href);
      if (target.origin !== location.origin || target.pathname !== location.pathname) return false;
    }
    next.click();
    return true;
  }

  globalThis.__slaiAttendance = { findAttendanceUrl, extractAttendance, extractSwipeRecords, extractSwipePage, advanceSwipePage };
})();
