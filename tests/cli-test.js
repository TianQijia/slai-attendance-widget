const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { atomicWrite } = require("../companion/server");
const { sanitizeState } = globalThis.__slaiState;
const { codedError, diagnoseError, diagnosticReport } = globalThis.__slaiErrors;
const cli = path.join(__dirname, "../companion/cli.js");
const bindings = { "10.44.0.8": {}, "10.44.0.9": {} };

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "slai-cli-test-"));
  const dir = path.join(temp, "private data"), adapters = path.join(temp, "adapters.json"), hook = path.join(temp, "network fixture.cjs");
  let config, blocker;
  const env = { ...process.env, NODE_OPTIONS: `--require "${hook.replaceAll("\\", "/")}"`, SLAI_TEST_ADAPTERS: adapters };
  const noPrivate = text => {
    assert.doesNotMatch(text, /10\.44\.|PRIVATE_FIXTURE/);
    if (config) { assert(!text.includes(config.viewToken)); assert(!text.includes(config.writeToken)); }
  };
  const invoke = async (command, extra = []) => {
    const result = await execFile(process.execPath, [cli, command, "--headless", "--data-dir", dir, ...extra], { env, timeout: 20000, windowsHide: true });
    noPrivate(result.stdout + result.stderr); return result;
  };
  const select = hosts => fs.writeFile(adapters, JSON.stringify({ fixture: hosts.map(address => ({ address, family: "IPv4", internal: false })) }));
  const instance = async () => JSON.parse(await fs.readFile(path.join(dir, "instance.local.json"), "utf8"));
  const connection = () => fs.readFile(path.join(dir, "connection.html"), "utf8");
  const request = (host, port = 32100, headerHost = host) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: bindings[host]?.[port] || port, path: "/api/state", agent: false,
      headers: { Host: `${headerHost}:${port}`, Authorization: `Bearer ${config.viewToken}` } }, res => {
      const chunks = []; res.on("data", bytes => chunks.push(bytes));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on("error", reject); req.setTimeout(1000, () => req.destroy(new Error("Fixture request timed out"))); req.end();
  });
  const failure = async (command, code, extra = []) => {
    await assert.rejects(invoke(command, extra), error => {
      assert.match(error.stderr, new RegExp(code)); noPrivate(error.stdout + error.stderr); return true;
    });
  };
  try {
    // Reserve distinct loopback ports to simulate adapter changes on every OS.
    // The fixture preserves logical addresses/ports for the production checks.
    const reservations = [];
    try {
      for (const ports of Object.values(bindings)) for (const port of [32100, 32101]) {
        const server = http.createServer(); reservations.push(server);
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        ports[port] = server.address().port;
      }
    } finally { await Promise.all(reservations.map(server => new Promise(resolve => server.close(resolve)))); }
    // Production selection, process lifecycle, HTTP auth and Host checks remain
    // intact; no network adapter or firewall setting on the host is changed.
    await fs.writeFile(hook, `
const fs = require("node:fs"), os = require("node:os"), net = require("node:net"), http = require("node:http");
const bindings = ${JSON.stringify(bindings)};
os.networkInterfaces = () => JSON.parse(fs.readFileSync(process.env.SLAI_TEST_ADAPTERS, "utf8"));
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(port, host, ...rest) {
  if (!bindings[host]?.[port]) return listen.call(this, port, host, ...rest);
  const address = this.address.bind(this);
  this.address = () => { const value = address(); return value ? { ...value, port } : value; };
  return listen.call(this, bindings[host][port], "127.0.0.1", ...rest);
};
const request = http.request;
http.request = function(options, ...rest) {
  if (bindings[options.host]?.[options.port]) options = { ...options, host: "127.0.0.1", port: bindings[options.host][options.port], headers: { ...options.headers, Host: options.host + ":" + options.port } };
  return request.call(this, options, ...rest);
};
`);
    await select([]);
    await invoke("start");
    config = JSON.parse(await fs.readFile(path.join(dir, "config.local.json"), "utf8"));
    assert.equal((await instance()).lanHost, null);
    assert.match(await connection(), /http:\/\/127\.0\.0\.1:32100\/#token=/);
    assert.equal((await request("127.0.0.1")).status, 200);

    // Connecting Wi-Fi after a loopback-only launch must restart the listener.
    const loopback = await instance();
    await select(["10.44.0.8"]);
    await failure("info", "LAN_RESTART_REQUIRED");
    await invoke("start");
    const first = await instance();
    assert.notEqual(first.instanceId, loopback.instanceId);
    assert.equal(first.lanHost, "10.44.0.8");
    assert.equal((await request(first.lanHost)).status, 200);
    await invoke("start");
    await invoke("info");
    assert.equal((await instance()).instanceId, first.instanceId, "Repeated launches on the same adapter must reuse the service");
    const originalInfo = await connection();
    const originalChoice = await fs.readFile(path.join(dir, "network.local.json"), "utf8");

    // The old socket still answers, just as in the reported reproduction.
    await select(["10.44.0.9"]);
    assert.equal((await request("10.44.0.8")).status, 200);
    await failure("info", "LAN_RESTART_REQUIRED");
    assert.equal(await connection(), originalInfo, "Do not replace a verified link with an unbound address");
    assert.equal(await fs.readFile(path.join(dir, "network.local.json"), "utf8"), originalChoice);
    await invoke("start");
    const second = await instance();
    assert.notEqual(second.instanceId, first.instanceId);
    assert.equal(second.lanHost, "10.44.0.9");
    assert.match(await connection(), /http:\/\/10\.44\.0\.9:32100\/#token=/);
    assert.equal((await request(second.lanHost)).body.instanceId, second.instanceId);
    await assert.rejects(request("10.44.0.8"), "The old LAN listener must be closed");
    await assert.rejects(request(second.lanHost, 32101), "Writing must stay on loopback");
    assert.equal((await request(second.lanHost, 32100, "10.44.0.8")).status, 403, "Host validation must follow the new listener");

    // An explicit adapter change also matters when both NICs remain available.
    await select(["10.44.0.8", "10.44.0.9"]);
    await failure("info", "LAN_RESTART_REQUIRED", ["--host", "10.44.0.8"]);
    await invoke("start", ["--host", "10.44.0.8"]);
    assert.equal((await instance()).lanHost, "10.44.0.8");
    assert.equal((await request("10.44.0.8")).status, 200);
    await assert.rejects(request("10.44.0.9"));

    // Instance identity must be verified before stopping a PID or publishing.
    const verified = await instance();
    await atomicWrite(path.join(dir, "instance.local.json"), { ...verified, instanceId: "PRIVATE_FIXTURE" });
    await failure("start", "CONNECTION_UNCONFIRMED");
    await failure("info", "CONNECTION_UNCONFIRMED");
    assert.equal((await request("10.44.0.8")).body.instanceId, verified.instanceId);
    await atomicWrite(path.join(dir, "instance.local.json"), verified);
    // Older builds did not record the actual bind address; start upgrades them.
    await atomicWrite(path.join(dir, "instance.local.json"), { pid: verified.pid, instanceId: verified.instanceId });
    await failure("info", "CONNECTION_UNCONFIRMED");
    await invoke("start");
    assert.notEqual((await instance()).instanceId, verified.instanceId);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "config.local.json"), "utf8")), config, "Rebinding must preserve both pairing credentials");

    const beforeFailedBind = await connection();
    blocker = http.createServer((_req, res) => { res.end(); });
    await new Promise((resolve, reject) => { blocker.once("error", reject); blocker.listen(bindings["10.44.0.9"][32100], "127.0.0.1", resolve); });
    await failure("start", "PORT_IN_USE", ["--host", "10.44.0.9"]);
    assert.equal(await connection(), beforeFailedBind, "A failed new listener must not publish a link");
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "network.local.json"), "utf8")).host, "10.44.0.8");
    const bindFailure = JSON.parse(await fs.readFile(path.join(dir, "startup-diagnostic.local.json"), "utf8"));
    assert.equal(bindFailure.code, "PORT_IN_USE"); assert.equal(bindFailure.operation, "listen");
    assert.equal(bindFailure.port, 32100); assert.equal(bindFailure.systemCode, "EADDRINUSE");
    noPrivate(JSON.stringify(bindFailure));
    await new Promise(resolve => blocker.close(resolve)); blocker = null;
    await invoke("start", ["--host", "10.44.0.9"]);
    assert.equal((await request("10.44.0.9")).status, 200);
    await assert.rejects(fs.access(path.join(dir, "startup-diagnostic.local.json")), "Successful startup clears the old diagnostic");

    await select([]);
    await failure("info", "LAN_RESTART_REQUIRED");
    await invoke("start");
    assert.equal((await instance()).lanHost, null);
    await assert.rejects(request("10.44.0.8"));
    assert.equal((await request("127.0.0.1")).status, 200);
    await invoke("stop");
    const stoppedInfo = await connection();
    await failure("info", "ECONNREFUSED");
    assert.equal(await connection(), stoppedInfo, "A stopped service must not produce a new unverified link");

    for (const code of ["LAN_RESTART_REQUIRED", "CONNECTION_UNCONFIRMED"]) {
      const diagnostic = diagnoseError(codedError(code, { stage: "companion_start", port: 32100, token: "PRIVATE_FIXTURE" }));
      const cached = sanitizeState({ status: "error", diagnostic: { ...diagnostic, message: "PRIVATE_FIXTURE", host: "10.44.0.8" } });
      assert.equal(cached.diagnostic.code, code); assert.equal(cached.diagnostic.stage, "companion_start");
      assert.equal(cached.diagnostic.port, 32100);
      const report = diagnosticReport(cached.diagnostic);
      assert.match(report, /start/); noPrivate(JSON.stringify(cached)); noPrivate(report);
    }
    console.log("Passed: CLI Wi-Fi/NIC rebinding, authenticated listener verification, offline and stale-link prevention, instance identity, legacy upgrade, loopback isolation and diagnostic privacy.");
  } finally {
    if (blocker) await new Promise(resolve => blocker.close(resolve));
    await invoke("stop").catch(() => {});
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert(path.basename(temp).startsWith("slai-cli-test-"));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
