let schoolRefresh = null, schoolInstance = null, schoolRequestFlight = null, schoolRequestId = null, schoolRefreshDiagnostic = null;
const { sanitizeRefresh, pending: refreshPending } = globalThis.__slaiRefresh;
function resetRemoteRefresh() {
  schoolRefresh = null; schoolInstance = null; schoolRequestId = null; schoolRefreshDiagnostic = null;
}
function updateRemoteRefresh(next) {
  let value = sanitizeRefresh(next.refresh);
  if (next.refresh !== undefined && !value) throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
  if (schoolInstance && next.instanceId !== schoolInstance) {
    if (schoolRequestId || refreshPending(schoolRefresh?.request)) schoolRefreshDiagnostic = diagnoseError(globalThis.__slaiErrors.codedError("REFRESH_SERVER_RESTARTED"), { stage: "remote_refresh" });
    schoolRequestId = null; schoolRefresh = null;
  }
  schoolInstance = next.instanceId;
  // A cache read already in flight must not regress an acknowledged command.
  if (schoolRefresh?.request && value) {
    const previous = schoolRefresh.request, incoming = value.request;
    const rank = { queued: 0, running: 1, succeeded: 2, failed: 2 };
    if (!incoming || incoming.requestedAt < previous.requestedAt || (incoming.id === previous.id && rank[incoming.status] < rank[previous.status])) value.request = previous;
  }
  schoolRefresh = value;
  if (schoolRequestId && value?.request?.id === schoolRequestId) {
    schoolRefreshDiagnostic = null;
    if (!refreshPending(value.request)) schoolRequestId = null;
  }
  refreshViewState();
}
function remoteRefreshDiagnostic() { return schoolRefreshDiagnostic || schoolRefresh?.request?.diagnostic; }
function refreshViewState() {
  const request = schoolRefresh?.request;
  const cooldown = Math.max(0, Math.ceil((Date.parse(schoolRefresh?.cooldownUntil) - viewNow()) / 1000)) || 0;
  const busy = !!schoolRequestFlight || refreshPending(request);
  $("refreshView").disabled = !tokenVerified || busy || cooldown > 0;
  $("refreshView").textContent = busy ? "抓取中…" : cooldown ? `稍后重试 (${cooldown})` : "刷新学校数据";
  let text = "点击后通知电脑 Chrome 扩展，重新抓取学校数据。";
  if (!tokenVerified) text = "请先连接查看服务，再刷新学校数据。";
  else if (schoolRefreshDiagnostic) text = describeDiagnostic(schoolRefreshDiagnostic).reason;
  else if (request?.status === "queued") text = "已发送刷新请求，等待电脑扩展确认…";
  else if (request?.status === "running") text = "电脑扩展正在抓取学校数据…";
  else if (request?.status === "succeeded") text = "学校数据已更新 · " + formatInstant(request.finishedAt);
  else if (request?.status === "failed") text = "上次手机刷新未完成 · " + describeDiagnostic(request.diagnostic || { code: "REFRESH_RESULT_UNKNOWN" }).reason;
  else if (schoolRequestFlight) text = "正在通知电脑扩展…";
  $("schoolRefreshStatus").textContent = text;
}
function requestSchoolRefresh() {
  if (schoolRequestFlight) return schoolRequestFlight;
  if (!tokenVerified || refreshPending(schoolRefresh?.request)) return;
  const revision = credentialRevision;
  if (!schoolRequestId) {
    schoolRequestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
  }
  const id = schoolRequestId;
  schoolRefreshDiagnostic = null;
  schoolRequestFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch("/api/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, id }), signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error" });
      if (!response.ok) {
        let diagnostic;
        try { diagnostic = globalThis.__slaiErrors.sanitizeDiagnostic((await response.json()).diagnostic); } catch { /* Retain the observed HTTP status. */ }
        throw globalThis.__slaiErrors.codedError(response.status === 401 ? "VIEW_TOKEN_REJECTED" : [404, 405].includes(response.status) ? "REFRESH_UNSUPPORTED" : diagnostic?.code || "REFRESH_SEND_FAILED", { ...diagnostic, httpStatus: response.status });
      }
      const result = await response.json();
      if (result.schemaVersion !== 1 || !sanitizeRefresh(result.refresh) || typeof result.instanceId !== "string") throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
      if (revision !== credentialRevision) return;
      schoolRequestId = result.refresh.request?.id || id;
      updateRemoteRefresh(result);
    } catch (error) {
      if (revision !== credentialRevision) return;
      const failure = typeof error?.code === "string" ? error : globalThis.__slaiErrors.codedError(controller.signal.aborted ? "REFRESH_SEND_TIMEOUT" : "REFRESH_SEND_FAILED", controller.signal.aborted ? { timeoutMs: 3000 } : {}, error);
      schoolRefreshDiagnostic = diagnoseError(failure, { stage: "remote_refresh", operation: "refresh" });
      // Definite HTTP refusal can be retried as a new request. An uncertain
      // delivery retains its identifier so retrying cannot duplicate a scrape.
      if (schoolRefreshDiagnostic.httpStatus || error.code === "INVALID_SCHEMA") schoolRequestId = null;
    } finally { clearTimeout(timeout); }
  })().finally(async () => {
    schoolRequestFlight = null;
    if (revision === credentialRevision) { await fetchState(); connectionView(); }
  });
  refreshViewState();
  return schoolRequestFlight;
}
$("refreshView").addEventListener("click", requestSchoolRefresh);
// During an explicitly requested scrape, read progress promptly. These GETs
// never enqueue school work; normal idle viewing remains on the 15s interval.
setInterval(() => { if (!document.hidden && (schoolRequestId || refreshPending(schoolRefresh?.request))) fetchState(); }, 1000);
if (envelope) updateRemoteRefresh(envelope);
refreshViewState();
