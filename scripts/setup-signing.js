/**
 * Patches android/app/build.gradle after expo prebuild to enable proper
 * release signing from environment variables.
 *
 * Env vars (set in CI):
 *   ANDROID_KEYSTORE_PATH      path relative to android/app/ (e.g. vegantrack-release.jks)
 *   ANDROID_KEYSTORE_PASSWORD  store password
 *   ANDROID_KEY_ALIAS          key alias
 *   ANDROID_KEY_PASSWORD       key password
 */
const fs = require('fs');
const path = require('path');

const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');

if (!fs.existsSync(gradlePath)) {
  console.error('build.gradle not found — run expo prebuild first');
  process.exit(1);
}

let g = fs.readFileSync(gradlePath, 'utf8');

// 1. Inject release signingConfig after the opening of signingConfigs {
const releaseConfig = `
        release {
            def ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ksPath) {
                storeFile file(ksPath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
                keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: ""
                keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: ""
            } else {
                // Fallback to debug signing if no keystore provided
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }`;

g = g.replace(/signingConfigs\s*\{/, `signingConfigs {${releaseConfig}\n`);

// 2. Switch the release buildType from signingConfigs.debug to signingConfigs.release.
//    Uses a state machine to avoid touching the debug buildType.
const lines = g.split('\n');
let inBuildTypes = false;
let inRelease = false;
let depth = 0;

const patched = lines.map((line) => {
  if (/buildTypes\s*\{/.test(line)) {
    inBuildTypes = true;
  }
  if (inBuildTypes && /^\s+release\s*\{/.test(line)) {
    inRelease = true;
    depth = 1;
    return line;
  }
  if (inRelease) {
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) {
      inRelease = false;
      inBuildTypes = false;
    } else if (line.includes('signingConfig signingConfigs.debug')) {
      return line.replace('signingConfigs.debug', 'signingConfigs.release');
    }
  }
  return line;
});

g = patched.join('\n');

fs.writeFileSync(gradlePath, g, 'utf8');
console.log('✅ Release signing config injected into build.gradle');
