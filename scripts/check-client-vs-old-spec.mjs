#!/usr/bin/env node
// Checks that every endpoint @famlin/api-client calls exists on the OLDEST
// server release the apps still support (issue #382, epic #378).
//
// New mobile apps talk to older self-hosted servers: the support window is
// the current release's minor version minus 3 (app 0.8.x → servers >= 0.5.0).
// The `api-breaking-changes` CI job covers the other direction (a new server
// must not break old clients); this one covers new clients vs old servers.
//
// How it works:
//   1. Collects every `api.get/post/put/patch/delete(...)` call in
//      packages/api-client/src/*.ts whose path is a string or template
//      literal, normalizing `${...}` to a path parameter and prefixing the
//      client's `/api` base URL (see setApiBaseUrl() in client.ts).
//   2. Reads docs/openapi/famlin.yaml as it was at the oldest supported
//      release tag (`git show <tag>:docs/openapi/famlin.yaml`).
//   3. Fails for every call whose method + path template is missing there,
//      unless it is
//        - feature-gated: a `// requires-feature: <id>` comment in the
//          comment block directly above the call, where <id> is listed in
//          backend/src/serverFeatures.ts (callers must check
//          serverSupports(serverInfo, '<id>') before using it), or
//        - allowlisted in scripts/client-compat-allowlist.json with a reason
//          (for legacy cases, e.g. an endpoint the old server had but its
//          spec didn't document).
//
// Usage: node scripts/check-client-vs-old-spec.mjs [--tag vX.Y.Z]
//   The tag can also come from CLIENT_COMPAT_TAG. Needs the release tags in
//   the local clone (CI: actions/checkout with fetch-depth: 0).
//
// Only axios calls through `api` are seen. A URL built by hand for a native
// downloader (getMyExportRequest() in auth.ts) isn't, so its endpoint must
// also have an `api` call or allowlist entry covering it.
//
// Dependency-free on purpose: only path keys and their method keys are read
// from the spec, so a tiny line-based extractor stands in for a YAML parser.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_PATH = 'docs/openapi/famlin.yaml'
const CLIENT_DIR = join(root, 'packages/api-client/src')
const FEATURES_FILE = join(root, 'backend/src/serverFeatures.ts')
const ALLOWLIST_FILE = join(root, 'scripts/client-compat-allowlist.json')
const API_BASE = '/api' // client.ts: currentBaseUrl = `${serverUrl}/api`
const SUPPORTED_MINOR_VERSIONS_BACK = 3
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// --- 1. Which release is the oldest supported one? -------------------------

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? m.slice(1, 4).map(Number) : null
}

function compareVersions(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function resolveOldestTag() {
  const argIndex = process.argv.indexOf('--tag')
  const override = argIndex !== -1 ? process.argv[argIndex + 1] : process.env.CLIENT_COMPAT_TAG
  if (override) return { tag: override, reason: 'explicit override' }

  const current = JSON.parse(readFileSync(join(root, 'mobile/package.json'), 'utf8')).version
  const [major, minor] = parseVersion(current) ?? fail(`Unparseable mobile/package.json version "${current}"`)
  const floor = [major, Math.max(0, minor - SUPPORTED_MINOR_VERSIONS_BACK), 0]
  const tags = git('tag', '--list', 'v*')
    .split('\n')
    .map((t) => ({ tag: t.trim(), version: parseVersion(t.trim()) }))
    .filter((t) => t.version && compareVersions(t.version, floor) >= 0)
    .sort((a, b) => compareVersions(a.version, b.version))
  if (tags.length === 0) {
    fail(
      `No release tag >= v${floor.join('.')} found. Fetch tags (CI: actions/checkout with fetch-depth: 0) ` +
        'or pass --tag / CLIENT_COMPAT_TAG.'
    )
  }
  return {
    tag: tags[0].tag,
    reason: `app ${current} supports servers down to ${major}.${floor[1]}.0 (${SUPPORTED_MINOR_VERSIONS_BACK} minor versions back); earliest release tag at or above that`,
  }
}

// --- 2. Endpoints documented in the old spec -------------------------------

function normalizePath(path) {
  return path.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/'
}

// Reads `paths:` → `  /some/path:` → `    get:` from the spec. Only those
// two indentation levels under the top-level `paths:` key matter here.
function extractSpecOperations(yaml) {
  const ops = new Set()
  let inPaths = false
  let currentPath = null
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) {
      inPaths = /^paths:\s*$/.test(line)
      currentPath = null
      continue
    }
    if (!inPaths) continue
    const pathMatch = /^ {2}(['"]?)(\/[^'"]*)\1:\s*$/.exec(line)
    if (pathMatch) {
      currentPath = normalizePath(pathMatch[2])
      continue
    }
    const methodMatch = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line)
    if (methodMatch && currentPath) ops.add(`${methodMatch[1].toUpperCase()} ${currentPath}`)
  }
  return ops
}

function loadOldSpec(tag) {
  try {
    git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)
  } catch {
    fail(`Tag ${tag} not found locally. Fetch tags (CI: actions/checkout with fetch-depth: 0).`)
  }
  try {
    return git('show', `${tag}:${SPEC_PATH}`)
  } catch {
    // Deliberately no fallback to a newer tag: that would silently check
    // against a server newer than the oldest supported one and miss exactly
    // the endpoints this check exists to catch.
    fail(
      `${SPEC_PATH} does not exist at ${tag}, so there is no spec for the oldest supported server. ` +
        'Pick the oldest tag that has one with --tag / CLIENT_COMPAT_TAG, knowingly narrowing the check.'
    )
  }
}

// --- 3. Endpoints the client calls -----------------------------------------

function loadFeatureIds() {
  const source = readFileSync(FEATURES_FILE, 'utf8')
  const list = /SERVER_FEATURES\s*=\s*\[([\s\S]*?)\]/.exec(source)
  if (!list) fail(`Could not find SERVER_FEATURES in ${relative(root, FEATURES_FILE)}`)
  const body = list[1].replace(/\/\/.*$/gm, '')
  return new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]))
}

// Skips an optional generic argument (`<{ items: Foo[] }>`), balancing angle
// brackets, and returns the index just past it.
function skipGeneric(src, i) {
  while (/\s/.test(src[i])) i++
  if (src[i] !== '<') return i
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '<') depth++
    else if (src[i] === '>' && src[i - 1] !== '=' && --depth === 0) return i + 1
  }
  return i
}

// The `//` comment lines directly above `lineIndex`, nearest first.
function commentBlockAbove(lines, lineIndex) {
  const block = []
  for (let i = lineIndex - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) block.push(lines[i])
  return block
}

function collectClientCalls() {
  const calls = []
  const unparsed = []
  const files = readdirSync(CLIENT_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  for (const file of files) {
    const src = readFileSync(join(CLIENT_DIR, file), 'utf8')
    const lines = src.split('\n')
    const callRe = new RegExp(`\\bapi\\.(${METHODS.join('|')})\\b`, 'g')
    for (const match of src.matchAll(callRe)) {
      const lineIndex = src.slice(0, match.index).split('\n').length - 1
      const location = `packages/api-client/src/${file}:${lineIndex + 1}`
      let i = skipGeneric(src, match.index + match[0].length)
      if (src[i] !== '(') continue // e.g. a reference, not a call
      i++
      while (/\s/.test(src[i])) i++
      const quote = src[i]
      if (!`'"\``.includes(quote)) {
        unparsed.push(location)
        continue
      }
      // Read the literal; for template literals, replace each `${...}`
      // (balancing braces) with a path parameter.
      let path = ''
      for (i++; i < src.length && src[i] !== quote; i++) {
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 0
          for (i++; i < src.length; i++) {
            if (src[i] === '{') depth++
            else if (src[i] === '}' && --depth === 0) break
          }
          path += '{}'
        } else {
          path += src[i]
        }
      }
      const feature = commentBlockAbove(lines, lineIndex)
        .map((l) => /requires-feature:\s*([\w-]+)/.exec(l)?.[1])
        .find(Boolean)
      calls.push({
        method: match[1].toUpperCase(),
        path: normalizePath(`${API_BASE}${path.split('?')[0]}`),
        location,
        feature,
      })
    }
  }
  return { calls, unparsed }
}

// --- Run ---------------------------------------------------------------------

const { tag, reason } = resolveOldestTag()
const specOps = extractSpecOperations(loadOldSpec(tag))
if (specOps.size === 0) fail(`No operations found under paths: in ${SPEC_PATH} at ${tag} — extractor out of date?`)
const featureIds = loadFeatureIds()
const allowlist = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8')).entries
const { calls, unparsed } = collectClientCalls()

console.log(`Oldest supported server: ${tag} (${reason})`)
console.log(`${specOps.size} operations in its spec, ${calls.length} api-client calls checked.\n`)

const errors = []
const notes = []
const usedAllowlist = new Set()

for (const location of unparsed) {
  errors.push(`${location}: path is not a string/template literal — the check can't read it`)
}

for (const call of calls) {
  const op = `${call.method} ${call.path}`
  if (call.feature && !featureIds.has(call.feature)) {
    errors.push(`${call.location}: ${op} — unknown feature id "${call.feature}" (not in backend/src/serverFeatures.ts)`)
    continue
  }
  if (specOps.has(op)) continue
  if (call.feature) {
    notes.push(`gated   ${op}  (requires-feature: ${call.feature}, ${call.location})`)
    continue
  }
  const allowed = allowlist.find((e) => `${e.method.toUpperCase()} ${normalizePath(e.path)}` === op)
  if (allowed) {
    usedAllowlist.add(allowed)
    notes.push(`allowed ${op}  (${allowed.reason})`)
    continue
  }
  errors.push(`${call.location}: ${op} is not in ${SPEC_PATH} at ${tag}`)
}

for (const note of notes) console.log(`  ${note}`)
for (const entry of allowlist.filter((e) => !usedAllowlist.has(e))) {
  // A warning, not an error: the window moving forward (a version bump in
  // the release PR) can make an entry unnecessary, and that must not fail CI.
  console.log(
    `  ⚠ unused allowlist entry: ${entry.method} ${entry.path} — remove it from scripts/client-compat-allowlist.json`
  )
}

if (errors.length > 0) {
  console.error(`\n✖ ${errors.length} problem(s) with api-client calls vs the oldest supported server:\n`)
  for (const e of errors) console.error(`  ${e}`)
  console.error(
    '\nIf the endpoint is new, add a `// requires-feature: <id>` comment directly above the call (an id from ' +
      'backend/src/serverFeatures.ts, adding a new one if needed) and gate its use with serverSupports(). If the ' +
      'old server did have it but the spec did not document it, list it in scripts/client-compat-allowlist.json ' +
      'with a reason. See "Supporting older servers" in docs/developers/contributing.md.'
  )
  process.exit(1)
}
console.log('\n✔ Every api-client call is available on the oldest supported server, feature-gated, or allowlisted.')
