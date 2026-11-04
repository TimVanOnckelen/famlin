// The Family Wiki's content format (issue #118): a deliberately small
// Markdown subset, parsed into a plain AST that each client renders with its
// own native elements — never into an HTML string — so a page can't inject
// markup or script, and web and mobile share one set of rules.
//
// Blocks: `#`/`##`/`###` headings, paragraphs (single newlines kept as line
// breaks), `-`/`*` and `1.` lists, `- [ ]`/`- [x]` checklists, `>` quotes,
// fenced ``` code, `---` rules. Inline: **bold**, *italic*/_italic_,
// `code`, [links](...), ![images](...) and bare http(s) URLs.
//
// Links are restricted to http(s), mailto:, tel: and in-app paths ("/posts/…"
// — how a page links to existing Famlin content); images to uploaded
// /uploads/ files only, so a page never makes viewers' browsers fetch a
// third-party URL. Anything else renders as its plain text.

export type WikiInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: WikiInline[] }
  | { type: 'em'; children: WikiInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; internal: boolean; children: WikiInline[] }
  | { type: 'image'; src: string; alt: string }

export interface WikiListItem {
  // null for a plain list item, true/false for a checklist item.
  checked: boolean | null
  children: WikiInline[]
}

export type WikiBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: WikiInline[] }
  | { type: 'paragraph'; lines: WikiInline[][] }
  | { type: 'list'; ordered: boolean; items: WikiListItem[] }
  | { type: 'quote'; lines: WikiInline[][] }
  | { type: 'code'; text: string }
  | { type: 'rule' }

const UPLOAD_IMAGE_REGEX =
  /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|gif|webp|heic|heif)$/

// Classifies a link target: an in-app path, an allowed external URL, or null
// (unsafe — rendered as plain text).
export function wikiLinkTarget(href: string): { href: string; internal: boolean } | null {
  const trimmed = href.trim()
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return { href: trimmed, internal: true }
  }
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) return { href: trimmed, internal: false }
  return null
}

export function isWikiImageSrc(src: string): boolean {
  return UPLOAD_IMAGE_REGEX.test(src.trim())
}

const HEADING = /^(#{1,3})\s+(.*)$/
const UNORDERED = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const FENCE = /^\s*```/
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

export function parseWikiMarkdown(source: string): WikiBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: WikiBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    if (FENCE.test(line)) {
      const code: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++])
      i++ // closing fence (or end of input)
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        children: parseWikiInline(heading[2].trim()),
      })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: WikiInline[][] = []
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(parseWikiInline(QUOTE.exec(lines[i++])![1]))
      blocks.push({ type: 'quote', lines: quoted })
      continue
    }

    const ordered = ORDERED.test(line)
    if (ordered || UNORDERED.test(line)) {
      const pattern = ordered ? ORDERED : UNORDERED
      const items: WikiListItem[] = []
      while (i < lines.length && pattern.test(lines[i])) {
        const text = pattern.exec(lines[i++])![1]
        const box = CHECKBOX.exec(text)
        items.push(
          box
            ? { checked: box[1] !== ' ', children: parseWikiInline(box[2]) }
            : { checked: null, children: parseWikiInline(text) }
        )
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraph: WikiInline[][] = []
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paragraph.push(parseWikiInline(lines[i++].trim()))
    }
    blocks.push({ type: 'paragraph', lines: paragraph })
  }

  return blocks
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    RULE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    UNORDERED.test(line) ||
    ORDERED.test(line)
  )
}

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)/
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/
const BARE_URL = /^https?:\/\/[^\s<]*[^\s<.,:;!?"')\]]/

export function parseWikiInline(text: string): WikiInline[] {
  const out: WikiInline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer })
    buffer = ''
  }

  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const ch = text[i]
    const prev = i > 0 ? text[i - 1] : ''

    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'code', text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (ch === '!') {
      const image = IMAGE.exec(rest)
      if (image) {
        flush()
        if (isWikiImageSrc(image[2])) out.push({ type: 'image', src: image[2].trim(), alt: image[1] })
        else if (image[1]) out.push({ type: 'text', text: image[1] })
        i += image[0].length
        continue
      }
    }

    if (ch === '[') {
      const link = LINK.exec(rest)
      if (link) {
        flush()
        const target = wikiLinkTarget(link[2])
        const children = parseWikiInline(link[1]).filter((node) => node.type !== 'link')
        if (target) out.push({ type: 'link', ...target, children })
        else out.push(...children)
        i += link[0].length
        continue
      }
    }

    if ((ch === 'h' || ch === 'H') && (!prev || /\s|\(/.test(prev))) {
      const url = BARE_URL.exec(rest)
      if (url) {
        flush()
        out.push({ type: 'link', href: url[0], internal: false, children: [{ type: 'text', text: url[0] }] })
        i += url[0].length
        continue
      }
    }

    if (rest.startsWith('**')) {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'strong', children: parseWikiInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    // A single * or _ opens emphasis only when followed by a non-space, and
    // _ only at a word start, so snake_case and "2 * 3" stay literal.
    if ((ch === '*' || (ch === '_' && !/[\p{L}\p{N}]/u.test(prev))) && text[i + 1] && text[i + 1] !== ' ') {
      const end = text.indexOf(ch, i + 1)
      const after = text[end + 1] ?? ''
      if (end > i + 1 && text[end - 1] !== ' ' && (ch === '*' || !/[\p{L}\p{N}]/u.test(after))) {
        flush()
        out.push({ type: 'em', children: parseWikiInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }

    buffer += ch
    i++
  }

  flush()
  return out
}
