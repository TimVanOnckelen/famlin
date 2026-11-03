import { it, expect } from 'vitest'
import { buildTestApp } from './helpers.js'

it('allows local image and video previews without allowing blob scripts', async () => {
  const app = await buildTestApp()
  try {
    const response = await app.inject({ method: 'GET', url: '/api/auth/setup-status' })
    expect(response.statusCode).toBe(200)
    const directives = new Map(
      String(response.headers['content-security-policy'])
        .split(';')
        .map((directive) => {
          const [name, ...sources] = directive.trim().split(/\s+/)
          return [name, sources]
        })
    )
    expect(directives.get('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'https:', 'blob:']))
    expect(directives.get('media-src')).toEqual(expect.arrayContaining(["'self'", 'https:', 'blob:']))
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
  } finally {
    await app.close()
  }
})
