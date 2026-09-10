const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { unzipSync } = require("fflate");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "slai-install-test-"));
  const extension = path.join(temporary, "extension");
  fs.mkdirSync(extension);
  const data = unzipSync(fs.readFileSync(path.join(root, "dist", `slai-attendance-widget-v${require("../package.json").version}.zip`)));
  assert.deepEqual(Object.keys(data).sort(), require("../release-files.json").archive.sort());
  for (const [name, bytes] of Object.entries(data)) {
    assert.equal(path.basename(name), name);
    fs.writeFileSync(path.join(extension, name), bytes);
  }
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
      channel: "chromium", headless: true, timezoneId: "Asia/Shanghai",
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        "--host-resolver-rules=MAP stu.slai.edu.cn 127.0.0.1, MAP sts.slai.edu.cn 127.0.0.1"]
    });
    await context.route("https://stu.slai.edu.cn/**", (route) => route.fulfill({ status: 302, headers: { location: "https://sts.slai.edu.cn/signin" }, body: "" }));
    await context.route("https://sts.slai.edu.cn/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>模拟学校登录页</h1>" }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).hostname;
    await worker.evaluate(async () => {
      const deadline = Date.now() + 35000;
      while ((await getState()).status === "loading" && Date.now() < deadline) await delay(50);
      if (refreshPromise) await refreshPromise;
    });
    // Create the simulated login tab through Playwright so its initial navigation
    // is intercepted before Chrome starts a request from an extension-created tab.
    const loginPage = await context.newPage();
    await loginPage.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>模拟学校登录页</h1>" }));
    await loginPage.goto("https://sts.slai.edu.cn/signin");
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "https://sts.slai.edu.cn/signin" });
      await scrapeAttendance({ sourceTabId: tab.id });
    });
    const state = await worker.evaluate(async () => (await chrome.storage.local.get("attendanceState")).attendanceState);
    assert.equal(state.status, "auth");
    assert.equal(state.nextRefreshAt, null);
    assert(!("sourceUrl" in state) && !("studentNumber" in state));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/widget.html`);
    await page.locator("#authCard:not(.hidden)").waitFor();
    assert.match(await page.locator("#nextRefresh").innerText(), /自动刷新已暂停/);
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    assert.equal(version, require("../package.json").version);
    console.log("ZIP installation passed in an isolated Chromium profile; school requests were simulated.");
  } finally {
    if (context) await context.close();
    // Only remove this test's verified, freshly-created temporary directory.
    assert(path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("slai-install-test-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
