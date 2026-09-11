const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { LIMIT, validateStateEnvelope } = require("./protocol");
const { createRefreshControl } = require("./refresh-control");
const { codedError, diagnoseError } = globalThis.__slaiErrors;
const root = path.resolve(__dirname, "..");
const PRIVATE_IP = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const isPrivate = value => typeof value === "string" && PRIVATE_IP.test(value) && value.split(".").every(n => Number(n) <= 255);
async function atomicWrite(file, value) {
  const temporary = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
async function loadConfig(dir) {
  try { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); }
  catch (error) { throw codedError("CONFIG_FAILED", { stage: "companion_start", systemCode: error.code }); }
  const file = path.join(dir, "config.local.json");
  try {
    const config = JSON.parse(await fs.readFile(file, "utf8"));
    if (!/^[A-Za-z0-9_-]{43}$/.test(config.writeToken) || !/^[A-Za-z0-9_-]{43}$/.test(config.viewToken) || config.writeToken === config.viewToken) throw new Error();
    return { writeToken: config.writeToken, viewToken: config.viewToken };
  } catch (error) {
    if (error.code !== "ENOENT") throw codedError("CONFIG_FAILED", { stage: "companion_start", systemCode: error.code });
    const config = { writeToken: crypto.randomBytes(32).toString("base64url"), viewToken: crypto.randomBytes(32).toString("base64url") };
    try {
      // Exclusive creation prevents concurrent launchers from rotating credentials.
      await fs.writeFile(file, JSON.stringify(config), { flag: "wx", mode: 0o600 });
      return config;
    } catch (error) {
      if (error.code === "EEXIST") return loadConfig(dir);
      throw codedError("CONFIG_FAILED", { stage: "companion_start", systemCode: error.code });
    }
  }
}
function tokenMatches(header, token) {
  const expected = Buffer.from("Bearer " + token);
  const actual = Buffer.from(typeof header === "string" ? header : "");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
const staticFiles = {
  "/": ["companion/viewer.html", "text/html; charset=utf-8"],
  "/viewer.js": ["companion/viewer.js", "text/javascript; charset=utf-8"],
  "/viewer-refresh.js": ["companion/viewer-refresh.js", "text/javascript; charset=utf-8"],
  "/widget.css": ["extension/widget.css", "text/css; charset=utf-8"],
  "/view.js": ["extension/view.js", "text/javascript; charset=utf-8"],
  "/report-utils.js": ["extension/report-utils.js", "text/javascript; charset=utf-8"],
  "/refresh-utils.js": ["extension/refresh-utils.js", "text/javascript; charset=utf-8"],
  "/time-utils.js": ["extension/time-utils.js", "text/javascript; charset=utf-8"],
  "/state-utils.js": ["extension/state-utils.js", "text/javascript; charset=utf-8"],
  "/error-utils.js": ["extension/error-utils.js", "text/javascript; charset=utf-8"],
  "/network-report.js": ["companion/network-report.js", "text/javascript; charset=utf-8"]
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const timer = setTimeout(() => finish(codedError("REQUEST_TIMEOUT", { timeoutMs: 3000 })), 3000);
    req.on("data", chunk => {
      if (done) return;
      size += chunk.length;
      if (size > LIMIT) finish(codedError("BODY_TOO_LARGE")); else chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(codedError("INVALID_SCHEMA")); }
    });
    req.on("error", () => finish(codedError("INVALID_SCHEMA")));
    req.on("aborted", () => finish(codedError("INVALID_SCHEMA")));
    if (Number(req.headers["content-length"]) > LIMIT) finish(codedError("BODY_TOO_LARGE"));
  });
}
async function createCompanion({ dir, lanHost = null, readPort = 32100, writePort = 32101, now = Date.now, persist = atomicWrite } = {}) {
  const config = await loadConfig(dir);
  const instanceId = crypto.randomUUID();
  let state = null, receivedAt = null, lastSeenAt = null, startupDiagnostic = null;
  const stateFile = path.join(dir, "attendance.json");
  try {
    const cached = JSON.parse(await fs.readFile(stateFile, "utf8"));
    state = validateStateEnvelope({ schemaVersion: cached.schemaVersion, state: cached.state });
    if (!Number.isFinite(Date.parse(cached.receivedAt))) throw new Error();
    receivedAt = cached.receivedAt;
  } catch (error) {
    state = null;
    if (error.code !== "ENOENT") startupDiagnostic = diagnoseError(codedError("CACHE_READ_FAILED", { systemCode: error.code }), { stage: "companion_read" });
  }
  const servers = [];
  const refreshControl = createRefreshControl({ authenticate: token => tokenMatches("Bearer " + token, config.writeToken), now });
  let writeQueue = Promise.resolve();
  const headers = {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  };
  const respond = (res, status, value) => { res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); };
  function handler(write, host, getPort) {
    return async (req, res) => {
      try {
        if (req.headers.host !== `${host}:${getPort()}`) throw codedError("ORIGIN_DENIED");
        if (write) {
          if (req.method !== "POST") throw codedError("METHOD_NOT_ALLOWED");
          if (req.url !== "/api/state") { respond(res, 404, {}); return; }
          if (req.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin)) throw codedError("ORIGIN_DENIED");
          if (!tokenMatches(req.headers.authorization, config.writeToken)) throw codedError("BRIDGE_TOKEN");
          if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw codedError("INVALID_SCHEMA");
          const next = validateStateEnvelope(await readBody(req));
          const work = writeQueue.then(async () => {
            const accepted = new Date(now()).toISOString();
            try { await persist(stateFile, { schemaVersion: 1, state: next, receivedAt: accepted }); }
            catch (error) { throw codedError("CACHE_WRITE_FAILED", { stage: "companion_write", operation: "persist", systemCode: error.code }); }
            state = next; receivedAt = accepted; lastSeenAt = accepted; startupDiagnostic = null;
          });
          writeQueue = work.catch(() => {});
          await work;
          respond(res, 200, { ok: true });
        } else {
          if (req.url === "/api/refresh") {
            if (req.method !== "POST") throw codedError("METHOD_NOT_ALLOWED");
            if (!tokenMatches(req.headers.authorization, config.viewToken)) throw codedError("ACCESS_DENIED");
            if (req.headers.origin !== `http://${host}:${getPort()}`) throw codedError("ORIGIN_DENIED");
            if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw codedError("INVALID_SCHEMA");
            const refresh = refreshControl.request(await readBody(req));
            respond(res, 202, { schemaVersion: 1, instanceId, refresh, serverTime: new Date(now()).toISOString() }); return;
          }
          if (req.method !== "GET") throw codedError("METHOD_NOT_ALLOWED");
          if (req.url === "/api/state") {
            if (!tokenMatches(req.headers.authorization, config.viewToken)) throw codedError("ACCESS_DENIED");
            respond(res, 200, { schemaVersion: 1, instanceId, state, receivedAt, lastSeenAt, serverTime: new Date(now()).toISOString(), diagnostic: startupDiagnostic, refresh: refreshControl.view() });
          } else {
            const entry = staticFiles[req.url];
            if (!entry) { respond(res, 404, {}); return; }
            const bytes = await fs.readFile(path.join(root, entry[0]));
            res.writeHead(200, { ...headers, "Content-Type": entry[1] }); res.end(bytes);
          }
        }
      } catch (error) {
        const diagnostic = diagnoseError(error, { stage: "companion_request", operation: "http_request" });
        const status = { BRIDGE_TOKEN: 401, ACCESS_DENIED: 401, ORIGIN_DENIED: 403, METHOD_NOT_ALLOWED: 405, INVALID_SCHEMA: 400, BODY_TOO_LARGE: 413, REQUEST_TIMEOUT: 408, REFRESH_CHANNEL_UNAVAILABLE: 409, REFRESH_COOLDOWN: 429 }[diagnostic.code] || 500;
        if (!res.headersSent) respond(res, status, { ok: false, diagnostic }); else res.end();
      }
    };
  }
  async function listen(write, host, port) {
    let server;
    server = http.createServer(handler(write, host, () => server.address().port));
    server.on("upgrade", (req, socket, head) => {
      if (write) refreshControl.upgrade(req, socket, head, server.address().port);
      else socket.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    server.requestTimeout = 5000; server.headersTimeout = 5000;
    servers.push(server);
    try { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); }); }
    catch (error) { throw codedError(error.code === "EADDRINUSE" ? "PORT_IN_USE" : "LISTEN_FAILED", { stage: "companion_start", operation: "listen", port, systemCode: error.code }); }
    return server.address().port;
  }
  async function close() {
    await refreshControl.close();
    await writeQueue;
    await Promise.all(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
  }
  try {
    if (lanHost && !isPrivate(lanHost)) throw codedError("LISTEN_FAILED", { stage: "companion_start", port: readPort });
    const actualRead = await listen(false, "127.0.0.1", readPort);
    if (lanHost) await listen(false, lanHost, actualRead);
    const actualWrite = await listen(true, "127.0.0.1", writePort);
    return { config, instanceId, readPort: actualRead, writePort: actualWrite, lanHost, close, startupDiagnostic };
  } catch (error) { await close(); throw error; }
}
module.exports = { createCompanion, atomicWrite, loadConfig, isPrivate };
