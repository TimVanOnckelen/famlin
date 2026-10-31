import { paths, rememberReturnPath, takeReturnPath, inviteTokenFromReturnPath } from '@/utils/routes'

beforeEach(() => {
  sessionStorage.clear()
})

describe('paths', () => {
  it('builds detail paths with an encoded id', () => {
    expect(paths.post('abc')).toBe('/posts/abc')
    expect(paths.trip('a/b')).toBe('/trips/a%2Fb')
    expect(paths.album('x')).toBe('/albums/x')
  })
})

describe('return path across the SSO round trip', () => {
  it('restores the path once', () => {
    rememberReturnPath('/posts/abc?x=1')
    expect(takeReturnPath()).toBe('/posts/abc?x=1')
    expect(takeReturnPath()).toBeNull()
  })

  it('does not store the feed', () => {
    rememberReturnPath('/')
    expect(takeReturnPath()).toBeNull()
  })

  it.each(['//evil.example/x', '/\\evil.example', 'https://evil.example/', ''])('refuses %s', (path) => {
    rememberReturnPath(path)
    expect(takeReturnPath()).toBeNull()
    sessionStorage.setItem('famlin.web.returnTo', path)
    expect(takeReturnPath()).toBeNull()
  })
})

describe('invitation return paths', () => {
  it('builds and reads encoded join paths', () => {
    expect(paths.join('a/b')).toBe('/join/a%2Fb')
    expect(inviteTokenFromReturnPath('/join/a%2Fb?loginError=1')).toBe('a/b')
  })
  it.each([
    null,
    '/',
    '/search?inviteToken=secret',
    '//evil.example/join/token',
    'https://evil.example/join/token',
    '/join/%ZZ',
  ])('does not accept a token from %s', (path) => {
    expect(inviteTokenFromReturnPath(path)).toBeUndefined()
  })
})
