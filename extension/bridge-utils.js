const BRIDGE_ALARM = "slai-local-bridge";
const BRIDGE_ORIGIN = "http://127.0.0.1/*";
let bridgePending = null;
let bridgeFlight = null;
let bridgeGeneration = 0;

async function getBridgeInfo() {
  try {
    const stored = await chrome.storage.local.get(["bridgeSettings", "bridgeDiagnostic", "refreshDiagnostic"]);
    return { enabled: stored.bridgeSettings?.enabled === true, diagnostic: globalThis.__slaiErrors.sanitizeDiagnostic(stored.bridgeDiagnostic), refreshDiagnostic: globalThis.__slaiErrors.sanitizeDiagnostic(stored.refreshDiagnostic) };
  } catch { throw globalThis.__slaiErrors.codedError("BRIDGE_SETTINGS", { stage: "bridge_settings" }); }
}
async function publishBridgeDiagnostic(diagnostic) {
  try {
    const clean = globalThis.__slaiErrors.sanitizeDiagnostic(diagnostic);
    await chrome.storage.local.set({ bridgeDiagnostic: clean });
    chrome.runtime.sendMessage({ type: "bridge-state", diagnostic: clean }).catch(() => {});
  } catch { /* A failed bridge status write must never fail attendance storage. */ }
}
function queueBridgePush(state) {
  bridgePending = globalThis.__slaiState.sanitizeState(state);
  if (bridgeFlight) return bridgeFlight;
  bridgeFlight = (async () => {
    while (bridgePending) {
      const next = bridgePending;
      bridgePending = null;
      const generation = bridgeGeneration;
      try {
        let settings;
        try { settings = (await chrome.storage.local.get("bridgeSettings")).bridgeSettings; }
        catch (error) { throw globalThis.__slaiErrors.codedError("BRIDGE_SETTINGS", { stage: "bridge_settings", operation: "storage_get" }, error); }
        if (!settings?.enabled) continue;
        if (!await chrome.permissions.contains({ origins: [BRIDGE_ORIGIN] })) throw globalThis.__slaiErrors.codedError("BRIDGE_PERMISSION");
        if (!/^[A-Za-z0-9_-]{43}$/.test(settings.token)) throw globalThis.__slaiErrors.codedError("BRIDGE_TOKEN");
        const body = JSON.stringify({ schemaVersion: 1, state: next });
        if (new TextEncoder().encode(body).length > 256 * 1024) throw globalThis.__slaiErrors.codedError("BODY_TOO_LARGE");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const response = await fetch("http://127.0.0.1:32101/api/state", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.token}` },
            body, signal: controller.signal, redirect: "error", credentials: "omit", cache: "no-store"
          });
          if (!response.ok) {
            let diagnostic;
            try { diagnostic = globalThis.__slaiErrors.sanitizeDiagnostic((await response.json()).diagnostic); } catch { /* Keep observed HTTP status. */ }
            throw globalThis.__slaiErrors.codedError(response.status === 401 ? "BRIDGE_TOKEN" : diagnostic?.code || "BRIDGE_HTTP", { ...diagnostic, httpStatus: response.status });
          }
        } catch (error) {
          if (controller.signal.aborted) throw globalThis.__slaiErrors.codedError("BRIDGE_TIMEOUT", { timeoutMs: 3000 });
          if (error.code) throw error;
          throw globalThis.__slaiErrors.codedError("BRIDGE_UNREACHABLE", {}, error);
        } finally { clearTimeout(timeout); }
        if (generation === bridgeGeneration) await publishBridgeDiagnostic(null);
      } catch (error) {
        if (generation === bridgeGeneration) await publishBridgeDiagnostic(globalThis.__slaiErrors.diagnoseError(error, { stage: "bridge_push", operation: "bridge_push" }));
      }
    }
  })().finally(() => { bridgeFlight = null; if (bridgePending) return queueBridgePush(bridgePending); });
  return bridgeFlight;
}
async function initializeBridge() {
  try {
    const { bridgeSettings: settings } = await chrome.storage.local.get("bridgeSettings");
    if (settings?.enabled === true && /^[A-Za-z0-9_-]{43}$/.test(settings.token)) {
      await chrome.storage.local.set({ bridgeSettings: { enabled: true, token: settings.token } });
      await chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 1 });
      if (typeof ensureRemoteRefresh === "function") ensureRemoteRefresh();
      queueBridgePush(await getState());
    } else {
      await chrome.storage.local.remove("bridgeSettings");
      await chrome.alarms.clear(BRIDGE_ALARM);
    }
  } catch (error) { await publishBridgeDiagnostic(globalThis.__slaiErrors.diagnoseError(globalThis.__slaiErrors.codedError("BRIDGE_SETTINGS"), { stage: "bridge_settings" })); }
}
async function configureBridge({ enabled, token }) {
  if (enabled && !/^[A-Za-z0-9_-]{43}$/.test(token || "")) throw globalThis.__slaiErrors.codedError("BRIDGE_TOKEN", { stage: "bridge_settings" });
  if (enabled && !await chrome.permissions.contains({ origins: [BRIDGE_ORIGIN] })) throw globalThis.__slaiErrors.codedError("BRIDGE_PERMISSION", { stage: "bridge_settings" });
  try {
    bridgeGeneration++;
    if (typeof stopRemoteRefresh === "function") stopRemoteRefresh();
    bridgePending = null;
    if (enabled) {
      await chrome.storage.local.set({ bridgeSettings: { enabled: true, token } });
      await chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 1 });
      await queueBridgePush(await getState());
      if (typeof ensureRemoteRefresh === "function") await ensureRemoteRefresh();
    } else {
      await chrome.storage.local.remove("bridgeSettings");
      await chrome.alarms.clear(BRIDGE_ALARM);
      await publishBridgeDiagnostic(null);
      if (typeof publishRefreshDiagnostic === "function") await publishRefreshDiagnostic(null);
    }
    return { ok: true, ...await getBridgeInfo() };
  } catch (error) { throw error.code ? error : globalThis.__slaiErrors.codedError("BRIDGE_SETTINGS", { stage: "bridge_settings" }); }
}
