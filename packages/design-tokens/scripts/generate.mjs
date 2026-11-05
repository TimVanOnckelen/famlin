import { readFileSync, writeFileSync } from 'node:fs'
const tokens = JSON.parse(readFileSync(new URL('../src/tokens.json', import.meta.url), 'utf8'))
const css =
  '/* Generated from src/tokens.json. Run npm run generate. */\n:root {\n' +
  Object.entries(tokens)
    .map(([key, value]) => `  --${key}: ${value};`)
    .join('\n') +
  '\n}\n'
const target = new URL('../tokens.css', import.meta.url)
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== css) throw new Error('Stale tokens.css: run npm run generate')
} else writeFileSync(target, css)
