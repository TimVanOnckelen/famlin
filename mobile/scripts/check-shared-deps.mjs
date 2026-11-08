// mobile/ installs @famlin/api-client as a symlink (file:../packages/api-client),
// so tsc and Metro resolve the package's own @tanstack/react-query from the
// workspace root's node_modules, while mobile's code uses mobile/node_modules.
// Two different versions give two incompatible QueryClient classes: tsc fails
// with a cryptic "Property '#private' refers to a different member" error, and
// at runtime the app carries two copies of the library.
//
// Dependabot can't bump the root and mobile/ in one PR, so this check makes the
// mismatch fail with an actionable message instead. Compares the lockfiles only,
// so it needs no install.
//
// Usage: node scripts/check-shared-deps.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SHARED = ['@tanstack/react-query', '@tanstack/query-core']

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lockVersions = (dir) => {
  const packages = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).packages ?? {}
  return (name) => packages[`node_modules/${name}`]?.version
}
const root = lockVersions(path.resolve(mobileDir, '..'))
const mobile = lockVersions(mobileDir)

const mismatches = SHARED.filter((name) => root(name) !== mobile(name))
if (mismatches.length === 0) {
  console.log(`OK: ${SHARED.map((name) => `${name}@${mobile(name)}`).join(', ')} match the workspace root.`)
} else {
  for (const name of mismatches) {
    console.error(`MISMATCH: ${name} is ${root(name)} in the root workspace but ${mobile(name)} in mobile/.`)
  }
  const target = root('@tanstack/react-query')
  console.error(
    `\nmobile/ must use the same version as the workspace root (see the comment in this script). Fix with:\n` +
      `  cd mobile && npm install @tanstack/react-query@${target}`
  )
  process.exit(1)
}
