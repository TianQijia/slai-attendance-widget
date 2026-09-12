const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 360 : 440, height: 900 } });
      // Load the shipped layouts, styles and shared renderer without the
      // transport bootstraps so dates and source snapshots are deterministic.
      const html = await fs.readFile(path.join(root, mobile ? "companion/viewer.html" : "extension/widget.html"), "utf8");
      await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, ""));
      await page.addStyleTag({ path: path.join(root, "extension/widget.css") });
      for (const file of ["error-utils.js", "time-utils.js", "state-utils.js", "report-utils.js", "view.js"]) await page.addScriptTag({ path: path.join(root, "extension", file) });
      await page.evaluate(value => { mobileView = value; }, mobile);
      const renderAt = (date, state) => page.evaluate(({ date, state }) => { viewNow = () => Date.parse(date); render(state); }, { date, state });
      const labels = () => page.locator(".day-date strong").allTextContents();
      const row = label => page.locator(".day-row").filter({ has: page.locator(".day-date strong", { hasText: new RegExp(`^${label}$`) }) });
      const march = { status: "ok", month: "2030-03", days: [
        { date: "2030-03-27", type: "工作日", duration: "06:00:00" },
        { date: "2030-03-28", type: "工作日", duration: "03:00:00" },
        { date: "2030-04-01", type: "工作日", duration: "06:00:00" }
      ], updatedAt: "2030-03-31T15:59:59Z", summaryUpdatedAt: "2030-03-31T15:59:59Z", lastCompleteToday: {
        date: "2030-03-31", updatedAt: "2030-03-31T15:59:59Z", swipes: [{ timestamp: "2030-03-31 23:00:00", direction: "进门" }]
      } };
      await renderAt("2030-03-31T23:59:59+08:00", march);
      assert.equal(await page.locator("#monthTitle").innerText(), "2030 年 3 月");
      assert.equal((await labels()).length, 31); assert.equal((await labels()).at(-1), "3/31");
      assert.equal(await page.locator("#monthSummary").innerText(), "1 / 2 天达标 · 历史");
      assert.match(await row("3/29").innerText(), /待同步[\s\S]*--:--:--/);
      assert.equal(await page.locator("#todayDuration").innerText(), "00:59:59");
      await page.evaluate(() => { viewNow = () => Date.parse("2030-04-01T00:00:01+08:00"); updateNextRefresh(); });
      assert.equal(await page.locator("#monthTitle").innerText(), "2030 年 3 月");
      assert(!(await labels()).includes("4/1"), "Cached March history must never acquire an April row at midnight");
      assert.equal(await page.locator("#monthLabel").innerText(), "历史记录 · 本月待同步");
      assert.equal(await page.locator(".day-row.today").count(), 0);
      assert.equal(await page.locator("#todayDuration").innerText(), "--:--:--");
      assert.equal(await page.locator("#monthSummary").innerText(), "1 / 2 天达标 · 历史");

      await renderAt("2030-04-01T12:00:00+08:00", { status: "ok", month: "2030-04", days: [], updatedAt: "2030-04-01T04:00:00Z",
        lastCompleteToday: { date: "2030-04-01", updatedAt: "2030-04-01T04:00:00Z", swipes: [] } });
      assert.equal(await page.locator("#monthTitle").innerText(), "2030 年 4 月");
      assert.equal(await page.locator("#monthLabel").innerText(), "本月记录");
      assert.equal((await labels()).length, 30); assert.equal((await labels()).at(-1), "4/30");
      assert.equal(await page.locator(".day-row.today .day-date strong").innerText(), "4/1");
      assert.equal(await page.locator("#todayDuration").innerText(), "00:00:00");
      assert.match(await row("4/2").innerText(), /未到日期[\s\S]*--:--:--/);

      await renderAt("2030-04-27T12:00:00+08:00", { status: "partial", month: "2030-04", days: [
        { date: "2030-04-25", type: "工作日", duration: "06:00:00" },
        { date: "2030-04-27", type: "工作日", duration: "00:00:00" }
      ] });
      assert.match(await row("4/26").innerText(), /待同步[\s\S]*--:--:--/);
      for (const date of ["4/28", "4/29", "4/30"]) assert.match(await row(date).innerText(), /未到日期[\s\S]*--:--:--/);
      assert.equal(await page.locator("#monthSummary").innerText(), "1 / 1 天达标 · 历史", "Missing days and today must not change the historical denominator");
      for (const width of mobile ? [320, 360, 390] : [440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Calendar overflow at ${width}px`);
      }
      await fs.mkdir(path.join(root, "test-results"), { recursive: true });
      await page.locator("#dayList").evaluate(list => { list.scrollTop = list.scrollHeight; });
      await page.screenshot({ path: path.join(root, "test-results", `calendar-${mobile ? "mobile" : "desktop"}.png`), fullPage: true });

      for (const [month, count] of [["2031-02", 28], ["2032-02", 29], ["2030-12", 31]]) {
        await renderAt(`${month}-27T12:00:00+08:00`, { status: "loading", month, days: [] });
        assert.equal((await labels()).length, count);
        assert.equal((await labels()).at(-1), `${Number(month.slice(5))}/${count}`);
        assert.equal(await page.locator("#monthSummary").innerText(), "0 / 0 天达标 · 历史");
      }
      await page.evaluate(() => { viewNow = () => Date.parse("2031-01-01T00:00:01+08:00"); updateNextRefresh(); });
      assert.equal(await page.locator("#monthTitle").innerText(), "2030 年 12 月");
      assert(!(await labels()).includes("1/1"));
      await renderAt("2031-01-01T12:00:00+08:00", { status: "loading", days: [] });
      assert.equal(await page.locator("#monthTitle").innerText(), "2031 年 1 月");
      assert.equal((await labels()).length, 31);
      await page.close();
    }
    console.log("Passed: desktop/mobile complete month calendars, midnight and year rollover, first sync, missing/future placeholders, leap years, unchanged qualification counts and 320/360/390px layouts.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
