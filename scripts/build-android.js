const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { unzipSync } = require('fflate');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const privateDir = path.join(root, 'local-data/android-signing');
const configFile = path.join(privateDir, 'signing.local.json');
const keyFile = path.join(privateDir, 'release.jks');
fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
let config;
if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
else {
  assert(!fs.existsSync(keyFile), 'SIGNING_CONFIG_MISSING: restore the matching local signing config before building.');
  config = { password: crypto.randomBytes(32).toString('hex') };
  fs.writeFileSync(configFile, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
}
assert(/^[a-f0-9]{64}$/.test(config.password), 'SIGNING_CONFIG_INVALID: restore the local signing config.');
const env = { ...process.env, SLAI_ANDROID_KEYSTORE: keyFile, SLAI_ANDROID_STORE_PASSWORD: config.password };
if (!fs.existsSync(keyFile)) {
  const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
  execFileSync(keytool, ['-genkeypair', '-keystore', keyFile, '-storetype', 'PKCS12', '-alias', 'slai-attendance', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=SLAI Attendance Local', '-storepass:env', 'SLAI_ANDROID_STORE_PASSWORD', '-keypass:env', 'SLAI_ANDROID_STORE_PASSWORD', '-noprompt'], { env, stdio: 'inherit' });
  fs.chmodSync(keyFile, 0o600);
}
const tasks = process.argv.includes('--test') ? ['connectedReleaseAndroidTest'] : ['assembleRelease', 'assembleReleaseAndroidTest', 'lintRelease'];
execFileSync(process.env.SLAI_GRADLE_EXECUTABLE || (process.platform === 'win32' ? 'gradlew.bat' : './gradlew'), ['--no-daemon', '--console=plain', ...tasks], { cwd: path.join(root, 'android'), env, stdio: 'inherit' });
const apk = fs.readFileSync(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'));
const entries = unzipSync(apk);
assert(entries['AndroidManifest.xml'] && entries['classes.dex']);
assert(entries['assets/web/index.html'] && entries['assets/web/android-collection.js']);
const expectedAssets = require('../release-files.json').androidAssets.map(name => 'assets/web/' + (name.startsWith('extension/') ? name.slice('extension/'.length) : path.basename(name)));
expectedAssets.push('assets/web/index.html', 'assets/web/android-collection.js');
assert.deepEqual(Object.keys(entries).filter(name => name.startsWith('assets/web/') && !name.endsWith('/')).sort(), expectedAssets.sort(), 'APK_WEB_ASSET_ALLOWLIST_MISMATCH');
assert(!Object.keys(entries).some(name => /(?:fixture|androidTest|\.jks$|\.keystore$|signing\.local)/i.test(name)), 'APK_CONTAINS_PRIVATE_OR_TEST_INPUT');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const name = `slai-attendance-android-v${require('../package.json').version}.apk`;
fs.writeFileSync(path.join(root, 'dist', name), apk);
fs.writeFileSync(path.join(root, 'dist/ANDROID-SHA256SUMS.txt'), `${crypto.createHash('sha256').update(apk).digest('hex')}  ${name}\n`);
console.log(`Built signed dist/${name} (${apk.length} bytes). Keep local-data/android-signing private and backed up for future updates.`);
