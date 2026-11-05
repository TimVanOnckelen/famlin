import { tokens } from '@famlin/design-tokens'

export function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function avatarColor(name: string) {
  const palette = [
    tokens['fam-primary'],
    tokens['fam-primary-light'],
    tokens['fam-primary-mid'],
    tokens['fam-primary-dark'],
    tokens['fam-accent'],
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return palette[Math.abs(hash) % palette.length]
}
