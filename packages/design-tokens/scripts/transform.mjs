// References are platform-neutral paths, never CSS var() expressions.
export function resolveTokens(source) {
  function resolve(value, stack = []) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'ref' in value) {
      if (Object.keys(value).length !== 1 || typeof value.ref !== 'string') throw new Error('Invalid token reference')
      const path = value.ref
      if (stack.includes(path)) throw new Error(`Circular token reference: ${path}`)
      const target = path.split('.').reduce((node, key) => node?.[key], source)
      if (target === undefined) throw new Error(`Unknown token reference: ${path}`)
      return resolve(target, [...stack, path])
    }
    if (Array.isArray(value)) return value.map((item) => resolve(item, stack))
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, stack)]))
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite token value')
    if (typeof value === 'string' && /var\(|(?:\d)(?:px|rem)\b|linear-gradient\(/.test(value))
      throw new Error(`CSS-specific token value: ${value}`)
    return value
  }
  return resolve(source)
}

export function renderCss(tokens) {
  const declarations = Object.entries(tokens.color).map(([name, value]) => [`fam-${name}`, value])
  declarations.push(['fam-font-family', `'${tokens.font.body.family}'`])
  declarations.push(['radius', `${tokens.radius.control}px`])
  const gradient = tokens.gradient.brand
  declarations.push(['fam-grad', `linear-gradient(${gradient.angle}deg, ${gradient.colors.join(', ')})`])
  for (const [name, shadow] of Object.entries(tokens.shadow)) {
    const rgb = shadow.color
      .slice(1)
      .match(/../g)
      .map((hex) => parseInt(hex, 16))
      .join(' ')
    const spread = shadow.spreadDistance ? ` ${shadow.spreadDistance}px` : ''
    const cssName = { default: 'shadow', small: 'shadow-sm', primary: 'shadow-primary' }[name]
    declarations.push([
      cssName,
      `${shadow.offsetX === 0 ? '0' : `${shadow.offsetX}px`} ${shadow.offsetY}px ${shadow.blurRadius}px${spread} rgb(${rgb} / ${Math.round(shadow.opacity * 100)}%)`,
    ])
  }
  // Browser spacing uses rem (16px reference); native exports retain logical units.
  for (const [name, value] of Object.entries(tokens.spacing))
    declarations.push([`fam-space-${name}`, `${value / 16}rem`])
  // Viewport cut-overs are browser-only (px); native exports retain logical units.
  for (const [name, value] of Object.entries(tokens.breakpoint ?? {}))
    declarations.push([`fam-breakpoint-${name}`, `${value}px`])
  return (
    '/* Generated from src/tokens.json. Run npm run generate. */\n:root {\n' +
    declarations.map(([key, value]) => `  --${key}: ${value};`).join('\n') +
    '\n}\n'
  )
}

export function renderTypeScript(tokens) {
  return (
    '// Generated from tokens.json. Run npm run generate.\nexport const tokens = ' +
    JSON.stringify(tokens, null, 2) +
    ' as const\nexport type DesignTokens = typeof tokens\nexport default tokens\n'
  )
}
