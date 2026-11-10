import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveTokens, renderCss, renderTypeScript } from '../scripts/transform.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const source = JSON.parse(read('../src/tokens.json'))
const tokens = resolveTokens(source)

test('native values use numbers and resolved colors without browser expressions', () => {
  assert.equal(tokens.radius.control, 18)
  assert.equal(tokens.spacing['4'], 16)
  assert.equal(tokens.shadow.primary.color, tokens.color.primary)
  assert.deepEqual(tokens.gradient.brand.colors, ['#318ea2', '#005480'])
  assert.equal(tokens.font.body.family, 'Nunito')
  assert.equal(tokens.breakpoint.desktop, 721)
  assert.doesNotMatch(JSON.stringify(tokens), /var\(|linear-gradient\(|\d(?:px|rem)\b|"ref"/)
  const generated = read('../src/generated.ts')
  assert.equal(generated, renderTypeScript(tokens))
  const native = JSON.parse(generated.slice(generated.indexOf('{'), generated.indexOf(' as const')))
  assert.deepEqual(native, tokens)
})

test('preserves all existing browser values through the token and UI layers', () => {
  const css = renderCss(tokens)
  assert.equal(read('../tokens.css'), css)
  // Tailwind breakpoint for the compact (≤720px) / desktop layout switch.
  assert.match(css, /@theme \{\n {2}--breakpoint-desktop: 45\.0625rem;\n\}/)
  const theme = read('../../ui/styles.css')
  const roots = [...theme.matchAll(/:root \{([\s\S]*?)\}/g)].map((match) => match[1]).join('\n')
  const values = Object.fromEntries(
    [...`${css}\n${roots}`.matchAll(/--([\w-]+): ([^;]+);/g)].map((match) => [match[1], match[2]])
  )
  const previous = JSON.parse(read('./browser-values.json'))
  function resolve(value, table) {
    return value.replace(/var\(--([\w-]+)\)/g, (_, key) => resolve(table[key], table))
  }
  for (const [key, value] of Object.entries(previous))
    assert.equal(resolve(values[key], values), resolve(value, previous), key)
})

test('rejects missing and circular references and CSS-specific source values', () => {
  assert.throws(() => resolveTokens({ a: { ref: 'missing' } }), /Unknown/)
  assert.throws(() => resolveTokens({ a: { ref: 'b' }, b: { ref: 'a' } }), /Circular/)
  assert.throws(() => resolveTokens({ a: '18px' }), /CSS-specific/)
  assert.throws(() => resolveTokens({ a: 'var(--color)' }), /CSS-specific/)
})
