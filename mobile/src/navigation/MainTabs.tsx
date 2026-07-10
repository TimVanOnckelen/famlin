import React, { useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { FeedScreen } from '@/screens/FeedScreen';
import { PhotosScreen } from '@/screens/PhotosScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { Icon } from '@/components/Icon';
import { colors } from '@/constants/colors';

const Tab = createBottomTabNavigator();

function HomeIcon({ color }: { color: string }) {
  return <Icon name="home" size={22} color={color} />;
}

function PhotosIcon({ color }: { color: string }) {
  return <Icon name="grid" size={22} color={color} />;
}

function ProfileIcon({ color }: { color: string }) {
  return <Icon name="user" size={22} color={color} />;
}

// The new-post FAB is shown while one of these tabs is focused — creating a
// post makes sense from the feed and the photo timeline, not from the profile.
const FAB_TABS = ['Feed', 'Photos'];

export function MainTabs() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState('Feed');

  return (
    <View style={styles.container}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: true,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: styles.tabLabel,
        }}
        screenListeners={{
          state: (e) => {
            const state = (e.data as any)?.state;
            const routeName = state?.routes?.[state.index]?.name;
            if (routeName) setActiveTab(routeName);
          },
        }}
      >
        <Tab.Screen
          name="Feed"
          component={FeedScreen}
          options={{
            tabBarIcon: ({ color }) => <HomeIcon color={color} />,
            tabBarLabel: t('tabs.feed'),
          }}
        />
        <Tab.Screen
          name="Photos"
          component={PhotosScreen}
          options={{
            tabBarIcon: ({ color }) => <PhotosIcon color={color} />,
            tabBarLabel: t('tabs.photos'),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            tabBarIcon: ({ color }) => <ProfileIcon color={color} />,
            tabBarLabel: t('tabs.profile'),
          }}
        />
      </Tab.Navigator>

      {FAB_TABS.includes(activeTab) && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('NewPost')}
          accessibilityLabel={t('newPost.title')}
          accessibilityRole="button"
          activeOpacity={0.85}
        >
          <Icon name="plus" size={26} color={colors.white} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingBottom: 24,
    height: 84,
  },
  tabLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
  },
  fab: {
    position: 'absolute',
    right: 18,
    // Clear of the tab bar (84, which already includes the bottom safe-area
    // padding) plus a comfortable margin.
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 6,
  },
});
