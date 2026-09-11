const { WebSocketServer, WebSocket } = require("ws");
require("../extension/refresh-utils.js");
const { codedError, diagnoseError, sanitizeDiagnostic } = globalThis.__slaiErrors;
const { validId, pending, sanitizeRefresh } = globalThis.__slaiRefresh;
const exact = (value, keys) => value && !Array.isArray(value) && Object.keys(value).sort().join() === keys.sort().join();
function createRefreshControl({ authenticate, now = Date.now, ackTimeoutMs = 10000, resultTimeoutMs = 1200000, cooldownMs = 10000 }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  let client = null, lastPing = 0, current = null, cooldownUntil = null;
  const recent = new Map();
  const stamp = () => new Date(now()).toISOString();
  const available = () => client?.readyState === WebSocket.OPEN && now() - lastPing <= 45000;
  function view(request = current) { return sanitizeRefresh({ schemaVersion: 1, available: !!available(), cooldownUntil, request }); }
  function fail(code, details = {}) {
    if (pending(current)) {
      current.status = "failed"; current.finishedAt = stamp();
      current.diagnostic = diagnoseError(codedError(code, details), { stage: "remote_refresh", operation: "refresh" });
    }
  }
  function send(socket, value) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ schemaVersion: 1, ...value })); }
  function remember(id, request) {
    recent.set(id, request);
    if (recent.size > 32) recent.delete(recent.keys().next().value);
  }
  function accept(socket) {
    let authenticated = false;
    const timer = setTimeout(() => socket.terminate(), 3000);
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timer);
      if (client === socket) { client = null; fail("REFRESH_CHANNEL_LOST"); }
    });
    socket.on("message", (raw, binary) => {
      try {
        if (binary) throw codedError("INVALID_SCHEMA");
        const message = JSON.parse(raw.toString());
        if (message.schemaVersion !== 1) throw codedError("INVALID_SCHEMA");
        if (!authenticated) {
          if (!exact(message, ["schemaVersion", "type", "token"]) || message.type !== "hello" || !authenticate(message.token)) throw codedError("BRIDGE_TOKEN");
          if (client && client !== socket) throw codedError("REFRESH_CHANNEL_BUSY");
          authenticated = true; client = socket; lastPing = now(); clearTimeout(timer);
          send(socket, { type: "ready" }); return;
        }
        if (message.type === "ping" && exact(message, ["schemaVersion", "type"])) {
          lastPing = now(); send(socket, { type: "pong" }); return;
        }
        if (!exact(message, ["schemaVersion", "type", "id", "status", "diagnostic"]) || message.type !== "result" || !validId(message.id) || !["running", "succeeded", "failed"].includes(message.status)) throw codedError("INVALID_SCHEMA");
        if (!current || message.id !== current.id || !pending(current)) return;
        if (message.status === "running") { current.status = "running"; current.startedAt ||= stamp(); return; }
        current.status = message.status; current.finishedAt = stamp();
        current.diagnostic = message.status === "failed" ? sanitizeDiagnostic(message.diagnostic) || diagnoseError(codedError("REFRESH_RESULT_UNKNOWN"), { stage: "remote_refresh" }) : null;
      } catch (error) {
        send(socket, { type: "error", diagnostic: diagnoseError(error.code ? error : codedError("INVALID_SCHEMA"), { stage: "remote_refresh" }) });
        socket.close(1008, "Invalid control message");
      }
    });
  }
  function upgrade(req, socket, head, port) {
    if (req.url !== "/api/control" || req.headers.host !== `127.0.0.1:${port}` || !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || "") || wss.clients.size >= 4) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); return;
    }
    wss.handleUpgrade(req, socket, head, accept);
  }
  function request(body) {
    if (!exact(body, ["schemaVersion", "id"]) || body.schemaVersion !== 1 || !validId(body.id)) throw codedError("INVALID_SCHEMA");
    if (recent.has(body.id)) return view(recent.get(body.id));
    if (pending(current)) { remember(body.id, current); return view(); }
    if (!available()) throw codedError("REFRESH_CHANNEL_UNAVAILABLE", { stage: "remote_refresh" });
    if (cooldownUntil && now() < Date.parse(cooldownUntil)) throw codedError("REFRESH_COOLDOWN", { stage: "remote_refresh", retryAfterSeconds: Math.ceil((Date.parse(cooldownUntil) - now()) / 1000) });
    current = { id: body.id, status: "queued", requestedAt: stamp(), startedAt: null, finishedAt: null, diagnostic: null };
    remember(body.id, current);
    cooldownUntil = new Date(now() + cooldownMs).toISOString();
    send(client, { type: "refresh", id: current.id });
    return view();
  }
  const monitor = setInterval(() => {
    if (client && !available()) client.terminate();
    if (current?.status === "queued" && now() - Date.parse(current.requestedAt) >= ackTimeoutMs) fail("REFRESH_ACK_TIMEOUT", { timeoutMs: ackTimeoutMs });
    if (current?.status === "running" && now() - Date.parse(current.startedAt) >= resultTimeoutMs) fail("REFRESH_RESULT_TIMEOUT", { timeoutMs: resultTimeoutMs });
  }, 1000);
  monitor.unref();
  async function close() {
    clearInterval(monitor);
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
  }
  return { view, request, upgrade, close };
}
module.exports = { createRefreshControl };
