const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const list = require('../release-files.json');
const output = path.join(root, 'android/app/build/generated/slaiAssets/web');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
for (const name of list.androidAssets) {
  assert(list.source.includes(name), `Android asset not in source allowlist: ${name}`);
  const relative = name.startsWith('extension/') ? name.slice('extension/'.length) : path.basename(name);
  assert(!relative.includes('..'));
  const dest = path.join(output, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, name), dest);
}
let html = read('extension/widget.html');
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta name="slai-version" content="${require('../package.json').version}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'">`);
html = html.replace('</head>', '<link rel="stylesheet" href="android.css"></head>');
html = html.replace('  <p class="eyebrow" id="todayLabel">', '  <p id="manualStatus" role="status">手动刷新 · Cookie 过期后重新登录</p>\n  <p class="eyebrow" id="todayLabel">');
html = html.replace('</main>', '<details class="android-account"><summary>学校账号与本机数据</summary><p>登录由学校页面处理，会话只保存在本机。退出会清除学校登录和本机考勤缓存。</p><button id="logout" type="button">退出学校账号</button></details></main><dialog id="logoutDialog"><h2>退出学校账号？</h2><p>清除本机学校登录和考勤缓存。再次查看需重新登录并手动刷新。</p><button id="confirmLogout" type="button">退出并清除</button><form method="dialog"><button>取消</button></form></dialog>');
html = html.replace('<script src="view.js">', '<script src="android-native.js"></script><script src="android-host.js"></script><script src="android-collection.js"></script><script src="view.js">');
html = html.replace('src="widget.js"', 'src="android-widget.js"').replace('每30分钟自动刷新', '仅手动刷新');
fs.writeFileSync(path.join(output, 'index.html'), html);
const collector = `(() => {\nconst PORTAL_URL = "https://stu.slai.edu.cn/";\nconst { diagnoseError } = globalThis.__slaiErrors;\nconst { getState, saveState } = globalThis.__slaiAndroidHost;\n${read('extension/collection.js')}\nglobalThis.__slaiAndroidHost.refresh = refreshAttendance;\n})();\n`;
fs.writeFileSync(path.join(output, 'android-collection.js'), collector);
console.log(`Prepared Android UI and shared school collector (${list.androidAssets.length + 2} allowlisted assets).`);
