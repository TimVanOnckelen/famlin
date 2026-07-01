import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView, SafeAreaView } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { colors } from '@/constants/colors';
import { Logo } from '@/components/Logo';
import { useAuthStore } from '@/stores/authStore';
import { updateMe } from '@/api/auth';

export function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await updateMe({});
      return response;
    },
    enabled: false,
  });

  const toggleEmailNotifications = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await updateMe({ emailNotificationsEnabled: enabled });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profiel</Text>
        </View>

        <View style={styles.profileCard}>
          <View style={[styles.avatar, { backgroundColor: colors.coral }]}>
            <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || '?'}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.isAdmin && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Instellingen</Text>

          <View style={styles.settingItem}>
            <View>
              <Text style={styles.settingLabel}>E-mailmeldingen</Text>
              <Text style={styles.settingDescription}>Ontvang updates per e-mail</Text>
            </View>
            <Switch
              value={user?.emailNotificationsEnabled}
              onValueChange={(value) => toggleEmailNotifications.mutate(value)}
              trackColor={{ false: colors.lightGray, true: colors.coral }}
              thumbColor={colors.white}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>
          <View style={styles.appInfo}>
            <Logo size={40} />
            <View style={styles.appInfoText}>
              <Text style={styles.appName}>Famlin</Text>
              <Text style={styles.appVersion}>Versie 0.1.0</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutButtonText}>Uitloggen</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    paddingTop: 50,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 27,
    color: colors.coral,
  },
  profileCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: {
    fontFamily: 'Nunito_900Black',
    fontSize: 32,
    color: colors.white,
  },
  name: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 22,
    color: colors.warmBlack,
  },
  email: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.warmGray,
    marginTop: 4,
  },
  adminBadge: {
    marginTop: 12,
    backgroundColor: colors.amber,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 100,
  },
  adminBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: colors.white,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: colors.warmGray,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.warmBlack,
  },
  settingDescription: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
    marginTop: 2,
  },
  appInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  appInfoText: {
    gap: 2,
  },
  appName: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 18,
    color: colors.warmBlack,
  },
  appVersion: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
  },
  logoutButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: 100,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    color: colors.white,
  },
});
