// Clock repaint is local only. A tap is required for every school collection.
const updateSharedClock = updateNextRefresh;
updateNextRefresh = () => {
  updateSharedClock();
  $('nextRefresh').textContent = '仅手动刷新；不在后台采集。完整数据超过35分钟后暂停估算。';
};
function renderSafari(state) {
  render(state);
  if (state.status === 'loading' && !state.updatedAt) {
    $('authCard').classList.remove('hidden');
    $('authCard').querySelector('strong').textContent = '首次使用';
    $('authCard').querySelector('p').textContent = '先为学生系统和登录站点开启桌面网站，再登录并点“返回考勤并刷新”。已经登录可直接点右上角刷新。';
  } else {
    $('authCard').querySelector('strong').textContent = '需要重新登录';
    $('authCard').querySelector('p').textContent = '使用学校桌面网站登录，Safari 保留登录状态。完成后点“返回考勤并刷新”。';
  }
}
function showError(error, operation) {
  renderSafari({ ...currentState, status: 'error', diagnostic: diagnoseError(error, { stage: 'widget_request', operation }) });
}
async function send(type) {
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (response?.state) renderSafari(response.state);
    return response;
  } catch (error) { showError(error, type.replaceAll('-', '_')); return null; }
}
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  for (const id of ['refresh', 'login', 'openPortal', 'clearCache', 'returnPanel']) $(id).disabled = true;
  $('refresh').classList.add('spinning');
  $('manualStatus').textContent = '正在读取学校记录，请保持此页在前台…';
  try { await send('refresh'); }
  finally {
    refreshing = false;
    for (const id of ['refresh', 'login', 'openPortal', 'clearCache', 'returnPanel']) $(id).disabled = false;
    $('refresh').classList.remove('spinning');
    $('manualStatus').textContent = '手动刷新 · Safari 保留学校登录';
  }
}
$('refresh').addEventListener('click', refresh);
$('login').addEventListener('click', () => send('login'));
$('openPortal').addEventListener('click', () => send('open-portal'));
$('returnPanel').addEventListener('click', async () => {
  try { await host.setSchoolMode(false); await refresh(); }
  catch (error) { onSchoolMode(false); showError(error, 'storage_set'); }
});
$('clearCache').addEventListener('click', () => $('clearDialog').showModal());
$('confirmClear').addEventListener('click', async () => { $('clearDialog').close(); await send('clear-cache'); });
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'attendance-state') renderSafari(message.state); });
renderSafari(globalThis.__slaiState.sanitizeState({}));
(async () => {
  await send('get-state');
  try { onSchoolMode(await host.schoolMode()); }
  catch (error) { showError(error, 'storage_get'); }
})();
setInterval(() => { if (!ownerDocument.hidden) updateNextRefresh(); }, 1000);
