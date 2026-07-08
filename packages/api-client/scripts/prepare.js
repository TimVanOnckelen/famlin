const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');

function hasTsc() {
  try {
    execSync('tsc --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasDependencies() {
  // When installed as a file: dependency, devDependencies of this package are
  // not necessarily available (e.g. EAS/cloud builds). Compiling then fails
  // with "Cannot find module 'axios'" even though committed dist/ is usable.
  return (
    existsSync('node_modules/axios') &&
    existsSync('node_modules/@tanstack/react-query')
  );
}

if (!hasDependencies()) {
  if (!existsSync('dist/index.js')) {
    console.error(
      '[@famlin/api-client] Dependencies are not installed and dist/ is missing. ' +
        'Run `npm run build` in packages/api-client before installing mobile.'
    );
    process.exit(1);
  }
  console.warn(
    '[@famlin/api-client] Dependencies not available; using existing dist/. Do not edit source files in this environment.'
  );
} else if (hasTsc()) {
  execSync('tsc -p tsconfig.build.json', { stdio: 'inherit' });
} else if (!existsSync('dist/index.js')) {
  console.error(
    '[@famlin/api-client] tsc is not available and dist/ is missing. ' +
      'Run `npm run build` in packages/api-client before installing mobile.'
  );
  process.exit(1);
} else {
  console.warn(
    '[@famlin/api-client] tsc is not available; using existing dist/.'
  );
}
