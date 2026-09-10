const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { zipSync, unzipSync } = require("fflate");
const { audit, root } = require("./audit");
const list = audit();
const files = {};
for (const name of list.archive) {
  const source = ["LICENSE", "PRIVACY.md"].includes(name) ? name : `extension/${name}`;
  assert(list.source.includes(source));
  files[name] = [fs.readFileSync(path.join(root, source)), { mtime: new Date("2020-01-01T00:00:00Z") }];
}
const zip = zipSync(files, { level: 9 });
const unpacked = unzipSync(zip);
assert.deepEqual(Object.keys(unpacked).sort(), [...list.archive].sort());
for (const [name, [data]] of Object.entries(files)) assert.deepEqual(Buffer.from(unpacked[name]), data);
const version = require("../package.json").version;
const output = `slai-attendance-widget-v${version}.zip`;
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", output), zip);
fs.writeFileSync(path.join(root, "dist", "SHA256SUMS.txt"), `${crypto.createHash("sha256").update(zip).digest("hex")}  ${output}\n`);
console.log(`Built and verified dist/${output} (${zip.length} bytes, ${list.archive.length} files).`);
