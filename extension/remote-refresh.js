let refreshSocket = null, refreshConnect = null, refreshRetry = null, refreshHeartbeat = null;
let refreshSocketGeneration = 0, remoteRefreshWork = null, refreshRetryDelay = 2000;
let remoteRefreshResult = null;
async function publishRefreshDiagnostic(diagnostic) {
  try {
    const clean = globalThis.__slaiErrors.sanitizeDiagnostic(diagnostic);
    await chrome.storage.local.set({ refreshDiagnostic: clean });
    chrome.runtime.sendMessage({ type: "bridge-state", refreshDiagnostic: clean }).catch(() => {});
  } catch { /* A control-channel failure must not affect school data storage. */ }
}
function stopRemoteRefresh() {
  refreshSocketGeneration++;
  clearTimeout(refreshRetry); refreshRetry = null;
  clearInterval(refreshHeartbeat); refreshHeartbeat = null;
  const old = refreshSocket; refreshSocket = null;
  if (old) old.close();
}
function ensureRemoteRefresh() {
  if (refreshSocket || refreshConnect) return refreshConnect;
  clearTimeout(refreshRetry); refreshRetry = null;
  const generation = refreshSocketGeneration;
  refreshConnect = (async () => {
    let settings;
    try {
      settings = (await chrome.storage.local.get("bridgeSettings")).bridgeSettings;
      if (generation !== refreshSocketGeneration || !settings?.enabled) return;
      if (!await chrome.permissions.contains({ origins: [BRIDGE_ORIGIN] })) throw globalThis.__slaiErrors.codedError("BRIDGE_PERMISSION");
      if (!/^[A-Za-z0-9_-]{43}$/.test(settings.token)) throw globalThis.__slaiErrors.codedError("BRIDGE_TOKEN");
      if (generation !== refreshSocketGeneration) return;
      const socket = new WebSocket("ws://127.0.0.1:32101/api/control");
      refreshSocket = socket;
      let ready = false, lastPong = Date.now(), diagnostic = null;
      const current = () => generation === refreshSocketGeneration && refreshSocket === socket;
      const send = value => { if (current() && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ schemaVersion: 1, ...value })); };
      const handshake = setTimeout(() => {
        if (current() && !ready) { diagnostic = globalThis.__slaiErrors.diagnoseError(globalThis.__slaiErrors.codedError("REFRESH_CHANNEL_FAILED", { timeoutMs: 3000 }), { stage: "remote_refresh" }); socket.close(); }
      }, 3000);
      socket.onopen = () => send({ type: "hello", token: settings.token });
      socket.onmessage = event => {
        if (!current()) return;
        try {
          if (typeof event.data !== "string" || event.data.length > 4096) throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
          const message = JSON.parse(event.data);
          if (message.schemaVersion !== 1) throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
          if (message.type === "error") {
            diagnostic = globalThis.__slaiErrors.sanitizeDiagnostic(message.diagnostic);
            socket.close(); return;
          }
          if (message.type === "ready") {
            ready = true; clearTimeout(handshake); refreshRetryDelay = 2000;
            remoteRefreshResult = null;
            publishRefreshDiagnostic(null);
            clearInterval(refreshHeartbeat);
            // Chrome 116+ keeps an extension worker active when WebSocket
            // messages are exchanged within its 30-second activity window.
            refreshHeartbeat = setInterval(() => {
              if (!current()) return;
              if (Date.now() - lastPong > 45000) { socket.close(); return; }
              send({ type: "ping" });
            }, 20000);
            return;
          }
          if (!ready) throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
          if (message.type === "pong") { lastPong = Date.now(); return; }
          if (message.type !== "refresh" || !globalThis.__slaiRefresh.validId(message.id) || Object.keys(message).sort().join() !== "id,schemaVersion,type") throw globalThis.__slaiErrors.codedError("INVALID_SCHEMA");
          if (remoteRefreshResult?.id === message.id) { send(remoteRefreshResult); return; }
          send({ type: "result", id: message.id, status: "running", diagnostic: null });
          if (!remoteRefreshWork) {
            remoteRefreshWork = (async () => {
              // Reuse the same serialized collector as the desktop refresh button.
              await refreshAttendance();
              const state = await getState();
              await queueBridgePush(state);
              const bridge = await getBridgeInfo();
              if (!bridge.enabled) throw globalThis.__slaiErrors.codedError("REFRESH_CHANNEL_UNAVAILABLE");
              if (bridge.diagnostic) throw globalThis.__slaiErrors.codedError(bridge.diagnostic.code, bridge.diagnostic);
              return { status: state.status === "ok" ? "succeeded" : "failed", diagnostic: state.status === "ok" ? null : state.diagnostic || globalThis.__slaiErrors.diagnoseError(globalThis.__slaiErrors.codedError("REFRESH_RESULT_UNKNOWN"), { stage: "remote_refresh" }) };
            })().catch(error => ({ status: "failed", diagnostic: globalThis.__slaiErrors.diagnoseError(error, { stage: "remote_refresh", operation: "refresh" }) })).finally(() => { remoteRefreshWork = null; });
          }
          const id = message.id;
          remoteRefreshWork.then(result => {
            remoteRefreshResult = { type: "result", id, ...result };
            send(remoteRefreshResult);
          });
        } catch (error) {
          diagnostic = globalThis.__slaiErrors.diagnoseError(error.code ? error : globalThis.__slaiErrors.codedError("INVALID_SCHEMA"), { stage: "remote_refresh" });
          socket.close();
        }
      };
      socket.onerror = () => { /* The close event provides the observable failure. */ };
      socket.onclose = () => {
        clearTimeout(handshake);
        if (!current()) return;
        refreshSocket = null;
        clearInterval(refreshHeartbeat); refreshHeartbeat = null;
        publishRefreshDiagnostic(diagnostic || globalThis.__slaiErrors.diagnoseError(globalThis.__slaiErrors.codedError("REFRESH_CHANNEL_FAILED"), { stage: "remote_refresh" }));
        refreshRetry = setTimeout(ensureRemoteRefresh, refreshRetryDelay);
        refreshRetryDelay = Math.min(30000, refreshRetryDelay * 2);
      };
    } catch (error) {
      if (generation === refreshSocketGeneration) await publishRefreshDiagnostic(globalThis.__slaiErrors.diagnoseError(error.code ? error : globalThis.__slaiErrors.codedError("REFRESH_CHANNEL_FAILED", {}, error), { stage: "remote_refresh" }));
    }
  })().finally(() => { refreshConnect = null; if (generation !== refreshSocketGeneration) ensureRemoteRefresh(); });
  return refreshConnect;
}
