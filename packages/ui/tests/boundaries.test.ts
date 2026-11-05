import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps the browser library independent from application aliases and authentication', () => {
  const files = readdirSync(resolve('src'), {
    recursive: true,
  }).filter((name) => /\.tsx?$/.test(String(name)))
  for (const file of files) {
    const source = readFileSync(resolve('src', String(file)), 'utf8')
    expect(source, String(file)).not.toMatch(/@\/|backend\/admin|localStorage|famlin_admin_token|fetchUploadObjectUrl/)
  }
})
