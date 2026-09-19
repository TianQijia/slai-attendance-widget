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
