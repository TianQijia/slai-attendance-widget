// Same desktop presentation and collector; Android only collects on a tap.
const updateSharedClock = updateNextRefresh;
updateNextRefresh = () => {
  updateSharedClock();
  $('nextRefresh').textContent = '仅手动刷新；不在后台采集。完整数据超过35分钟后暂停估算。';
};
function renderAndroid(state) {
  render(state);
  if (state.status === 'loading' && !state.updatedAt) {
    $('authCard').classList.remove('hidden');
    $('authCard').querySelector('strong').textContent = '登录学校账号';
  } else $('authCard').querySelector('strong').textContent = '需要重新登录';
}
async function send(type) {
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (response?.state) renderAndroid(response.state);
    return response;
  } catch (error) {
    render({ ...currentState, status: 'error', diagnostic: diagnoseError(error, { stage: 'widget_request', operation: type.replaceAll('-', '_') }) });
    return null;
  }
}
async function refresh() {
  for (const id of ['refresh', 'login', 'openPortal', 'logout']) $(id).disabled = true;
  $('refresh').classList.add('spinning');
  $('manualStatus').textContent = '正在读取学校记录…';
  try { await send('refresh'); }
  finally {
    for (const id of ['refresh', 'login', 'openPortal', 'logout']) $(id).disabled = false;
    $('refresh').classList.remove('spinning');
    $('manualStatus').textContent = '手动刷新 · Cookie 过期后重新登录';
  }
}
$('refresh').addEventListener('click', refresh);
$('login').addEventListener('click', () => send('login'));
$('openPortal').addEventListener('click', () => send('open-portal'));
$('logout').addEventListener('click', () => $('logoutDialog').showModal());
$('confirmLogout').addEventListener('click', async () => { $('logoutDialog').close(); await send('logout'); });
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'attendance-state') renderAndroid(message.state); });
function tick() {
  updateNextRefresh();
}
send('get-state').then(tick);
setInterval(tick, 1000);
