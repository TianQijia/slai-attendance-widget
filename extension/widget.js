async function send(type) {
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response) throw Object.assign(new Error("No background response"), { code: "WIDGET_DISCONNECTED" });
    if (response.ok === false) render({ ...currentState, status: "error", diagnostic: response.diagnostic || diagnoseError(null, { stage: "widget_request" }) });
    return response;
  } catch (error) {
    render({ ...currentState, status: "error", diagnostic: diagnoseError(error, { stage: "widget_request", operation: type.replaceAll("-", "_") }) });
    return null;
  }
}

async function refresh() {
  const button = $("refresh");
  button.classList.add("spinning");
  button.disabled = true;
  try {
    const response = await send("refresh");
    if (response?.state) render(response.state);
  } finally {
    button.classList.remove("spinning");
    button.disabled = false;
  }
}

$("refresh").addEventListener("click", refresh);
$("login").addEventListener("click", () => send("login"));
$("openPortal").addEventListener("click", () => send("open-portal"));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "attendance-state" && message.state) render(message.state);
});

send("get-state").then((response) => { if (response?.state) render(response.state); });
setInterval(updateNextRefresh, 1000);

let bridgeViewInfo = {};
function showBridge(update) {
  const info = Object.assign(bridgeViewInfo, update);
  if (typeof info.enabled === "boolean") $("bridgeStatus").textContent = info.enabled ? "手机查看已启用" : "尚未启用";
  setReportText($("bridgeReport"), [info.diagnostic, info.refreshDiagnostic].filter(Boolean).map(value => diagnosticReport(value)).join("\n\n"));
  if (info.diagnostic || info.refreshDiagnostic) $("bridgeStatus").textContent = describeDiagnostic(info.diagnostic || info.refreshDiagnostic).reason;
}
async function bridgeRequest(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response) throw globalThis.__slaiErrors.codedError("WIDGET_DISCONNECTED");
    showBridge(response);
  } catch (error) { showBridge({ diagnostic: diagnoseError(error, { stage: "bridge_settings" }) }); }
}
$("enableBridge").addEventListener("click", async () => {
  $("enableBridge").disabled = true;
  $("bridgeStatus").textContent = "等待浏览器授权或连接本机服务…";
  try {
    const granted = await chrome.permissions.request({ origins: ["http://127.0.0.1/*"] });
    if (!granted) throw globalThis.__slaiErrors.codedError("BRIDGE_PERMISSION");
    const token = $("bridgeToken").value.trim();
    $("bridgeToken").value = "";
    await bridgeRequest({ type: "set-bridge", enabled: true, token });
  } catch (error) { showBridge({ diagnostic: diagnoseError(error, { stage: "bridge_settings" }) }); }
  finally { $("enableBridge").disabled = false; }
});
$("disableBridge").addEventListener("click", () => bridgeRequest({ type: "set-bridge", enabled: false }));
$("copyBridge").addEventListener("click", async () => {
  const report = $("bridgeReport").textContent;
  if (!report) return;
  await copyReport($("bridgeReport"), $("bridgeStatus"), "已复制连接排错信息");
});
chrome.runtime.onMessage.addListener(message => { if (message?.type === "bridge-state") showBridge(message); });
bridgeRequest({ type: "get-bridge" });
