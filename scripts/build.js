const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { zipSync, unzipSync } = require("fflate");
const { audit, root } = require("./audit");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const list = audit();
const dist = path.join(root, "dist");
const sums = [];
const version = require("../package.json").version;
function packageZip(output, entries) {
  const files = {};
  for (const [name, bytes] of Object.entries(entries)) {
    const executable = name.endsWith(".command") || name === "runtime/node";
    files[name] = [bytes, { mtime: new Date("2020-01-01T00:00:00Z"), os: 3, attrs: ((executable ? 0o100755 : 0o100644) << 16) >>> 0 }];
  }
  const zip = zipSync(files, { level: 6 });
  const unpacked = unzipSync(zip);
  assert.deepEqual(Object.keys(unpacked).sort(), Object.keys(entries).sort());
  for (const [name, bytes] of Object.entries(entries)) assert.deepEqual(Buffer.from(unpacked[name]), Buffer.from(bytes));
  fs.writeFileSync(path.join(dist, output), zip);
  sums.push(`${hash(zip)}  ${output}`);
  console.log(`Built and verified dist/${output} (${zip.length} bytes, ${Object.keys(entries).length} files).`);
}
async function main() {
  fs.mkdirSync(dist, { recursive: true });
  const extension = Object.fromEntries(list.archive.map(name => {
    const source = ["LICENSE", "PRIVACY.md"].includes(name) ? name : `extension/${name}`;
    assert(list.source.includes(source)); return [name, fs.readFileSync(path.join(root, source))];
  }));
  packageZip(`slai-attendance-widget-v${version}.zip`, extension);
  fs.writeFileSync(path.join(dist, "SHA256SUMS.txt"), sums.join("\n") + "\n");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
