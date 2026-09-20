const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { zipSync, unzipSync } = require('fflate');
const { audit, root } = require('./audit');

function buildIOS() {
  const list = audit();
  const version = require('../package.json').version;
  const used = new Set();
  function bytes(name) {
    assert(list.source.includes(name) && list.iosInputs.includes(name), `iOS input not allowlisted: ${name}`);
    used.add(name);
    return fs.readFileSync(path.join(root, name));
  }
  const read = name => bytes(name).toString('utf8');
  const dataUri = name => `data:${name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${bytes(name).toString('base64')}`;
  let markup = read('extension/widget.html').match(/<body[^>]*>([\s\S]*)<\/body>/)[1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/src="(icons\/[^\"]+)"/g, (_, name) => `src="${dataUri('extension/' + name)}"`)
    .replace('每30分钟自动刷新', '仅手动刷新')
    .replace('<p class="eyebrow" id="todayLabel">', '<p id="manualStatus" role="status">手动刷新 · Safari 保留学校登录</p><p class="eyebrow" id="todayLabel">')
    .replace('</main>', '<details class="ios-account"><summary>学校登录与本机数据</summary><p>请使用普通浏览标签页，先为学生系统和登录站点分别请求桌面网站，再登录。Cookie 由 Safari 保存；学校会话过期后需要重新登录。</p><p>这里可以清除考勤缓存。要退出学校账号，请打开学校系统使用其退出入口。</p><button id="clearCache" type="button">清除本机考勤缓存</button></details></main><dialog id="clearDialog"><h2>清除本机考勤缓存？</h2><p>清除本脚本保存的考勤结果。学校登录由 Safari 单独管理。</p><button id="confirmClear" type="button">清除缓存</button><form method="dialog"><button>取消</button></form></dialog>');
  const css = read('ios/userscripts/ios.css') + '\n' +
    ['extension/widget.css', 'extension/desktop.css'].map(read).join('\n').replace(/:root/g, ':host').replace(/\bhtml\b/g, ':host').replace(/\bbody\b/g, '.slai-body') + `
    :host { color: var(--text); background: var(--surface); }
    .slai-body { min-height: 100%; }
    .desktop .shell { max-width: 520px; min-height: 100dvh; padding: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); }
    .icon-button { width: 44px; height: 44px; }
    #manualStatus { margin: 10px 0 0; color: var(--muted); font-size: 12px; }
    .ios-account { margin-top: 24px; padding-top: 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
    #returnPanel { display: none; }
    :host(.school-mode) { inset: auto; left: var(--school-control-left); top: var(--school-control-top); width: max-content; min-height: 0; overflow: visible; background: transparent; pointer-events: none; transform: translate(-100%, -100%) scale(var(--school-control-scale, 1)); transform-origin: bottom right; }
    :host(.school-mode) .slai-body { position: fixed; left: -10000px; top: 0; width: 390px; opacity: 0; pointer-events: none; }
    :host(.school-mode) #returnPanel { display: block; padding: 12px 16px; background: var(--surface); box-shadow: 0 3px 20px #0003; font-weight: 650; pointer-events: auto; }
  `;
  const metadata = `// ==UserScript==
// @name         SLAI 考勤 · Safari 手动版
// @namespace    https://github.com/TianQijia/slai-attendance-widget
// @version      ${version}
// @description  先以桌面网站登录学校，使用 Safari 登录状态，仅在点击时采集。
// @match        https://stu.slai.edu.cn/*
// @match        https://sts.slai.edu.cn/*
// @run-at       document-end
// @inject-into  content
// @grant        GM.getValue
// @grant        GM.setValue
// @license      MIT
// ==/UserScript==
`;
  const bundle = metadata + `(() => {
'use strict';
// Login frames send no page content, URL or account information.
if (window.top !== window.self) {
  if (location.origin === 'https://sts.slai.edu.cn') window.top.postMessage({ type: 'slai-login-required', version: 1 }, 'https://stu.slai.edu.cn');
  return;
}
if (location.origin !== 'https://stu.slai.edu.cn') return;
const storage = typeof GM === 'object' && GM ? GM : {};
// Keep shared libraries in a private scope, away from the school page's globals.
const globalThis = {};
${['extension/error-utils.js', 'extension/time-utils.js', 'extension/state-utils.js'].map(read).join('\n')}
function makeReader(target) {
  const globalThis = {};
  const document = target.document, location = target.location, Event = target.Event;
  const getComputedStyle = target.getComputedStyle.bind(target);
  ${read('extension/page-reader.js')}
  return globalThis.__slaiAttendance;
}
function makeCollector(chrome, getState, saveState) {
  const PORTAL_URL = 'https://stu.slai.edu.cn/';
  const REQUIRED_SECONDS = 21600;
  const { diagnoseError } = globalThis.__slaiErrors;
  ${read('extension/collection.js')}
  return refreshAttendance;
}
${read('ios/userscripts/host.js')}
${read('ios/userscripts/bootstrap.js')}
function mountView({ document, chrome, host, ownerDocument, onSchoolMode }) {
  ${['extension/report-utils.js', 'extension/view.js', 'extension/desktop-view.js', 'ios/userscripts/widget.js'].map(read).join('\n')}
}
function start() { bootSafari({ markup: ${JSON.stringify(markup)}, css: ${JSON.stringify(css)}, storage, makeReader, mountView, version: ${JSON.stringify(version)} }); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
`;
  assert(!/document\.cookie|chrome\.cookies|GM\.xmlHttpRequest|\beval\s*\(|new Function\s*\(/.test(bundle), 'Unexpected credential, cross-origin request or dynamic-code API');
  assert(!/<script\b|\ssrc="https?:/.test(markup));
  const scriptName = 'slai-attendance-safari.user.js';
  const entries = { [scriptName]: Buffer.from(bundle), '安装说明.md': bytes('docs/ios.md'), 'LICENSE': bytes('LICENSE'), 'icons-NOTICE.md': bytes('extension/icons/NOTICE.md'), 'TABLER-LICENSE.txt': bytes('extension/icons/TABLER-LICENSE.txt') };
  assert.deepEqual([...used].sort(), [...list.iosInputs].sort(), 'Unused or missing iOS allowlist inputs');
  assert.deepEqual(Object.keys(entries).sort(), [...list.iosArchive].sort());
  const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, [value, { mtime: new Date('2020-01-01T00:00:00Z') }]])), { level: 6 });
  const unpacked = unzipSync(zip);
  for (const [name, value] of Object.entries(entries)) assert.deepEqual(Buffer.from(unpacked[name]), value);
  const output = path.join(root, 'dist', `ios-v${version}`);
  fs.mkdirSync(output, { recursive: true });
  const scriptPath = path.join(output, scriptName);
  const zipPath = path.join(output, `slai-attendance-safari-v${version}.zip`);
  fs.writeFileSync(scriptPath, bundle);
  fs.writeFileSync(zipPath, zip);
  const sums = [scriptPath, zipPath].map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n') + '\n';
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), sums);
  console.log(`Built Safari Userscript and verified ZIP (${Object.keys(entries).length} allowlisted files).`);
  return { scriptPath, zipPath, scriptName };
}
if (require.main === module) buildIOS();
module.exports = { buildIOS };
