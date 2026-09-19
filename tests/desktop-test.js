const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const fixture = require("./desktop-fixture");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 392, height: 590 }, colorScheme: "light", deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(fixture.bootstrap, { now: fixture.now, state: fixture.state });
    await page.goto(pathToFileURL(path.join(root, "extension/widget.html")).href);
    await page.locator("#todayDuration").filter({ hasText: "03:20:00" }).waitFor();
    assert.equal(await page.locator("#calendarView").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".calendar-day").count(), 30);
    assert.equal(await page.locator(".calendar-day[aria-current=date]").innerText(), "19");
    assert.equal(await page.locator('.calendar-day[data-date="2026-09-01"]').getAttribute("data-qualification"), "short");
    assert.equal(await page.locator('.calendar-day[data-date="2026-09-02"]').getAttribute("data-qualification"), "met");
    assert.equal(await page.locator('.calendar-day[data-date="2026-09-06"]').getAttribute("data-qualification"), "met", "Qualified holidays also get green dots");
    assert.match(await page.locator('.calendar-day[data-date="2026-09-06"]').getAttribute("aria-label"), /休息日.*已达标/);
    for (const date of ["2026-09-05", "2026-09-19", "2026-09-20"]) assert.equal(await page.locator(`.calendar-day[data-date="${date}"]`).getAttribute("data-qualification"), "");
    assert.match(await page.locator('.calendar-day[data-date="2026-09-02"]').getAttribute("aria-label"), /已达标/);
    const segments = await page.evaluate(() => globalThis.__slaiTime.attendanceSeconds(currentState, viewNow()).segments);
    assert.equal(segments.length, 2);
    assert.equal(segments.reduce((sum, item) => sum + (item.end - item.start) / 1000, 0), 12000);
    assert.match(await page.locator("#timelineCanvas").getAttribute("aria-label"), /09:00:00—10:20:00.*12:20:00—14:20:00/);
    assert.equal(await page.locator("#progressRing").getAttribute("aria-valuenow"), "12000");
    assert.equal(await page.locator(".brand img").evaluate(img => img.complete && img.naturalWidth), 128);
    assert.equal(await page.locator("#todayDuration").evaluate(el => getComputedStyle(el).color), "rgb(216, 107, 159)");
    for (const width of [320, 360, 392, 410, 640]) {
      await page.setViewportSize({ width, height: 590 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      assert.equal(await page.locator("#dayList").evaluate(el => getComputedStyle(el).overflowY), "visible");
    }
    await page.setViewportSize({ width: 392, height: 590 });
    await page.locator('[data-date="2026-09-18"].calendar-day').click();
    assert.equal(await page.locator("#dayDialog").evaluate(el => el.open), true);
    assert.equal(await page.locator("#dayDialogDuration").innerText(), "06:10:00");
    await page.keyboard.press("Escape");
    await page.locator('[data-date="2026-09-19"].calendar-day').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.date), "2026-09-20");
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#dayDialogSource").innerText(), /尚未开始/);
    await page.keyboard.press("Escape");
    await page.locator("#listView").click();
    assert.equal(await page.locator(".day-row").count(), 30);
    assert.equal(await page.locator("#todayRowDuration").innerText(), "03:20:00");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#listView").getAttribute("aria-pressed") === "true");
    await page.locator("#calendarView").click();
    await page.locator('[data-date="2026-09-19"].calendar-day').click();
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.mouse.move(0, 0);
    await fs.mkdir(path.join(root, "test-results"), { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator(".calendar-day.selected").evaluate(el => getComputedStyle(el).color), "rgb(25, 22, 28)");
      const dots = await page.evaluate(() => ["met", "short"].map(status => {
        const style = getComputedStyle(document.querySelector(`[data-qualification="${status}"]`), "::after");
        return { size: style.width, color: style.backgroundColor };
      }));
      assert.deepEqual(dots.map(dot => dot.size), ["7px", "7px"]);
      assert.deepEqual(dots.map(dot => dot.color), theme === "light" ? ["rgb(20, 131, 59)", "rgb(192, 130, 0)"] : ["rgb(99, 220, 145)", "rgb(255, 203, 69)"]);
      await page.screenshot({ path: path.join(root, "test-results", `desktop-${theme}.png`), fullPage: true });
      if (process.env.UPDATE_DEMO === "1") await page.screenshot({ path: path.join(root, "docs", theme === "light" ? "demo.png" : "demo-dark.png"), fullPage: true });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator("#refresh").evaluate(el => getComputedStyle(el).animationName), "none");
    await page.evaluate(() => window.__fixtureNotify({ type: "attendance-state", state: {
      ...window.__fixtureState,
      days: [...window.__fixtureState.days, { date: "2026-09-19", weekday: "周六", type: "法定节假日", duration: "0" }],
      todaySwipes: [{ timestamp: "2026-09-19 07:00:00", direction: "进门" }, { timestamp: "2026-09-19 13:00:00", direction: "出门" }]
    } }));
    assert.equal(await page.locator('.calendar-day[data-date="2026-09-19"]').getAttribute("data-qualification"), "met", "Current-day holiday at exactly six hours also qualifies");
    assert.deepEqual(errors, []);
    console.log("Passed: calendar/list persistence, date detail keyboard access, one-scroll layout, exact interval/ring totals, both themes, HiDPI assets and no browser errors.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
