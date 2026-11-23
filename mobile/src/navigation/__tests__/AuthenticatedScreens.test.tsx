import React from 'react'

jest.mock('@/branding', () => ({ markScreensLoaded: jest.fn() }))
jest.mock('@/navigation/MainTabs', () => ({ MainTabs: function MainTabs() {} }))
jest.mock('@/screens/PostDetailScreen', () => ({ PostDetailScreen: function PostDetailScreen() {} }))
jest.mock('@/screens/TripDetailScreen', () => ({ TripDetailScreen: function TripDetailScreen() {} }))
jest.mock('@/screens/AlbumDetailScreen', () => ({ AlbumDetailScreen: function AlbumDetailScreen() {} }))
jest.mock('@/screens/GiftListScreen', () => ({ GiftListScreen: function GiftListScreen() {} }))
jest.mock('@/screens/NewPostScreen', () => ({ NewPostScreen: function NewPostScreen() {} }))
jest.mock('@/screens/NotificationsScreen', () => ({ NotificationsScreen: function NotificationsScreen() {} }))
jest.mock('@/screens/FavoritesScreen', () => ({ FavoritesScreen: function FavoritesScreen() {} }))
jest.mock('@/screens/GroupMembersScreen', () => ({ GroupMembersScreen: function GroupMembersScreen() {} }))
jest.mock('@/screens/SearchScreen', () => ({ SearchScreen: function SearchScreen() {} }))
jest.mock('@/screens/WikiScreen', () => ({ WikiScreen: function WikiScreen() {} }))
jest.mock('@/screens/WikiPageScreen', () => ({ WikiPageScreen: function WikiPageScreen() {} }))
jest.mock('@/screens/WikiEditorScreen', () => ({ WikiEditorScreen: function WikiEditorScreen() {} }))
jest.mock('@/screens/ChatScreen', () => ({ ChatScreen: function ChatScreen() {} }))
jest.mock('@/screens/ChatGroupPickerScreen', () => ({
  ChatGroupPickerScreen: function ChatGroupPickerScreen() {},
}))
jest.mock('@/screens/ChatInboxScreen', () => ({ ChatInboxScreen: function ChatInboxScreen() {} }))
jest.mock('@/screens/DmMemberPickerScreen', () => ({
  DmMemberPickerScreen: function DmMemberPickerScreen() {},
}))
jest.mock('@/screens/DirectMessageScreen', () => ({
  DirectMessageScreen: function DirectMessageScreen() {},
}))
jest.mock('@/screens/ImageViewerScreen', () => ({ ImageViewerScreen: function ImageViewerScreen() {} }))
jest.mock('@/screens/StoryViewerScreen', () => ({ StoryViewerScreen: function StoryViewerScreen() {} }))
jest.mock('@/screens/StoryComposerScreen', () => ({
  StoryComposerScreen: function StoryComposerScreen() {},
}))

import { renderAuthenticatedScreens } from '../AuthenticatedScreens'

it('registers the direct-message routes inside the lazy authenticated screen module', () => {
  const Screen = function Screen() {
    return null
  }
  const tree = renderAuthenticatedScreens({ Screen } as never)
  const routeNames = React.Children.toArray((tree.props as { children: React.ReactNode }).children).map(
    (child) => (child as React.ReactElement<{ name: string }>).props.name
  )

  expect(routeNames).toEqual(expect.arrayContaining(['ChatInbox', 'DmMemberPicker', 'DirectMessage']))
  const chat = React.Children.toArray((tree.props as { children: React.ReactNode }).children).find(
    (child) => (child as React.ReactElement<{ name: string }>).props.name === 'Chat'
  ) as React.ReactElement
  expect((chat.props as { component: { name: string } }).component.name).toBe('ChatScreen')
})
