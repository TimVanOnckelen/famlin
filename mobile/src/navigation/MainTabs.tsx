import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { FeedScreen } from '@/screens/FeedScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { Icon } from '@/components/Icon';
import { colors } from '@/constants/colors';

const Tab = createBottomTabNavigator();

function HomeIcon({ color }: { color: string }) {
  return <Icon name="home" size={22} color={color} />;
}

function ProfileIcon({ color }: { color: string }) {
  return <Icon name="user" size={22} color={color} />;
}

export function MainTabs() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
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
        name="NewPostTab"
        component={EmptyComponent}
        options={{
          tabBarButton: (props) => (
            <TouchableOpacity
              {...props}
              style={styles.newPostButton}
              onPress={() => navigation.navigate('NewPost')}
            >
              <View style={styles.newPostIcon}>
                <Icon name="plus" size={24} color={colors.white} />
              </View>
            </TouchableOpacity>
          ),
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('NewPost');
          },
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
  );
}

function EmptyComponent() {
  return null;
}

const styles = StyleSheet.create({
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
  newPostButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: -12,
  },
  newPostIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
