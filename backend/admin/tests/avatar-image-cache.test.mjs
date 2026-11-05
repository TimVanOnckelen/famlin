import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { setImmediate } from 'node:timers'
import { URL } from 'node:url'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/avatar-image-cache.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
})
const { AvatarImageCache } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const noop = () => {}

test('shares one pending download across components and StrictMode remounts', async () => {
  let calls = 0
  let complete
  const cache = new AvatarImageCache(() => {
    calls++
    return new Promise((resolve) => {
      complete = resolve
    })
  }, noop)
  const unsubscribe = cache.subscribe('session:photo', '/photo', noop)
  unsubscribe()
  let notifications = 0
  cache.subscribe('session:photo', '/photo', () => notifications++)
  cache.subscribe('session:photo', '/photo', () => notifications++)
  assert.equal(calls, 1)
  complete('blob:photo')
  await tick()
  assert.equal(notifications, 2)
  assert.equal(cache.getSnapshot('session:photo'), 'blob:photo')
})

test('retains the same ready URL for page navigation without downloading again', async () => {
  let calls = 0
  const revoked = []
  const cache = new AvatarImageCache(
    async () => {
      calls++
      return 'blob:photo'
    },
    (src) => revoked.push(src)
  )
  const unsubscribe = cache.subscribe('photo', '/photo', noop)
  await tick()
  unsubscribe()
  assert.equal(cache.getSnapshot('photo'), 'blob:photo')
  cache.subscribe('photo', '/photo', noop)
  await tick()
  assert.equal(calls, 1)
  assert.deepEqual(revoked, [])
})

test('evicts unused images while keeping active images valid', async () => {
  const revoked = []
  const cache = new AvatarImageCache(
    async (url) => `blob:${url}`,
    (src) => revoked.push(src),
    1
  )
  const releaseFirst = cache.subscribe('first', 'first', noop)
  await tick()
  const releaseSecond = cache.subscribe('second', 'second', noop)
  await tick()
  assert.deepEqual(revoked, [])
  releaseFirst()
  assert.deepEqual(revoked, ['blob:first'])
  assert.equal(cache.getSnapshot('second'), 'blob:second')
  releaseSecond()
})

test('keeps an in-flight request reusable even if every subscriber unmounts', async () => {
  let complete
  const cache = new AvatarImageCache(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
    noop
  )
  cache.subscribe('photo', '/photo', noop)()
  complete('blob:photo')
  await tick()
  assert.equal(cache.getSnapshot('photo'), 'blob:photo')
})

test('does not reuse an image between authentication sessions', async () => {
  let calls = 0
  const cache = new AvatarImageCache(async () => `blob:${++calls}`, noop)
  cache.subscribe('session-one:photo', '/photo', noop)
  await tick()
  cache.subscribe('session-two:photo', '/photo', noop)
  await tick()
  assert.equal(calls, 2)
  assert.notEqual(cache.getSnapshot('session-one:photo'), cache.getSnapshot('session-two:photo'))
})

test('deduplicates failed loads and permits a later retry', async (context) => {
  let now = 1000
  context.mock.method(Date, 'now', () => now)
  let calls = 0
  const cache = new AvatarImageCache(async () => {
    calls++
    throw new Error('unavailable')
  }, noop)
  cache.subscribe('photo', '/photo', noop)()
  await tick()
  cache.subscribe('photo', '/photo', noop)()
  await tick()
  assert.equal(calls, 1)
  assert.equal(cache.getSnapshot('photo'), undefined)
  now += 30_000
  cache.subscribe('photo', '/photo', noop)()
  await tick()
  assert.equal(calls, 2)
})
