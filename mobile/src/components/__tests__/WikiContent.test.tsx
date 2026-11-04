import React from 'react'
import { Linking } from 'react-native'
import { render, fireEvent } from '@testing-library/react-native'

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}))

jest.mock('@/components/MediaThumbnail', () => {
  const { View } = require('react-native')
  return { MediaThumbnail: ({ url }: { url: string }) => <View testID="thumb" accessibilityLabel={url} /> }
})

jest.mock('@/components/Icon', () => {
  const { Text } = require('react-native')
  return { Icon: ({ name }: { name: string }) => <Text testID={`icon-${name}`}>{name}</Text> }
})

import { WikiContent, wikiInternalRoute } from '@/components/WikiContent'

const IMAGE = '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg'

describe('WikiContent', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders headings, paragraphs, lists, checklists, quotes, code and inline styles', async () => {
    const md = [
      '# Big',
      '',
      'Hello **bold** and *soft* and `code`',
      'second line',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '> wise words',
      '',
      '```',
      'let x = 1',
      '```',
    ].join('\n')
    const { getByText, getAllByTestId } = await render(<WikiContent content={md} />)
    expect(getByText('Big')).toBeTruthy()
    expect(getByText(/Hello/)).toBeTruthy()
    expect(getByText(/second line/)).toBeTruthy()
    expect(getByText('one')).toBeTruthy()
    expect(getByText('1.')).toBeTruthy()
    expect(getAllByTestId('icon-check-square')).toHaveLength(1)
    expect(getAllByTestId('icon-square')).toHaveLength(1)
    expect(getByText('wise words')).toBeTruthy()
    expect(getByText('let x = 1')).toBeTruthy()
  })

  it('opens an internal /posts link in the app', async () => {
    const { getByText } = await render(<WikiContent content="See [our trip](/posts/abc-1)." />)
    await fireEvent.press(getByText('our trip'))
    expect(mockNavigate).toHaveBeenCalledWith('PostDetail', { postId: 'abc-1' })
  })

  it('opens an external link with Linking', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never)
    const { getByText } = await render(<WikiContent content="[site](https://example.com)" />)
    await fireEvent.press(getByText('site'))
    expect(open).toHaveBeenCalledWith('https://example.com')
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('renders a javascript: link as plain, inert text', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never)
    const { getByText } = await render(<WikiContent content="[click](javascript:alert(1))" />)
    await fireEvent.press(getByText(/click/))
    expect(open).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('renders an /uploads image and opens it in the viewer', async () => {
    const { getByTestId } = await render(<WikiContent content={`![](${IMAGE})`} />)
    expect(getByTestId('thumb').props.accessibilityLabel).toContain(IMAGE)
    await fireEvent.press(getByTestId('wiki-image'))
    expect(mockNavigate).toHaveBeenCalledWith(
      'ImageViewer',
      expect.objectContaining({ initialIndex: 0, urls: [expect.stringContaining(IMAGE)] })
    )
  })

  it('does not render a third-party image', async () => {
    const { queryByTestId } = await render(<WikiContent content="![](https://evil.example/x.png)" />)
    expect(queryByTestId('thumb')).toBeNull()
  })
})

describe('wikiInternalRoute', () => {
  it.each([
    ['/posts/1', 'PostDetail', { postId: '1' }],
    ['/trips/2', 'TripDetail', { postId: '2' }],
    ['/albums/3', 'AlbumDetail', { postId: '3' }],
    ['/gift-lists/4', 'GiftList', { postId: '4' }],
    ['/wiki/5?x=1', 'WikiPage', { pageId: '5' }],
  ])('%s', (href, name, params) => {
    expect(wikiInternalRoute(href)).toEqual({ name, params })
  })

  it('ignores unknown internal paths', () => {
    expect(wikiInternalRoute('/admin')).toBeNull()
    expect(wikiInternalRoute('/posts')).toBeNull()
  })
})
