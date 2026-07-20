// Guards against the RNWorklets class of launch crash: a native module that a
// direct dependency peer-depends on (e.g. react-native-reanimated 4 →
// react-native-worklets) is auto-installed into node_modules by npm, so tsc,
// Jest, and Metro all resolve it fine — but React Native community autolinking
// only links pods/gradle projects for *direct* dependencies, so the framework
// is missing from the native build and the app aborts at launch (dyld
// "Library not loaded"). Expo modules are exempt: expo-modules-autolinking
// scans node_modules, not package.json.
//
// Usage: node scripts/check-native-peer-deps.mjs [path-to-package.json]
// (the optional arg exists so tests can point it at a doctored manifest;
// module resolution always happens from mobile/node_modules)
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.argv[2] ?? path.join(mobileDir, 'package.json');
const require_ = createRequire(path.join(mobileDir, 'package.json'));

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const directDeps = Object.keys(readJson(manifestPath).dependencies ?? {});

function packageRoot(name) {
  try {
    // resolve the package's own package.json to survive "exports" maps
    return path.dirname(require_.resolve(`${name}/package.json`));
  } catch {
    try {
      const main = require_.resolve(name);
      const idx = main.lastIndexOf(`${path.sep}node_modules${path.sep}`);
      if (idx === -1) return null;
      const rel = main.slice(idx + 14);
      const parts = rel.split(path.sep);
      const dirs = parts[0].startsWith('@') ? 2 : 1;
      return main.slice(0, idx + 14) + parts.slice(0, dirs).join(path.sep);
    } catch {
      return null;
    }
  }
}

const isNative = (root) =>
  readdirSync(root).some((f) => f.endsWith('.podspec')) ||
  existsSync(path.join(root, 'android', 'build.gradle'));

const isExpoModule = (root) => existsSync(path.join(root, 'expo-module.config.json'));

const problems = [];
for (const dep of directDeps) {
  const depRoot = packageRoot(dep);
  if (!depRoot) continue;
  const peers = readJson(path.join(depRoot, 'package.json')).peerDependencies ?? {};
  for (const peer of Object.keys(peers)) {
    if (directDeps.includes(peer)) continue;
    const peerRoot = packageRoot(peer);
    if (!peerRoot) continue; // not installed → nothing gets bundled or linked
    if (isNative(peerRoot) && !isExpoModule(peerRoot)) {
      problems.push({ dep, peer });
    }
  }
}

if (problems.length > 0) {
  console.error('Native peer dependencies missing from mobile/package.json "dependencies":\n');
  for (const { dep, peer } of problems) {
    console.error(`  ${peer} (peer dependency of ${dep})`);
  }
  console.error(
    '\nThese packages are installed in node_modules, so JS checks pass — but React' +
      '\nNative autolinking only links native code for direct dependencies, so the' +
      '\nbuilt app will crash at launch with dyld "Library not loaded".' +
      '\nFix: cd mobile && npx expo install <package>',
  );
  process.exit(1);
}

console.log(`OK: no transitively-installed native peer dependencies (${directDeps.length} direct deps checked).`);
