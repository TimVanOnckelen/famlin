// Pure text helpers behind the Family Wiki editor's formatting toolbar
// (issue #118). They take the current text and selection and return the new
// text plus where the selection should land, so the screen only has to store
// both. Mirrors the toolbar logic in web's WikiEditorPage.

export interface TextSelection {
  start: number
  end: number
}

export interface EditResult {
  text: string
  selection: TextSelection
}

function normalize(text: string, selection: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(selection.start, selection.end, text.length))
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), text.length))
  return { start, end }
}

// Wraps the selection (or a placeholder when nothing is selected) in
// `before`/`after` and selects the wrapped text.
export function surroundSelection(
  text: string,
  selection: TextSelection,
  before: string,
  after = before,
  placeholder = ''
): EditResult {
  const { start, end } = normalize(text, selection)
  const selected = text.slice(start, end) || placeholder
  return {
    text: text.slice(0, start) + before + selected + after + text.slice(end),
    selection: { start: start + before.length, end: start + before.length + selected.length },
  }
}

// Prefixes every line touched by the selection ("## ", "- ", "- [ ] ").
export function prefixLines(text: string, selection: TextSelection, prefix: string): EditResult {
  const { start, end: rawEnd } = normalize(text, selection)
  // A whole-line selection ends at the next line's start; don't prefix it too.
  const end = rawEnd > start && text[rawEnd - 1] === '\n' ? rawEnd - 1 : rawEnd
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const block = text.slice(lineStart, end)
  const prefixed = block
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')
  const caret = lineStart + prefixed.length
  return { text: text.slice(0, lineStart) + prefixed + text.slice(end), selection: { start: caret, end: caret } }
}

// Inserts `insert` on its own line at the end of the selection.
export function insertBlockAtCursor(text: string, selection: TextSelection, insert: string): EditResult {
  const { end } = normalize(text, selection)
  const needsBreak = end > 0 && text[end - 1] !== '\n'
  const inserted = `${needsBreak ? '\n' : ''}${insert}\n`
  const caret = end + inserted.length
  return { text: text.slice(0, end) + inserted + text.slice(end), selection: { start: caret, end: caret } }
}
