import { readFileSync, writeFileSync } from 'node:fs'
import { resolveTokens, renderCss, renderTypeScript } from './transform.mjs'

const source = JSON.parse(readFileSync(new URL('../src/tokens.json', import.meta.url), 'utf8'))
const tokens = resolveTokens(source)
for (const [path, content] of [
  ['../tokens.css', renderCss(tokens)],
  ['../src/generated.ts', renderTypeScript(tokens)],
]) {
  const target = new URL(path, import.meta.url)
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content) throw new Error(`Stale ${path}: run npm run generate`)
  } else writeFileSync(target, content)
}
