const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route("**/*", route => { requests.push(route.request().url()); return route.fulfill({ contentType: "text/html", body: "<body></body>" }); });
    const url = "https://stu.slai.edu.cn/a/edu/acm/swipe/list";
    await page.goto(url);
    async function control(html) {
      await page.setContent(`<div class="pagination"><span class="active">1</span>${html}</div><div>共23条</div>`);
      await page.addScriptTag({ path: path.join(__dirname, "../extension/page-reader.js") });
      await page.evaluate(() => {
        window.targetClicks = 0; window.delegatedClicks = 0;
        document.querySelector(".pagination").addEventListener("click", () => { window.delegatedClicks++; });
        document.querySelector(".pagination a, .pagination button").addEventListener("click", () => { window.targetClicks++; });
      });
    }
    for (const href of ["javascript:;", "javascript: ; ; ", "javascript:void(0);", "JaVaScRiPt: void ( 0 )", "javascript:void 0", "javascript:"]) {
      await control(`<a href="${href}">下一页</a>`);
      assert.equal(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), true);
      assert.deepEqual(await page.evaluate(() => [targetClicks, delegatedClicks]), [1, 1]);
      assert.equal(await page.locator(".pagination a").getAttribute("href"), href);
      assert.equal(page.url(), url);
      // The temporary cancel listener must not remain on the school control.
      assert.equal(await page.evaluate(() => document.querySelector("a").dispatchEvent(new Event("click", { cancelable: true }))), true);
    }
    for (const href of ["javascript:window.PRIVATE_FIXTURE=true", "javascript:VOID(0)", "javascript:alert(0)"]) {
      await control(`<a href="${href}">下一页</a>`);
      assert.deepEqual(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), { errorCode: "SWIPE_SCRIPT_URL" });
      assert.equal(await page.evaluate(() => window.targetClicks), 0);
      assert.equal(await page.evaluate(() => window.PRIVATE_FIXTURE), undefined);
    }
    for (const html of ['<button type="button">下一页</button>', '<a href="#">下一页</a>']) {
      await control(html);
      assert.equal(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), true);
      assert.deepEqual(await page.evaluate(() => [targetClicks, delegatedClicks]), [1, 1]);
    }
    for (const html of ['<button disabled>下一页</button>', '<a class="disabled" href="javascript:;">下一页</a>', '<a aria-disabled="true" href="?pageNo=2">下一页</a>', '<a href="https://example.invalid/">下一页</a>', '<a href="/different">下一页</a>']) {
      await control(html);
      assert.equal(await page.evaluate(() => __slaiAttendance.advanceSwipePage()), false);
      assert.equal(await page.evaluate(() => window.targetClicks), 0);
    }
    await control('<a href="?pageNo=2">下一页</a>');
    await Promise.all([page.waitForURL(url + "?pageNo=2"), page.evaluate(() => __slaiAttendance.advanceSwipePage())]);
    assert.deepEqual(requests, [url, url + "?pageNo=2"]);
    console.log("Passed: no-op links preserve target/delegated events, meaningful script URLs are diagnosed, ordinary links navigate, buttons and disabled last-page controls behave correctly.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
