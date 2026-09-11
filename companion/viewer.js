mobileView = true;
let envelope = null, lastContact = null, anchorTime = Date.now(), anchorMono = performance.now(), connectionDiagnostic = null;
let activeRequest = null;
let token = "";
try {
  token = new URLSearchParams(location.hash.slice(1)).get("token") || sessionStorage.getItem("viewToken") || "";
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) sessionStorage.setItem("viewToken", token);
  else token = "";
} catch { /* Keep an in-memory token if session storage is unavailable. */ }
history.replaceState(null, "", location.pathname);
viewNow = () => anchorTime + performance.now() - anchorMono;
forceFreeze = () => !lastContact || !!connectionDiagnostic || !envelope?.lastSeenAt || viewNow() - Date.parse(envelope.lastSeenAt) > 150000;
function connectionView() {
  let diagnostic = connectionDiagnostic || envelope?.diagnostic;
  if (!diagnostic && (!envelope?.lastSeenAt || viewNow() - Date.parse(envelope.lastSeenAt) > 150000)) diagnostic = { code: "SOURCE_STALE", stage: "viewer_fetch" };
  if (!diagnostic && currentState?.lastCompleteToday && viewNow() - Date.parse(currentState.lastCompleteToday.updatedAt) > 35 * 60000) diagnostic = { code: "DATA_STALE", stage: "viewer_fetch" };
  $("connectionStatus").textContent = diagnostic ? describeDiagnostic(diagnostic).reason : "本地服务可达 · 电脑扩展最近已联系";
  $("connectionReport").textContent = diagnostic ? diagnosticReport(diagnostic) : "";
  if (currentState?.status === "auth") $("connectionStatus").textContent += " · 请在电脑端完成学校登录";
  $("nextRefresh").textContent = "每 15 秒检查查看服务 · 学校每 30 分钟同步";
}
async function fetchState() {
  if (activeRequest) return activeRequest;
  activeRequest = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      if (!token) throw globalThis.__slaiErrors.codedError("ACCESS_DENIED");
      const response = await fetch("/api/state", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error" });
      if (!response.ok) throw globalThis.__slaiErrors.codedError(response.status === 401 ? "ACCESS_DENIED" : "VIEW_UNREACHABLE", { httpStatus: response.status });
      const next = await response.json();
      if (next.schemaVersion !== 1 || !Number.isFinite(Date.parse(next.serverTime)) || (next.state !== null && next.state?.schemaVersion !== 4)) throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
      envelope = next; anchorTime = Date.parse(next.serverTime); anchorMono = performance.now(); lastContact = anchorTime;
      connectionDiagnostic = null;
      render(next.state || {});
    } catch (error) {
      connectionDiagnostic = diagnoseError(error.code ? error : globalThis.__slaiErrors.codedError(controller.signal.aborted ? "VIEW_TIMEOUT" : "VIEW_UNREACHABLE", controller.signal.aborted ? { timeoutMs: 3000 } : {}, error), { stage: "viewer_fetch", operation: "http_request" });
      if (currentState) renderToday(currentState);
    } finally { clearTimeout(timeout); connectionView(); }
  })().finally(() => { activeRequest = null; });
  return activeRequest;
}
$("reconnect").addEventListener("click", fetchState);
$("copyConnection").addEventListener("click", async () => {
  const report = $("connectionReport").textContent;
  if (!report) return;
  try { await navigator.clipboard.writeText(report); $("connectionStatus").textContent = "已复制连接排错信息"; }
  catch {
    const range = document.createRange(); range.selectNodeContents($("connectionReport"));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    $("connectionStatus").textContent = "自动复制未获允许，请手动复制已选中的信息。";
  }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchState(); });
fetchState();
setInterval(() => { if (!document.hidden) fetchState(); }, 15000);
setInterval(() => { updateNextRefresh(); connectionView(); }, 1000);
