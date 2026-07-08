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

if (hasTsc()) {
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
