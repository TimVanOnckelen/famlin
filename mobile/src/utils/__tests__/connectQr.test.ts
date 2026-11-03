import { isSameServer, parseConnectQr } from '@/utils/connectQr'

describe('parseConnectQr', () => {
  it('accepts a server /connect URL and returns its origin', () => {
    expect(parseConnectQr('https://famlin.example.com/connect')).toBe('https://famlin.example.com')
    expect(parseConnectQr('  https://famlin.example.com/connect/  ')).toBe('https://famlin.example.com')
    expect(parseConnectQr('http://192.168.1.10:3000/connect')).toBe('http://192.168.1.10:3000')
    expect(parseConnectQr('HTTPS://Famlin.Example.com/connect?x=1')).toBe('https://famlin.example.com')
  })

  it('accepts the famlin://connect deep link', () => {
    expect(parseConnectQr(`famlin://connect?server=${encodeURIComponent('https://famlin.example.com:8443')}`)).toBe(
      'https://famlin.example.com:8443'
    )
  })

  it('rejects anything else', () => {
    for (const bad of [
      '',
      'hello',
      'https://famlin.example.com',
      'https://famlin.example.com/other',
      'https://famlin.example.com/connectx',
      'https://user:pw@famlin.example.com/connect',
      'ftp://famlin.example.com/connect',
      'famlin://connect',
      'famlin://connect?server=javascript:alert(1)',
      'famlin://connect?server=ftp%3A%2F%2Fexample.com',
      'famlin://invite/abc?server=https%3A%2F%2Fexample.com',
      'WIFI:S:home;T:WPA;P:secret;;',
    ]) {
      expect(parseConnectQr(bad)).toBeNull()
    }
  })
})

describe('isSameServer', () => {
  it('compares origins ignoring case and trailing slashes', () => {
    expect(isSameServer('https://Famlin.example.com/', 'https://famlin.example.com')).toBe(true)
    expect(isSameServer('https://a.example.com', 'https://b.example.com')).toBe(false)
    expect(isSameServer(null, 'https://a.example.com')).toBe(false)
  })
})
