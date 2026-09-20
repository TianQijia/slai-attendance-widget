const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { unzipSync } = require('fflate');
const { swipeHtml, swipeData } = require('./swipe-fixture');
const { buildIOS } = require('../scripts/build-ios');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const fromZip = process.argv.includes('--zip');
const output = path.join(root, 'dist', `ios-v${version}`);
if (!fromZip) buildIOS();
const archive = unzipSync(fs.readFileSync(path.join(output, `slai-attendance-safari-v${version}.zip`)));
assert.deepEqual(Object.keys(archive).sort(), [...require('../release-files.json').iosArchive].sort());
const packaged = Buffer.from(archive['slai-attendance-safari.user.js']);
assert.deepEqual(packaged, fs.readFileSync(path.join(output, 'slai-attendance-safari.user.js')));
const bundle = packaged.toString('utf8');
assert.match(bundle, /@inject-into\s+content/);
assert(!/document\.cookie|chrome\.cookies|@require\s|@connect\s|@noframes/.test(bundle));

function fixtureResponse(route, options) {
  if (options.contentType?.startsWith('text/html')) options.body = '<meta charset="utf-8">' + options.body;
  return route.fulfill(options);
}

async function verifyCookieTransport(browser) {
  // Interception precedes cookie insertion in WebKit. Check real wire headers
  // against a loopback server, never by faking a Cookie header in the route.
  // https://playwright.dev/docs/next/network#headers-owned-by-the-network-stack
  const received = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/login') {
      response.writeHead(302, { location: '/panel', 'set-cookie': 'slai_probe=synthetic; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600' });
      response.end();
    } else {
      if (request.url === '/check') received.push(/slai_probe=synthetic/.test(request.headers.cookie || ''));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(request.url === '/panel' ? '<iframe src="/check"></iframe>' : '<p>Synthetic cookie probe</p>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext();
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const login = await context.newPage();
    await login.goto(origin + '/login');
    await login.close();
    const reopened = await context.newPage();
    await reopened.goto(origin + '/panel');
    assert.deepEqual(received, [true, true], 'Same-origin iframe requests carry HttpOnly login cookies after a real redirect and after reopening a tab');
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function verify(engine, name) {
  // All responses are fulfilled below. Any unhandled navigation is blocked by
  // a closed loopback proxy so redirects can never reach the real school.
  const browser = await engine.launch({ headless: true, proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' }, ...(name === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined } : {}) });
  try {
    await verifyCookieTransport(browser);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
    const store = new Map();
    const writes = [], requests = [], pageErrors = [];
    let mode = 'normal', rejectRead = false, rejectWrite = false;
    await context.exposeBinding('fixtureStorage', async (_source, operation, key, value) => {
      if ((operation === 'get' && rejectRead) || (operation === 'set' && rejectWrite)) throw new Error('PRIVATE_FIXTURE session account cookie');
      if (operation === 'get') return store.has(key) ? structuredClone(store.get(key)) : value;
      assert.equal(operation, 'set');
      assert(['attendance-state-v5', 'desktop-view', 'school-mode'].includes(key));
      store.set(key, structuredClone(value)); writes.push(structuredClone(value));
    });
    await context.addInitScript({ content: `
      window.GM = { getValue: (key, value) => window.fixtureStorage('get', key, value), setValue: (key, value) => window.fixtureStorage('set', key, value) };
      const FixtureDate = Date;
      const fixtureOffset = new FixtureDate('2030-04-08T12:00:00+08:00').getTime() - FixtureDate.now();
      window.Date = class extends FixtureDate {
        constructor(...args) { super(...(args.length ? args : [FixtureDate.now() + fixtureOffset])); }
        static now() { return FixtureDate.now() + fixtureOffset; }
      };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.fixtureCopied = text; } } });
      ${bundle}
    ` });
    const portalBody = '<!doctype html><meta name="viewport" content="width=1280"><h1>虚构学校首页</h1><a href="/a/edu/acm/swipe/attendList">学生考勤统计查询</a><a href="https://sts.slai.edu.cn/signin">虚构登录入口</a>';
    await context.route('**/*', async route => {
      const fulfill = options => fixtureResponse(route, options);
      const req = route.request(), url = new URL(req.url());
      assert(['stu.slai.edu.cn', 'sts.slai.edu.cn', 'unavailable.invalid'].includes(url.hostname), 'No unrelated service may be requested');
      const frameRequest = req.frame().parentFrame() !== null;
      if (url.hostname === 'unavailable.invalid') return fulfill({ contentType: 'text/html', body: '<h1>虚构不支持页面</h1>' });
      if (url.hostname === 'sts.slai.edu.cn') return fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><h1>虚构学校登录</h1><a href="https://stu.slai.edu.cn/fixture-login">完成虚构登录</a>' });
      if (url.pathname === '/fixture-login') return fulfill({ contentType: 'text/html', headers: { 'set-cookie': 'slai_fixture=synthetic; Path=/; HttpOnly; Secure; SameSite=Lax' }, body: '<script>location.replace("https://stu.slai.edu.cn/")</script>' });
      if (frameRequest) {
        requests.push({ path: url.pathname, page: Number(url.searchParams.get('pageNo') || 1), at: Date.now() });
        if (mode === 'auth' || (mode === 'auth-swipes' && url.pathname.endsWith('/list'))) return fulfill({ contentType: 'text/html', body: '<script>location.replace("https://sts.slai.edu.cn/signin")</script>' });
        if (mode === 'cross-origin') return fulfill({ contentType: 'text/html', body: '<script>location.replace("https://unavailable.invalid/")</script>' });
        if (mode === 'load-error') return fulfill({ contentType: 'text/html', body: '<script>frameElement.dispatchEvent(new Event("error"))</script>' });
        assert((await context.cookies(req.url())).some(cookie => cookie.name === 'slai_fixture' && cookie.httpOnly && cookie.secure));
      }
      if (url.pathname.endsWith('/attendList')) return fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>月度考勤统计汇总</h1><input value="2030-04"><p>学号: 000000000</p><table><tr><td>2030-04-08</td><td>周一</td><td>工作日</td><td>02:00:00</td></tr></table>' });
      if (url.pathname.endsWith('/list')) {
        const fixtureMode = ['wide', 'empty', 'changed'].includes(mode) ? mode : 'normal';
        if (req.resourceType() === 'document') {
          assert.equal(url.searchParams.get('pageSize'), '90');
          let body = swipeHtml('2030-04-08', { mode: fixtureMode, pageSizeControl: mode === 'wide', emptyCount: false, emptyLabel: '', emptyPager: false });
          if (mode === 'script-url') body = body.replaceAll('href="javascript:;"', 'href="javascript:window.PRIVATE_FIXTURE=true"');
          return fulfill({ contentType: 'text/html; charset=utf-8', body });
        }
        if (mode === 'timeout' || mode === 'interrupt') return fulfill({ status: 503, body: 'Synthetic unavailable page' });
        return fulfill({ json: swipeData(Number(url.searchParams.get('pageNo') || 1), fixtureMode, Number(url.searchParams.get('pageSize') || 10)) });
      }
      const headers = mode === 'blocked' ? { 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'none'; img-src data:; frame-src 'none'" } : { 'content-security-policy': "script-src 'unsafe-inline'; style-src 'none'; img-src data:; frame-src 'self' https://sts.slai.edu.cn https://unavailable.invalid" };
      return fulfill({ contentType: 'text/html; charset=utf-8', headers, body: portalBody });
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push({ name: error.name, message: error.message }));
    const panel = page.locator('#slai-safari-panel');
    const state = () => structuredClone(store.get('attendance-state-v5'));
    const pages = () => requests.filter(item => item.path.endsWith('/list')).map(item => item.page);
    async function refresh(expected) {
      requests.length = 0;
      await page.locator('#refresh').click();
      await page.waitForFunction(() => !document.querySelector('#slai-safari-panel').shadowRoot.getElementById('refresh').disabled, { timeout: 40000 });
      const next = state();
      if (expected) assert.equal(next?.status, expected, JSON.stringify(next?.diagnostic));
      return next;
    }
    await page.goto('https://stu.slai.edu.cn/');
    await page.locator('#authCard:not(.hidden)').waitFor();
    assert.equal(requests.length, 0, 'Opening the panel never starts collection');
    assert.equal(await panel.evaluate(el => getComputedStyle(el).position), 'fixed', 'Panel styles work even with page style-src none');
    assert.equal(await page.locator('#ringCanvas').evaluate(el => el.getBoundingClientRect().width), 174);
    const loginReload = page.waitForEvent('domcontentloaded');
    await page.locator('#login').click();
    await loginReload;
    await page.locator('#returnPanel').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#slai-safari-panel').shadowRoot.getElementById('returnPanel').getBoundingClientRect().height * visualViewport.scale >= 44, null, { timeout: 3000 });
    await page.getByRole('link', { name: '虚构登录入口' }).click();
    assert.equal(await panel.count(), 0, 'Login forms are left to the school');
    await page.getByRole('link', { name: '完成虚构登录' }).click();
    await page.locator('#returnPanel').waitFor({ state: 'visible' });
    const cookies = await context.cookies('https://stu.slai.edu.cn/');
    assert(cookies.some(item => item.name === 'slai_fixture' && item.httpOnly));
    await page.locator('#returnPanel').click();
    await page.waitForFunction(() => document.querySelector('#slai-safari-panel').shadowRoot.getElementById('todayDuration').textContent === '03:00:00');
    await page.waitForFunction(() => !document.querySelector('#slai-safari-panel').shadowRoot.getElementById('refresh').disabled);
    const complete = state();
    assert.equal(complete.status, 'ok'); assert.equal(complete.nextRefreshAt, null);
    assert.equal(complete.todaySwipes.length, 6); assert.deepEqual(pages(), [1, 2, 3]);
    const pageTimes = requests.filter(item => item.path.endsWith('/list')).map(item => item.at);
    assert(pageTimes[2] - pageTimes[1] >= 1450, 'Pagination remains serial with a 1.5 second gap');
    assert.equal(await page.locator('iframe').count(), 0, 'The school collection frame is removed after completion');
    assert.match(await page.locator('#nextRefresh').textContent(), /仅手动刷新/);
    assert.equal(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth), 128);
    await page.locator('#listView').click();
    const countBeforeReload = requests.length;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#slai-safari-panel').shadowRoot.getElementById('listView').getAttribute('aria-pressed') === 'true');
    await page.locator('#todayDuration').filter({ hasText: '03:00:00' }).waitFor();
    assert.equal(requests.length, countBeforeReload, 'Reload reuses cached data without network collection');
    await page.locator('#calendarView').click();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `No horizontal overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results', `ios-${name}-light.png`) });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(root, 'test-results', `ios-${name}-dark.png`) });
    await page.emulateMedia({ colorScheme: 'light' });
    if (!fromZip) {
      mode = 'wide'; const wide = await refresh('ok');
      assert.equal(wide.todaySwipes.length, 6); assert.deepEqual(pages(), [1, 1, 2]);
      mode = 'script-url'; const unsupported = await refresh('partial');
      assert.equal(unsupported.diagnostic.code, 'SWIPE_SCRIPT_URL');
      assert.equal(unsupported.diagnostic.stage, 'advance_swipes');
      assert.equal(unsupported.diagnostic.page, 2); assert.equal(unsupported.diagnostic.rowsRead, 10);
      assert.equal(unsupported.diagnostic.expectedTotal, 23);
      assert.deepEqual(unsupported.lastCompleteToday, wide.lastCompleteToday);
      await page.locator('#copyDiagnostic').click();
      await page.waitForFunction(() => !!window.fixtureCopied);
      const copied = await page.evaluate(() => window.fixtureCopied);
      assert.match(copied, /SWIPE_SCRIPT_URL/); assert.match(copied, /已读取：10 条/); assert.match(copied, /预期总数：23 条/);
      assert.equal(await page.locator('#copyStatus').textContent(), '已复制排错信息');
      await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException('PRIVATE_FIXTURE', 'NotAllowedError'); }; });
      await page.locator('#copyDiagnostic').click();
      const fallback = page.getByRole('textbox', { name: '可手动复制的报告' });
      await fallback.waitFor(); assert.equal(await fallback.inputValue(), copied);
      assert.match(await page.locator('#copyStatus').textContent(), /自动复制未获允许/);
      await page.getByRole('button', { name: '关闭手动复制' }).click();
      mode = 'timeout'; const timed = await refresh('partial');
      assert.equal(timed.diagnostic.code, 'SWIPE_TIMEOUT'); assert.equal(timed.diagnostic.timeoutMs, 15000);
      assert.equal(timed.diagnostic.page, 2); assert.equal(timed.diagnostic.rowsRead, 10);
      assert.equal(timed.diagnostic.expectedTotal, 23);
      mode = 'auth-swipes'; const auth = await refresh('auth');
      assert.equal(auth.diagnostic.code, 'AUTH_EXPIRED'); assert.equal(auth.diagnostic.stage, 'open_swipes');
      assert.deepEqual(auth.lastCompleteToday, wide.lastCompleteToday); assert.equal(auth.nextRefreshAt, null);
      const authCount = requests.length;
      await page.waitForTimeout(1600);
      assert.equal(requests.length, authCount, 'No automatic retry after login expires');
      mode = 'cross-origin'; const denied = await refresh('error');
      assert.equal(denied.diagnostic.code, 'IOS_FRAME_ACCESS_DENIED');
      assert.equal(denied.diagnostic.errorName, 'SecurityError');
      mode = 'load-error'; const failedLoad = await refresh('error');
      assert.equal(failedLoad.diagnostic.code, 'IOS_FRAME_LOAD_FAILED');
      assert.equal(failedLoad.diagnostic.stage, 'open_portal');
      assert.match(await page.locator('#diagnosticReport').textContent(), /IOS_FRAME_LOAD_FAILED/);
      mode = 'interrupt';
      requests.length = 0;
      await page.locator('#refresh').click();
      await page.waitForRequest(request => new URL(request.url()).searchParams.get('pageNo') === '2');
      assert.equal(state().status, 'loading', 'The persisted snapshot is frozen before collecting, even if Safari is terminated abruptly');
      // Browser automation cannot background iOS Safari itself. Exercise its
      // documented lifecycle event while a real pagination retry is pending.
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => !document.querySelector('#slai-safari-panel').shadowRoot.getElementById('refresh').disabled);
      const interrupted = state();
      assert.equal(interrupted.diagnostic.code, 'IOS_COLLECTION_INTERRUPTED');
      assert.equal(interrupted.diagnostic.page, 2); assert.equal(interrupted.diagnostic.rowsRead, 10);
      assert.equal(interrupted.diagnostic.expectedTotal, 23);
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      mode = 'normal'; await refresh('ok');
      await page.locator('#diagnosticCard').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#diagnosticReport').textContent(), '');
      rejectWrite = true;
      await refresh();
      assert.match(await page.locator('#diagnosticReport').textContent(), /STORAGE_WRITE_FAILED/);
      assert.equal(state().status, 'ok', 'A failed write cannot replace the last persisted snapshot');
      rejectWrite = false; rejectRead = true;
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#slai-safari-panel').shadowRoot.getElementById('diagnosticReport').textContent.includes('STORAGE_READ_FAILED'));
      rejectRead = false;
      await refresh('ok');
      mode = 'blocked'; await page.reload();
      const blocked = await refresh('error');
      assert.equal(blocked.diagnostic.code, 'IOS_FRAME_BLOCKED');
      assert.equal(blocked.diagnostic.stage, 'open_portal');
      mode = 'empty'; await page.reload(); const empty = await refresh('ok');
      assert.deepEqual(empty.todaySwipes, []); assert.equal(empty.diagnostic, null);
      assert.equal(await page.locator('#todayDuration').textContent(), '00:00:00');
      await page.locator('.ios-account summary').click();
      await page.locator('#clearCache').click(); await page.locator('#confirmClear').click();
      await page.locator('#authCard:not(.hidden)').waitFor();
      assert.equal(state().updatedAt, null);
      assert((await context.cookies('https://stu.slai.edu.cn/')).some(item => item.name === 'slai_fixture'), 'Clearing attendance cache leaves Safari school login intact');
      await page.evaluate(() => { delete window.GM.getValue; delete window.GM.setValue; });
      await refresh();
      assert.match(await page.locator('#diagnosticReport').textContent(), /IOS_USERSCRIPTS_UNAVAILABLE/);
    }
    assert.deepEqual(pageErrors, [], 'No uncaught browser exceptions');
    assert(!/PRIVATE_FIXTURE|000000000|slai_fixture|synthetic|userNo|https:|session|stack/.test(JSON.stringify(writes)), 'Persisted values contain no fixture credentials, URLs or raw exceptions');
    await context.close();
    console.log(`${name}: Safari ${fromZip ? 'final ZIP installation' : 'manual flow, pagination, privacy and diagnostics'} passed with synthetic school pages.`);
  } finally { await browser.close(); }
}

// Playwright's WebKit has no Safari extension host. Also run the exact packaged
// script in a real Chromium isolated content world to verify frame DOM access
// and the asynchronous privileged-storage boundary used by Userscripts.
async function verifyIsolated() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slai-safari-isolated-'));
  let context;
  try {
    const extension = path.join(temporary, 'extension');
    fs.mkdirSync(extension);
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Synthetic Safari script host', version: '1.0.0', permissions: ['storage'], host_permissions: ['https://stu.slai.edu.cn/*', 'https://sts.slai.edu.cn/*'], content_scripts: [{ matches: ['https://stu.slai.edu.cn/*', 'https://sts.slai.edu.cn/*'], js: ['gm.js', 'panel.js'], all_frames: true, run_at: 'document_end' }] }));
    fs.writeFileSync(path.join(extension, 'panel.js'), bundle);
    fs.writeFileSync(path.join(extension, 'gm.js'), `
      window.GM = {
        getValue: async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback,
        setValue: (key, value) => chrome.storage.local.set({ [key]: value })
      };
      const FixtureDate = Date;
      const offset = new FixtureDate('2030-04-08T12:00:00+08:00').getTime() - FixtureDate.now();
      window.Date = class extends FixtureDate {
        constructor(...args) { super(...(args.length ? args : [FixtureDate.now() + offset])); }
        static now() { return FixtureDate.now() + offset; }
      };
    `);
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
      channel: 'chromium', headless: true, viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai',
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'], proxy: { server: 'http://127.0.0.1:9' }
    });
    const requested = [];
    await context.route('**/*', async route => {
      const fulfill = options => fixtureResponse(route, options);
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, 'https://stu.slai.edu.cn');
      if (url.pathname.endsWith('/attendList')) return fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>月度考勤统计汇总</h1><input value="2030-04"><p>学号: 000000000</p><table><tr><td>2030-04-08</td><td>周一</td><td>工作日</td><td>02:00:00</td></tr></table>' });
      if (url.pathname.endsWith('/list')) {
        assert((await context.cookies(request.url())).some(cookie => cookie.name === 'slai_fixture' && cookie.httpOnly));
        const number = Number(url.searchParams.get('pageNo') || 1); requested.push(number);
        if (request.resourceType() === 'document') return fulfill({ contentType: 'text/html; charset=utf-8', body: swipeHtml('2030-04-08') });
        return fulfill({ json: swipeData(number) });
      }
      return fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'set-cookie': 'slai_fixture=synthetic; Path=/; Secure; HttpOnly; SameSite=Lax', 'content-security-policy': "script-src 'unsafe-inline'; style-src 'none'; frame-src 'self'; img-src data:" }, body: '<!doctype html><a href="/a/edu/acm/swipe/attendList">学生考勤统计查询</a>' });
    });
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: extension });
    const page = await context.newPage();
    await page.goto('https://stu.slai.edu.cn/');
    await page.locator('#authCard:not(.hidden)').waitFor();
    assert.equal(await page.evaluate(() => typeof window.GM), 'undefined', 'The school world has no privileged storage bridge');
    assert.deepEqual(requested, []);
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelector('#slai-safari-panel').shadowRoot.getElementById('todayDuration').textContent === '03:00:00');
    await page.waitForFunction(() => !document.querySelector('#slai-safari-panel').shadowRoot.getElementById('refresh').disabled);
    assert.deepEqual(requested, [1, 2, 3]);
    await page.reload();
    await page.locator('#todayDuration').filter({ hasText: '03:00:00' }).waitFor();
    assert.deepEqual(requested, [1, 2, 3]);
    console.log('Packaged Safari script: real isolated content world, same-origin HttpOnly cookie, DOM pagination and privileged cache passed.');
  } finally {
    if (context) await context.close();
    assert(path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('slai-safari-isolated-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
(async () => {
  if (process.argv.includes('--isolated-only')) { await verifyIsolated(); return; }
  if (!process.argv.includes('--webkit-only')) await verify(chromium, 'chromium');
  await verify(webkit, 'webkit');
  if (!process.argv.includes('--webkit-only')) await verifyIsolated();
})().catch(error => { console.error(error); process.exitCode = 1; });
