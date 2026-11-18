import { describeUserAgent } from '../userAgent'

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      { browser: 'Chrome', os: 'macOS', app: false },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
      { browser: 'Edge', os: 'Windows', app: false },
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
      { browser: 'Firefox', os: 'Linux', app: false },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      { browser: 'Safari', os: 'iOS', app: false },
    ],
    ['Famlin/42 CFNetwork/1568.200.51 Darwin/24.1.0', { browser: null, os: 'iOS', app: true }],
    ['okhttp/4.12.0', { browser: null, os: 'Android', app: true }],
    [null, { browser: null, os: null, app: false }],
  ])('%s', (ua, expected) => {
    expect(describeUserAgent(ua)).toEqual(expected)
  })
})
