import { describe, it, expect } from 'vitest'
import { parseWikiInline, parseWikiMarkdown, wikiLinkTarget } from '../wikiMarkdown'

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
})
