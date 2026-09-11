const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const list = JSON.parse(fs.readFileSync(path.join(root, "release-files.json"), "utf8"));

function audit() {
  assert.equal(new Set(list.source).size, list.source.length);
  for (const name of list.source) {
    assert(!path.isAbsolute(name) && !name.split("/").includes(".."), "Unsafe release path");
    assert(!fs.lstatSync(path.join(root, name)).isSymbolicLink(), "Symlinks are not release inputs");
    const data = fs.readFileSync(path.join(root, name));
    if (name.endsWith(".png")) {
      assert.equal(data.subarray(1, 4).toString(), "PNG");
      continue;
    }
    const content = data.toString("utf8");
    const forbidden = [
      /[A-Za-z]:\\Users\\[^\\\s]+/,
      /[\w.+-]+@slai\.edu\.cn/i,
      /JSESSIONID=[a-f0-9]{20,}/i,
      /gh[pousr]_[A-Za-z0-9]{20,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/
    ];
    assert(!forbidden.some((pattern) => pattern.test(content)), `Sensitive content pattern in ${name}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  assert.equal(manifest.version, require("../package.json").version);
  assert.deepEqual(manifest.host_permissions, ["https://stu.slai.edu.cn/*", "https://sts.slai.edu.cn/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["http://127.0.0.1/*"]);
  assert(!manifest.permissions.includes("cookies"));
  for (const entries of [list.companion, ...Object.values(list.companionPlatforms)]) {
    assert.equal(new Set(entries).size, entries.length);
    for (const name of entries) assert(list.source.includes(name));
  }
  assert.equal(require("../node_modules/ws/package.json").version, require("../package.json").dependencies.ws);
  for (const [name, sha256] of Object.entries(list.companionDependencies)) {
    assert(/^node_modules\/ws\/(?:lib\/)?[A-Za-z0-9_.-]+$/.test(name), "Unexpected bundled dependency path");
    assert(!fs.lstatSync(path.join(root, name)).isSymbolicLink());
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex"), sha256, `Bundled dependency differs from its allowlisted SHA-256: ${name}`);
  }
  for (const name of list.source.filter((file) => file.startsWith("extension/"))) {
    const content = fs.readFileSync(path.join(root, name), "utf8");
    assert(!/document\.cookie|chrome\.cookies|storage\.sync/.test(content), `Unexpected credential/sync API in ${name}`);
  }
  return list;
}

if (require.main === module) {
  audit();
  console.log(`Release audit passed: ${list.source.length} allowlisted files. Review demo.png visually before publishing.`);
}
module.exports = { audit, root };
