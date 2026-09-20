const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
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
  assert.equal(manifest.optional_host_permissions, undefined);
  assert(!manifest.permissions.includes("cookies"));
  for (const name of list.source.filter((file) => file.startsWith("extension/") && /\.(?:js|html|css|json)$/.test(file))) {
    const content = fs.readFileSync(path.join(root, name), "utf8");
    assert(!/document\.cookie|chrome\.cookies|storage\.sync/.test(content), `Unexpected credential/sync API in ${name}`);
  }
  for (const name of list.iosInputs || []) {
    assert(list.source.includes(name), `iOS input missing from source allowlist: ${name}`);
    if (/\.js$/.test(name)) {
      assert(!/document\.cookie|chrome\.cookies|GM\.xmlHttpRequest|\beval\s*\(|new Function\s*\(/.test(fs.readFileSync(path.join(root, name), 'utf8')), `Unexpected API in Safari input: ${name}`);
    }
  }
  for (const [size, file] of Object.entries(manifest.icons)) {
    assert(list.archive.includes(file) && list.source.includes("extension/" + file));
    const png = fs.readFileSync(path.join(root, "extension", file));
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
  return list;
}

if (require.main === module) {
  audit();
  console.log(`Release audit passed: ${list.source.length} allowlisted files. Review demo.png visually before publishing.`);
}
module.exports = { audit, root };
