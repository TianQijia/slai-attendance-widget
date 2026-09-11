mobileView = true;
let envelope = null, lastContact = null, anchorTime = Date.now(), anchorMono = performance.now(), connectionDiagnostic = null;
let activeRequest = null, requestedRevision = -1, credentialRevision = 0;
let lastRequestMs = null;
let token = "", tokenVerified = false, editingAccess = false, accessDiagnostic = null, storageDiagnostic = null;
const rememberedKey = "slaiRememberedViewToken";
const validToken = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
function accessError(code, operation = "read_link", cause) {
  return diagnoseError(globalThis.__slaiErrors.codedError(code, {}, cause), { stage: "viewer_access", operation });
}
function storageAction(area, operation, key, value) {
  try {
    const storage = window[area];
    if (operation === "storage_get") return storage.getItem(key);
    if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    return true;
  } catch (error) {
    storageDiagnostic = accessError("VIEW_STORAGE_UNAVAILABLE", operation, error);
    return null;
  }
}
let rememberedToken = storageAction("localStorage", "storage_get", rememberedKey);
if (!validToken(rememberedToken)) rememberedToken = "";
$("rememberView").checked = !!rememberedToken;
function saveAccess() {
  if (!validToken(token)) return;
  storageDiagnostic = null;
  storageAction("sessionStorage", "storage_set", "viewToken", token);
  if ($("rememberView").checked && tokenVerified) {
    if (storageAction("localStorage", "storage_set", rememberedKey, token)) rememberedToken = token;
  }
}
function useToken(value) {
  token = value; tokenVerified = false; credentialRevision++;
  accessDiagnostic = null; connectionDiagnostic = null;
  // Even before the service responds, a reload of this tab can retry the link.
  // Only a successfully verified credential may be remembered across tabs.
  storageAction("sessionStorage", "storage_set", "viewToken", token);
}
function consumeFragment() {
  if (!location.hash) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const value = params.get("token");
  if (params.getAll("token").length === 1 && validToken(value)) useToken(value);
  else { token = ""; tokenVerified = false; credentialRevision++; accessDiagnostic = accessError("VIEW_LINK_INVALID"); }
  history.replaceState(null, "", location.pathname);
  return true;
}
if (!consumeFragment()) {
  const saved = rememberedToken || storageAction("sessionStorage", "storage_get", "viewToken");
  if (validToken(saved)) token = saved;
}
function accessView() {
  const problem = accessDiagnostic || (connectionDiagnostic?.code === "VIEW_TOKEN_REJECTED" ? connectionDiagnostic : null);
  $("accessForm").classList.toggle("hidden", tokenVerified && !problem && !editingAccess);
  $("changeViewLink").classList.toggle("hidden", !tokenVerified || editingAccess);
  $("forgetView").classList.toggle("hidden", !token && !rememberedToken);
  $("accessMessage").textContent = problem ? describeDiagnostic(problem).reason + "。" + describeDiagnostic(problem).action
    : tokenVerified ? "已取得查看权限。" : token ? "正在验证查看链接…" : describeDiagnostic({ code: "VIEW_TOKEN_MISSING" }).action;
  $("accessStorageStatus").textContent = storageDiagnostic ? describeDiagnostic(storageDiagnostic).reason + "。" + describeDiagnostic(storageDiagnostic).action
    : $("rememberView").checked ? (rememberedToken === token && tokenVerified ? "已记住，可在此浏览器新开标签页查看。清除站点数据或服务地址改变后需重新连接。" : "成功连接后，将在此浏览器保存查看权限。") : "默认仅在当前标签页保存权限；关闭后请使用完整查看链接重新进入。";
}
viewNow = () => anchorTime + performance.now() - anchorMono;
forceFreeze = () => !lastContact || !!connectionDiagnostic || !envelope?.lastSeenAt || viewNow() - Date.parse(envelope.lastSeenAt) > 150000;
function connectionView() {
  let diagnostic = connectionDiagnostic || envelope?.diagnostic;
  if (!diagnostic && (!envelope?.lastSeenAt || viewNow() - Date.parse(envelope.lastSeenAt) > 150000)) diagnostic = { code: "SOURCE_STALE", stage: "viewer_fetch" };
  if (!diagnostic && currentState?.lastCompleteToday && viewNow() - Date.parse(currentState.lastCompleteToday.updatedAt) > 35 * 60000) diagnostic = { code: "DATA_STALE", stage: "viewer_fetch" };
  $("connectionStatus").textContent = diagnostic ? describeDiagnostic(diagnostic).reason : "本地服务可达 · 电脑扩展最近已联系";
  const reports = [diagnostic, accessDiagnostic !== diagnostic ? accessDiagnostic : null, storageDiagnostic].filter(Boolean).map(d => diagnosticReport(d));
  setReportText($("connectionReport"), [...new Set(reports)].join("\n\n"), $("connectionCopyStatus"));
  if (currentState?.status === "auth") $("connectionStatus").textContent += " · 请在电脑端完成学校登录";
  $("nextRefresh").textContent = "每 15 秒检查查看服务 · 学校每 30 分钟同步";
  accessView();
}
async function fetchState() {
  if (activeRequest) {
    await activeRequest;
    // A new link can arrive while an old request is still in flight.
    if (requestedRevision !== credentialRevision) return fetchState();
    return;
  }
  const revision = credentialRevision, requestToken = token;
  requestedRevision = revision;
  $("refreshView").disabled = true;
  $("reconnect").disabled = true;
  $("refreshView").textContent = "读取中…";
  $("viewerRefreshStatus").textContent = "正在读取电脑端最新结果…";
  activeRequest = (async () => {
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      if (!requestToken) throw globalThis.__slaiErrors.codedError(accessDiagnostic?.code || "VIEW_TOKEN_MISSING", { stage: "viewer_access", operation: "read_link" });
      const response = await fetch("/api/state", { headers: { Authorization: `Bearer ${requestToken}` }, signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error" });
      if (!response.ok) throw globalThis.__slaiErrors.codedError(response.status === 401 ? "VIEW_TOKEN_REJECTED" : "VIEW_UNREACHABLE", { httpStatus: response.status });
      const next = await response.json();
      if (next.schemaVersion !== 1 || !Number.isFinite(Date.parse(next.serverTime)) || (next.state !== null && next.state?.schemaVersion !== 4)) throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
      if (revision !== credentialRevision) return;
      envelope = next; anchorTime = Date.parse(next.serverTime); anchorMono = performance.now(); lastContact = anchorTime;
      connectionDiagnostic = null;
      const needsSave = !tokenVerified || storageDiagnostic;
      tokenVerified = true;
      if (needsSave) saveAccess();
      render(next.state || {});
    } catch (error) {
      if (revision !== credentialRevision) return;
      connectionDiagnostic = diagnoseError(error.code ? error : globalThis.__slaiErrors.codedError(controller.signal.aborted ? "VIEW_TIMEOUT" : "VIEW_UNREACHABLE", controller.signal.aborted ? { timeoutMs: 3000 } : {}, error), { stage: "viewer_fetch", operation: "http_request" });
      if (connectionDiagnostic.code === "VIEW_TOKEN_REJECTED") {
        tokenVerified = false;
        // Remove only the rejected credential, preserving a newer one saved by another tab.
        for (const [area, key] of [["sessionStorage", "viewToken"], ["localStorage", rememberedKey]]) {
          if (storageAction(area, "storage_get", key) === requestToken) storageAction(area, "storage_set", key, null);
        }
        if (rememberedToken === requestToken) rememberedToken = "";
      }
      if (currentState) renderToday(currentState); else render({});
    } finally {
      lastRequestMs = Math.round(performance.now() - started); clearTimeout(timeout);
      $("refreshView").disabled = false;
      $("reconnect").disabled = false;
      $("refreshView").textContent = "刷新";
      $("viewerRefreshStatus").textContent = connectionDiagnostic ? describeDiagnostic(connectionDiagnostic).reason : lastContact ? "已读取电脑结果 · " + formatInstant(new Date(lastContact).toISOString()) : "尚未取得查看结果";
      connectionView();
    }
  })().finally(() => { activeRequest = null; });
  return activeRequest;
}
$("accessForm").addEventListener("submit", async event => {
  event.preventDefault();
  const value = $("viewLink").value.trim();
  $("viewLink").value = "";
  try {
    let link;
    try { link = new URL(value); } catch { throw globalThis.__slaiErrors.codedError("VIEW_LINK_INVALID"); }
    if (link.origin !== location.origin) throw globalThis.__slaiErrors.codedError("VIEW_LINK_ORIGIN");
    const params = new URLSearchParams(link.hash.slice(1));
    if (link.pathname !== "/" || link.search || link.username || link.password || params.getAll("token").length !== 1 || !validToken(params.get("token"))) throw globalThis.__slaiErrors.codedError("VIEW_LINK_INVALID");
    useToken(params.get("token")); editingAccess = false;
    await fetchState();
  } catch (error) {
    accessDiagnostic = accessError(error.code === "VIEW_LINK_ORIGIN" ? "VIEW_LINK_ORIGIN" : "VIEW_LINK_INVALID");
    connectionView();
  }
});
$("rememberView").addEventListener("change", () => {
  storageDiagnostic = null;
  if ($("rememberView").checked) { if (tokenVerified) saveAccess(); }
  else if (storageAction("localStorage", "storage_set", rememberedKey, null)) rememberedToken = "";
  connectionView();
});
$("changeViewLink").addEventListener("click", () => { editingAccess = true; accessView(); $("viewLink").focus(); });
$("forgetView").addEventListener("click", () => {
  token = ""; tokenVerified = false; credentialRevision++; rememberedToken = "";
  storageDiagnostic = null;
  storageAction("sessionStorage", "storage_set", "viewToken", null);
  storageAction("localStorage", "storage_set", rememberedKey, null);
  $("rememberView").checked = false; $("viewLink").value = "";
  envelope = null; lastContact = null; editingAccess = false; accessDiagnostic = null;
  connectionDiagnostic = accessError("VIEW_TOKEN_MISSING");
  render({}); connectionView();
  $("viewerRefreshStatus").textContent = "已退出本页查看";
});
window.addEventListener("hashchange", () => { if (consumeFragment()) fetchState(); });
$("refreshView").addEventListener("click", fetchState);
$("reconnect").addEventListener("click", fetchState);
$("copyConnection").addEventListener("click", () => copyReport($("connectionReport"), $("connectionCopyStatus"), "已复制连接排错信息"));
$("checkNetwork").addEventListener("click", async () => {
  const button = $("checkNetwork");
  button.disabled = true;
  $("networkCopyStatus").textContent = "正在检测…";
  try {
    await fetchState();
    const checks = [{ id: "browser", code: connectionDiagnostic ? "NET_REQUEST_FAILED" : "NET_BROWSER_OK", diagnostic: connectionDiagnostic, elapsedMs: lastRequestMs, timeoutMs: 3000 }];
    if (!connectionDiagnostic && envelope) checks.push(...globalThis.__slaiNetwork.freshnessChecks({ ...envelope, serverTime: new Date(viewNow()).toISOString() }));
    setReportText($("networkReport"), globalThis.__slaiNetwork.reportText({ platform: "browser", createdAt: new Date().toISOString(), checks }));
    $("networkCopyStatus").textContent = "检测完成，可复制脱敏报告。";
  } finally { button.disabled = false; }
});
$("copyNetwork").addEventListener("click", () => {
  if (!$("networkReport").textContent) { $("networkCopyStatus").textContent = "请先开始网络检测。"; return; }
  return copyReport($("networkReport"), $("networkCopyStatus"), "已复制网络检测报告");
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchState(); });
accessView();
fetchState();
setInterval(() => { if (!document.hidden) fetchState(); }, 15000);
setInterval(() => { updateNextRefresh(); connectionView(); }, 1000);
