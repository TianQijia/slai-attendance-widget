const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { zipSync, unzipSync } = require("fflate");
const { audit, root } = require("./audit");
const runtimes = require("../runtime-downloads.json");
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
async function runtimeFiles(platform) {
  const spec = runtimes[platform];
  const cache = path.join(dist, ".runtime-cache"); fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, spec.file);
  let bytes = fs.existsSync(archive) ? fs.readFileSync(archive) : null;
  if (!bytes || hash(bytes) !== spec.sha256) {
    const base = process.env.SLAI_RUNTIME_MIRROR === "1" ? "https://npmmirror.com/mirrors/node" : "https://nodejs.org/dist";
    const response = await fetch(`${base}/v${runtimes.version}/${spec.file}`, { signal: AbortSignal.timeout(120000) });
    assert(response.ok, `Official runtime download returned HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(bytes), spec.sha256, "Runtime checksum differs from the pinned official checksum");
    fs.writeFileSync(archive, bytes);
  }
  assert.equal(hash(bytes), spec.sha256);
  const prefix = `node-v${runtimes.version}-${platform}`;
  let binary, license;
  if (spec.file.endsWith(".zip")) {
    const files = unzipSync(bytes, { filter: entry => [prefix + "/" + spec.binary, prefix + "/LICENSE"].includes(entry.name) });
    binary = files[prefix + "/" + spec.binary]; license = files[prefix + "/LICENSE"];
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", cache, prefix + "/" + spec.binary, prefix + "/LICENSE"], { stdio: "pipe" });
    binary = fs.readFileSync(path.join(cache, prefix, spec.binary)); license = fs.readFileSync(path.join(cache, prefix, "LICENSE"));
  }
  assert(binary?.length && license?.length, "Missing allowlisted runtime files");
  return { [platform.startsWith("win") ? "runtime/node.exe" : "runtime/node"]: binary, "runtime/LICENSE": license };
}
async function main() {
  fs.mkdirSync(dist, { recursive: true });
  const extension = Object.fromEntries(list.archive.map(name => {
    const source = ["LICENSE", "PRIVACY.md"].includes(name) ? name : `extension/${name}`;
    assert(list.source.includes(source)); return [name, fs.readFileSync(path.join(root, source))];
  }));
  packageZip(`slai-attendance-widget-v${version}.zip`, extension);
  // Build only the current target in CI; local default builds both deliverables.
  const targets = process.env.SLAI_BUILD_TARGET ? [process.env.SLAI_BUILD_TARGET] : Object.keys(list.companionPlatforms);
  for (const platform of targets) {
    assert(Object.hasOwn(list.companionPlatforms, platform), "Unknown build target");
    const names = [...list.companion, ...list.companionPlatforms[platform]];
    const entries = Object.fromEntries(names.map(name => { assert(list.source.includes(name)); return [name, fs.readFileSync(path.join(root, name))]; }));
    Object.assign(entries, await runtimeFiles(platform));
    packageZip(`slai-attendance-companion-v${version}-${platform}.zip`, entries);
  }
  fs.writeFileSync(path.join(dist, "SHA256SUMS.txt"), sums.join("\n") + "\n");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
