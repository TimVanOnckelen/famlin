import React from 'react';
import type { createNativeStackNavigator } from '@react-navigation/native-stack';
import { markScreensLoaded } from '@/branding';
import { MainTabs } from '@/navigation/MainTabs';
import { PostDetailScreen } from '@/screens/PostDetailScreen';
import { TripDetailScreen } from '@/screens/TripDetailScreen';
import { AlbumDetailScreen } from '@/screens/AlbumDetailScreen';
import { NewPostScreen } from '@/screens/NewPostScreen';
import { NotificationsScreen } from '@/screens/NotificationsScreen';
import { FavoritesScreen } from '@/screens/FavoritesScreen';
import { GroupMembersScreen } from '@/screens/GroupMembersScreen';
import { SearchScreen } from '@/screens/SearchScreen';
import { ChatScreen } from '@/screens/ChatScreen';
import { ChatGroupPickerScreen } from '@/screens/ChatGroupPickerScreen';
import { ImageViewerScreen } from '@/screens/ImageViewerScreen';
import { StoryViewerScreen } from '@/screens/StoryViewerScreen';
import { StoryComposerScreen } from '@/screens/StoryComposerScreen';

// Every screen behind login, in its own module so App can require() it
// lazily: on a first connect the family's branding is fetched and applied
// to `colors` (src/branding/) BEFORE these modules — and their
// StyleSheet.create() calls — are evaluated. Importing any of them
// statically from App (or from a module the login screen loads) would bake
// in the default palette until the next cold start.
markScreensLoaded();

type Stack = ReturnType<typeof createNativeStackNavigator>;

export function renderAuthenticatedScreens(Stack: Stack) {
  return (
    <>
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen
        name="PostDetail"
        component={PostDetailScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="TripDetail"
        component={TripDetailScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="AlbumDetail"
        component={AlbumDetailScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="NewPost"
        component={NewPostScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="GroupMembers"
        component={GroupMembersScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="Search"
        component={SearchScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="ChatGroupPicker"
        component={ChatGroupPickerScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="ImageViewer"
        component={ImageViewerScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="StoryViewer"
        component={StoryViewerScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="StoryComposer"
        component={StoryComposerScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
        }}
      />
    </>
  );
}
