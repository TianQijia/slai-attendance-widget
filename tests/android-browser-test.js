const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { swipeHtml, swipeData } = require('./swipe-fixture');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'scripts/prepare-android.js')]);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const context = await browser.newContext();
    const school = await context.newPage();
    let mode = 'normal', state = {}, view = 'calendar', collecting = false;
    const operations = [], schoolRequests = [], writes = [], violations = [];
    await school.route('**/*', async route => {
      const url = new URL(route.request().url());
      schoolRequests.push({ path: url.pathname, page: Number(url.searchParams.get('pageNo') || 1) });
      if (url.hostname === 'sts.slai.edu.cn') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>虚构学校登录</h1>' });
      if (mode === 'auth') return route.fulfill({ status: 302, headers: { location: 'https://sts.slai.edu.cn/signin' }, body: '' });
      if (url.pathname.endsWith('/attendList')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>月度考勤统计汇总</h1><input value="2030-04"><p>学号: 000000000</p><table><tr><td>2030-04-08</td><td>周一</td><td>工作日</td><td>02:00:00</td></tr></table>' });
      if (url.pathname.endsWith('/list')) {
        if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: mode === 'script-url' ? swipeHtml().replaceAll('href="javascript:;"', 'href="javascript:window.PRIVATE_FIXTURE=true"') : swipeHtml() });
        return route.fulfill({ json: swipeData(Number(url.searchParams.get('pageNo') || 1), mode) });
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<a href="/a/edu/acm/swipe/attendList">学生考勤统计查询</a>' });
    });
    const ui = await context.newPage({ viewport: { width: 390, height: 844 } });
    await ui.setViewportSize({ width: 390, height: 844 });
    await ui.clock.install({ time: new Date('2030-04-08T12:00:00+08:00') });
    ui.on('pageerror', error => violations.push(error.name));
    ui.on('console', message => { if (/content security policy/i.test(message.text())) violations.push('CSP'); });
    await ui.route('**/*', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, 'https://appassets.androidplatform.net');
      const name = path.basename(url.pathname);
      const relative = url.pathname.split('/assets/web/')[1];
      assert(relative && !relative.includes('..'));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
      return route.fulfill({ contentType: types[path.extname(name)] || 'text/plain', body: fs.readFileSync(path.join(root, 'android/app/build/generated/slaiAssets/web', relative)) });
    });
    await ui.exposeFunction('fixtureNative', async raw => {
      const { id, operation, args } = JSON.parse(raw);
      operations.push(operation);
      const tab = () => ({ id: 1, status: 'complete', url: school.url() });
      try {
        let value;
        switch (operation) {
          case 'state.read': value = structuredClone(state); break;
          case 'state.write': state = structuredClone(args.state); writes.push(state); value = true; break;
          case 'view.read': value = view; break;
          case 'view.write': view = args.view; value = true; break;
          case 'collection.begin': assert(!collecting); collecting = true; value = true; break;
          case 'collection.end': collecting = false; value = true; break;
          case 'school.state': value = tab(); break;
          case 'school.navigate':
            assert(collecting);
            if (mode.startsWith('ANDROID_')) throw { code: mode, details: { httpStatus: 403, message: 'PRIVATE_FIXTURE', sourceUrl: 'PRIVATE_FIXTURE' } };
            await school.goto(args.url); value = tab(); break;
          case 'school.read':
            await school.addScriptTag({ path: path.join(root, 'extension/page-reader.js') });
            value = await school.evaluate(method => __slaiAttendance[method](), args.method); break;
          case 'school.close': value = true; break;
          case 'school.show': value = true; break;
          case 'school.logout': state = {}; value = true; break;
          default: throw new Error('Unexpected test operation');
        }
        return { id, ok: true, value };
      } catch (error) { return { id, ok: false, code: error.code || 'UNEXPECTED_ERROR', details: error.details || {} }; }
    });
    await ui.addInitScript(() => {
      window.SlaiNative = { postMessage: message => window.fixtureNative(message).then(value => window.SlaiNative.onmessage({ data: JSON.stringify(value) })) };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copied = text; } } });
    });
    await ui.goto('https://appassets.androidplatform.net/assets/web/index.html');
    await ui.locator('#authCard:not(.hidden)').waitFor();
    assert.deepEqual(schoolRequests, [], 'Opening the APK UI must never request school data');
    await ui.locator('#login').click();
    assert(operations.includes('school.show'));
    assert(!operations.includes('collection.begin'), 'Returning from login still requires an explicit refresh');
    async function refreshFixture() {
      await ui.locator('#refresh').click();
      await ui.waitForFunction(() => !document.querySelector('#refresh').disabled);
      return structuredClone(state);
    }
    const complete = await refreshFixture();
    assert.equal(complete.status, 'ok', JSON.stringify({ diagnostic: complete.diagnostic, operations, violations })); assert.equal(complete.todaySwipes.length, 6);
    assert.equal(complete.nextRefreshAt, null);
    assert.equal(await ui.locator('#todayDuration').innerText(), '03:00:00');
    assert.deepEqual(schoolRequests.filter(item => item.path.endsWith('/list')).map(item => item.page), [1, 2, 3]);
    assert.equal(await school.evaluate(() => typeof SlaiNative), 'undefined');
    await ui.locator('#listView').click(); await ui.reload();
    await ui.waitForFunction(() => document.querySelector('#listView').getAttribute('aria-pressed') === 'true');
    assert.equal(await ui.locator('.day-row').count(), 30);
    const before = schoolRequests.length;
    await ui.clock.fastForward(36 * 60 * 1000);
    assert.equal(schoolRequests.length, before, 'No 30-minute Android timer or automatic school fetch');
    assert.match(await ui.locator('#nextRefresh').textContent(), /仅手动刷新/);

    for (mode of ['ANDROID_HTTP_FAILED', 'ANDROID_DNS_FAILED', 'ANDROID_CONNECT_FAILED', 'ANDROID_TLS_FAILED', 'ANDROID_COLLECTION_INTERRUPTED', 'ANDROID_READER_TIMEOUT', 'ANDROID_RENDERER_GONE']) {
      const failed = await refreshFixture();
      assert.equal(failed.diagnostic.code, mode);
      assert.equal(failed.diagnostic.httpStatus, 403);
      assert.deepEqual(failed.lastCompleteToday, complete.lastCompleteToday);
      await ui.locator('#copyDiagnostic').click();
      const copied = await ui.evaluate(() => window.copied);
      assert(copied.includes(mode)); assert.match(copied, /403/);
      assert(!JSON.stringify(failed).includes('PRIVATE_FIXTURE') && !copied.includes('PRIVATE_FIXTURE'));
    }
    mode = 'script-url';
    const unsupported = await refreshFixture();
    assert.equal(unsupported.status, 'partial'); assert.equal(unsupported.diagnostic.code, 'SWIPE_SCRIPT_URL');
    assert.equal(unsupported.diagnostic.rowsRead, 10); assert.equal(unsupported.diagnostic.expectedTotal, 23);
    assert.deepEqual(unsupported.lastCompleteToday, complete.lastCompleteToday);
    mode = 'auth';
    const expired = await refreshFixture();
    assert.equal(expired.status, 'auth'); assert.equal(expired.nextRefreshAt, null);
    const afterAuth = schoolRequests.length;
    await ui.clock.fastForward(31 * 60 * 1000);
    assert.equal(schoolRequests.length, afterAuth);
    mode = 'normal';
    const recovered = await refreshFixture();
    assert.equal(recovered.status, 'ok'); assert.equal(recovered.diagnostic, null);
    assert(!JSON.stringify(writes).includes('000000000'));
    await ui.locator('#calendarView').click();
    await ui.mouse.move(0, 0);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    for (const theme of ['light', 'dark']) {
      await ui.emulateMedia({ colorScheme: theme });
      assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await ui.screenshot({ path: path.join(root, `test-results/android-${theme}.png`), fullPage: true });
    }
    await ui.locator('.android-account summary').click();
    await ui.locator('#logout').click();
    await ui.locator('#confirmLogout').click();
    await ui.waitForFunction(() => document.querySelector('#todayDuration').textContent === '--:--:--');
    assert.deepEqual(state, {});
    assert.deepEqual(violations, []);
    console.log('Passed: Android bundled UI, manual-only collection, shared 23-row pagination, cookie-expiry flow, persistent view, safe diagnostic propagation, recovery, logout and light/dark phone layouts. Native WebView behavior is tested separately on Android.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
