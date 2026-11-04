import { insertBlockAtCursor, prefixLines, surroundSelection } from '@/utils/wikiEditor'

describe('wikiEditor', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(surroundSelection('a word b', { start: 2, end: 6 }, '**')).toEqual({
      text: 'a **word** b',
      selection: { start: 4, end: 8 },
    })
  })

  it('uses a placeholder when nothing is selected', () => {
    expect(surroundSelection('', { start: 0, end: 0 }, '[', '](https://)', 'link text')).toEqual({
      text: '[link text](https://)',
      selection: { start: 1, end: 10 },
    })
  })

  it('prefixes every line touched by the selection', () => {
    const result = prefixLines('one\ntwo\nthree', { start: 5, end: 9 }, '- ')
    expect(result.text).toBe('one\n- two\n- three')
  })

  it('inserts a block on its own line', () => {
    expect(insertBlockAtCursor('hello', { start: 5, end: 5 }, '![](/uploads/x.jpg)').text).toBe(
      'hello\n![](/uploads/x.jpg)\n'
    )
    expect(insertBlockAtCursor('', { start: 0, end: 0 }, 'x').text).toBe('x\n')
  })
})
