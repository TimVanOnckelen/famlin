import { describe, it, expect } from 'vitest'
import {
  parseWikiInline,
  parseWikiMarkdown,
  wikiLinkTarget,
  wikiPostLabel,
  wikiPostLinkMarkdown,
} from '../wikiMarkdown'

const PHOTO = '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg'

describe('parseWikiMarkdown', () => {
  it('parses the supported blocks', () => {
    const blocks = parseWikiMarkdown(
      [
        '# Holiday house',
        'Line one',
        'line two',
        '',
        '- milk',
        '- [x] keys',
        '- [ ] heating',
        '1. first',
        '2. second',
        '> quoted',
        '```',
        '**not bold**',
        '```',
        '---',
      ].join('\n')
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'rule'])
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, children: [{ type: 'text', text: 'Holiday house' }] })
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      lines: [[{ type: 'text', text: 'Line one' }], [{ type: 'text', text: 'line two' }]],
    })
    expect(blocks[2]).toMatchObject({
      ordered: false,
      items: [{ checked: null }, { checked: true }, { checked: false }],
    })
    expect(blocks[3]).toMatchObject({ ordered: true, items: [{ checked: null }, { checked: null }] })
    expect(blocks[5]).toEqual({ type: 'code', text: '**not bold**' })
  })

  it('normalizes Windows line endings', () => {
    expect(parseWikiMarkdown('a\r\nb')).toHaveLength(1)
  })
})

describe('parseWikiInline', () => {
  it('parses emphasis, code and links', () => {
    expect(parseWikiInline('**Wi-Fi**: `famlin` and *quiet* _please_')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'Wi-Fi' }] },
      { type: 'text', text: ': ' },
      { type: 'code', text: 'famlin' },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'quiet' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'please' }] },
    ])
  })

  it('keeps snake_case and lone asterisks literal', () => {
    expect(parseWikiInline('my_wifi_name 2 * 3')).toEqual([{ type: 'text', text: 'my_wifi_name 2 * 3' }])
  })

  it('allows in-app, http(s), mailto and tel links only', () => {
    expect(parseWikiInline('[the post](/posts/abc)')).toEqual([
      { type: 'link', href: '/posts/abc', internal: true, children: [{ type: 'text', text: 'the post' }] },
    ])
    expect(parseWikiInline('[x](javascript:alert(1))')[0]).toEqual({ type: 'text', text: 'x' })
    expect(wikiLinkTarget('//evil.example')).toBeNull()
    expect(wikiLinkTarget('tel:+3212345')).toEqual({ href: 'tel:+3212345', internal: false })
  })

  it('autolinks bare URLs without trailing punctuation', () => {
    expect(parseWikiInline('See https://example.com/a.')).toEqual([
      { type: 'text', text: 'See ' },
      {
        type: 'link',
        href: 'https://example.com/a',
        internal: false,
        children: [{ type: 'text', text: 'https://example.com/a' }],
      },
      { type: 'text', text: '.' },
    ])
  })

  it('only embeds uploaded images', () => {
    expect(parseWikiInline(`![the house](${PHOTO})`)).toEqual([{ type: 'image', src: PHOTO, alt: 'the house' }])
    expect(parseWikiInline('![tracker](https://evil.example/pixel.png)')).toEqual([{ type: 'text', text: 'tracker' }])
  })

  it('keeps a URL used as link text visible', () => {
    expect(parseWikiInline('[https://example.com](https://example.com)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        internal: false,
        children: [{ type: 'text', text: 'https://example.com' }],
      },
    ])
  })

  it('stays linear on unclosed brackets and hrefs', () => {
    for (const input of ['['.repeat(50000), '!['.repeat(25000), '[]('.repeat(16000), '[a](b'.repeat(10000)]) {
      const start = performance.now()
      parseWikiMarkdown(input)
      expect(performance.now() - start).toBeLessThan(500)
    }
    expect(parseWikiInline('[a](b [c](/d)')).toEqual([
      { type: 'text', text: '[a](b ' },
      { type: 'link', href: '/d', internal: true, children: [{ type: 'text', text: 'c' }] },
    ])
  })
})

describe('post links', () => {
  it('uses type-specific paths and safe labels', () => {
    expect(wikiPostLinkMarkdown({ id: 'a', type: 'UPDATE' }, 'Our [big] day')).toBe('[Our big day](/posts/a)')
    expect(wikiPostLinkMarkdown({ id: 't', type: 'TRIP' }, 'Italy')).toBe('[Italy](/trips/t)')
    expect(wikiPostLinkMarkdown({ id: 'm', type: 'UPDATE' }, 'two\n  lines')).toBe('[two lines](/posts/m)')
    expect(wikiPostLinkMarkdown({ id: 'g', type: 'GIFT_LIST' }, 'Xmas')).toBe('[Xmas](/gift-lists/g)')
    // The link round-trips through the parser as an in-app link.
    expect(parseWikiInline(wikiPostLinkMarkdown({ id: 'b', type: 'ALBUM' }, 'Summer'))[0]).toMatchObject({
      type: 'link',
      href: '/albums/b',
      internal: true,
    })
  })

  it('labels a post by title, tag or text', () => {
    expect(wikiPostLabel({ trip: { title: 'Italy 2026' }, content: 'x' }, 'fb')).toBe('Italy 2026')
    expect(wikiPostLabel({ milestoneTag: 'First steps' }, 'fb')).toBe('First steps')
    expect(wikiPostLabel({ content: '  Hello\n  world ' }, 'fb')).toBe('Hello world')
    expect(wikiPostLabel({ content: '' }, 'Post from today')).toBe('Post from today')
    expect(wikiPostLabel({ content: 'a'.repeat(100) }, 'fb', 10)).toBe('aaaaaaaaa…')
  })
})
