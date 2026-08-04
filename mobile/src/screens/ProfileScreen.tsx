import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView, Modal, Alert, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';

import { colors } from '@/constants/colors';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { useAuthStore } from '@/stores/authStore';
import { updateMe, changePassword, deleteAccount, fetchNotificationConfig, fetchServerInfo, NotificationPrefs } from '@/api/auth';
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia';
import { setLanguage } from '@/utils/storage';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '@/i18n';

export function ProfileScreen() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { user, logout, serverUrl, updateUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: notificationConfig } = useQuery({
    queryKey: ['notification-config'],
    queryFn: fetchNotificationConfig,
  });
  const showPush = notificationConfig?.pushEnabled ?? true;
  const showEmail = notificationConfig?.emailEnabled ?? true;

  const { data: serverInfo } = useQuery({
    queryKey: ['server-info'],
    queryFn: fetchServerInfo,
  });

  const updatePrefs = useMutation({
    mutationFn: async (prefs: NotificationPrefs) => {
      const response = await updateMe(prefs);
      return response;
    },
    onSuccess: (updatedUser) => {
      updateUser(updatedUser);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const updateAvatar = useMutation({
    mutationFn: async (avatarUrl: string) => updateMe({ avatarUrl }),
    onSuccess: (updatedUser) => {
      updateUser(updatedUser);
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('newPost.alerts.uploadFailed'));
    },
  });

  const updatePassword = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordError(null);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: any) => {
      setPasswordSuccess(false);
      setPasswordError(err.response?.data?.error || t('profile.passwordChangeFailed'));
    },
  });

  function handlePasswordSubmit() {
    setPasswordSuccess(false);
    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordMismatch'));
      return;
    }
    setPasswordError(null);
    updatePassword.mutate();
  }

  const { pick: pickAvatarMedia, uploading: avatarUploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    },
    fileNamePrefix: 'avatar',
  });

  async function pickAvatar() {
    const result = await pickAvatarMedia();
    if (!result) return;
    updateAvatar.mutate(result.urls[0]);
  }

  // Permanent, cascading account deletion (DELETE /api/auth/me) — the in-app
  // deletion path App Store guideline 5.1.1(v) requires. Deliberately behind a
  // type-to-confirm step, since nothing here can be undone.
  const removeAccount = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      setDeleteModalVisible(false);
      await logout();
    },
    onError: (err: any) => {
      setDeleteError(err.response?.data?.error || err.message || t('common.tryAgain'));
    },
  });

  function openDeleteModal() {
    setDeleteConfirmation('');
    setDeleteError(null);
    setDeleteModalVisible(true);
  }

  const notificationTypes: { labelKey: string; pushKey: keyof NotificationPrefs; emailKey: keyof NotificationPrefs }[] = [
    { labelKey: 'profile.notifyNewPost', pushKey: 'pushOnNewPost', emailKey: 'emailOnNewPost' },
    { labelKey: 'profile.notifyNewComment', pushKey: 'pushOnNewComment', emailKey: 'emailOnNewComment' },
    { labelKey: 'profile.notifyNewLike', pushKey: 'pushOnNewLike', emailKey: 'emailOnNewLike' },
  ];

  async function handleLanguageChange(lang: SupportedLanguage) {
    await i18nInstance.changeLanguage(lang);
    await setLanguage(lang);
    setLanguageModalVisible(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('profile.title')}</Text>
        </View>

        <View style={styles.profileCard}>
          <TouchableOpacity
            style={styles.avatarWrapper}
            onPress={pickAvatar}
            disabled={avatarUploading}
            accessibilityLabel={t('profile.changePhoto')}
          >
            <Avatar name={user?.name || '?'} avatarUrl={user?.avatarUrl} size={80} />
            <View style={styles.avatarEditBadge}>
              {avatarUploading ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Icon name="camera" size={14} color={colors.white} />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.isAdmin && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>{t('profile.adminBadge')}</Text>
            </View>
          )}
        </View>

        {(showPush || showEmail) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profile.notifications')}</Text>

            <View style={styles.notificationHeaderRow}>
              <View style={{ flex: 1 }} />
              {showPush && <Text style={styles.notificationColumnLabel}>{t('profile.push')}</Text>}
              {showEmail && <Text style={styles.notificationColumnLabel}>{t('profile.email')}</Text>}
            </View>

            {notificationTypes.map(({ labelKey, pushKey, emailKey }) => (
              <View key={labelKey} style={styles.notificationRow}>
                <Text style={[styles.settingLabel, styles.notificationLabel]}>{t(labelKey)}</Text>
                {showPush && (
                  <Switch
                    value={user?.[pushKey]}
                    onValueChange={(value) => updatePrefs.mutate({ [pushKey]: value })}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.white}
                  />
                )}
                {showEmail && (
                  <Switch
                    value={user?.[emailKey]}
                    onValueChange={(value) => updatePrefs.mutate({ [emailKey]: value })}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.white}
                  />
                )}
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.settings')}</Text>

          <View style={styles.settingItem}>
            <View>
              <Text style={styles.settingLabel}>{t('profile.language')}</Text>
              <Text style={styles.settingDescription}>{t('profile.languageDescription')}</Text>
            </View>
            <TouchableOpacity onPress={() => setLanguageModalVisible(true)}>
              <Text style={styles.languageValue}>
                {t(`profile.languages.${i18nInstance.language as SupportedLanguage}`)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {user?.hasPassword && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profile.security')}</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('profile.currentPassword')}</Text>
              <TextInput
                style={styles.input}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                textContentType="password"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('profile.newPassword')}</Text>
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                textContentType="newPassword"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('profile.confirmPassword')}</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                textContentType="newPassword"
                autoCapitalize="none"
              />
            </View>

            {passwordError && <Text style={styles.passwordError}>{passwordError}</Text>}
            {passwordSuccess && <Text style={styles.passwordSuccess}>{t('profile.passwordChanged')}</Text>}

            <TouchableOpacity
              style={[styles.passwordButton, updatePassword.isPending && styles.passwordButtonDisabled]}
              onPress={handlePasswordSubmit}
              disabled={updatePassword.isPending || !currentPassword || !newPassword || !confirmPassword}
            >
              <Text style={styles.passwordButtonText}>
                {updatePassword.isPending ? t('common.loading') : t('profile.changePassword')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.server')}</Text>
          <View style={styles.serverInfo}>
            <View style={[styles.serverIcon, { backgroundColor: colors.primaryDark }]}>
              <Icon name="server" size={18} color={colors.white} />
            </View>
            <View style={styles.serverInfoText}>
              <Text style={styles.serverLabel}>{t('profile.connectedTo')}</Text>
              <Text style={styles.serverUrl} numberOfLines={1} ellipsizeMode="middle">
                {serverUrl || t('common.unknown')}
              </Text>
              {serverInfo?.version && (
                <Text style={styles.serverVersion}>{t('profile.serverVersion', { version: serverInfo.version })}</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.app')}</Text>
          <View style={styles.appInfo}>
            <Logo size={40} />
            <View style={styles.appInfoText}>
              <Text style={styles.appName}>{t('common.appName')}</Text>
              <Text style={styles.appVersion}>
                {t('profile.version', { version: Constants.expoConfig?.version ?? t('common.unknown') })}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutButtonText}>{t('profile.logout')}</Text>
        </TouchableOpacity>

        <View style={styles.dangerSection}>
          <Text style={styles.sectionTitle}>{t('profile.dangerZone')}</Text>
          <Text style={styles.dangerDescription}>{t('profile.deleteAccountDescription')}</Text>
          <TouchableOpacity style={styles.deleteAccountButton} onPress={openDeleteModal}>
            <Icon name="trash" size={16} color={colors.danger} />
            <Text style={styles.deleteAccountButtonText}>{t('profile.deleteAccount')}</Text>
          </TouchableOpacity>
        </View>

        <DeleteAccountModal
          visible={deleteModalVisible}
          confirmation={deleteConfirmation}
          onChangeConfirmation={setDeleteConfirmation}
          error={deleteError}
          deleting={removeAccount.isPending}
          onCancel={() => setDeleteModalVisible(false)}
          onConfirm={() => {
            setDeleteError(null);
            removeAccount.mutate();
          }}
        />

        <LanguagePickerModal
          visible={languageModalVisible}
          onClose={() => setLanguageModalVisible(false)}
          selectedLanguage={(i18nInstance.language as SupportedLanguage) || 'en'}
          onSelect={handleLanguageChange}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

interface LanguagePickerModalProps {
  visible: boolean;
  onClose: () => void;
  selectedLanguage: SupportedLanguage;
  onSelect: (lang: SupportedLanguage) => void;
}

function LanguagePickerModal({ visible, onClose, selectedLanguage, onSelect }: LanguagePickerModalProps) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <Text style={modalStyles.title}>{t('profile.language')}</Text>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[
                modalStyles.option,
                selectedLanguage === lang && modalStyles.optionSelected,
              ]}
              onPress={() => onSelect(lang)}
            >
              <Text
                style={[
                  modalStyles.optionText,
                  selectedLanguage === lang && modalStyles.optionTextSelected,
                ]}
              >
                {t(`profile.languages.${lang}`)}
              </Text>
              {selectedLanguage === lang && (
                <View style={modalStyles.checkmark} />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={modalStyles.closeButton} onPress={onClose}>
            <Text style={modalStyles.closeButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

interface DeleteAccountModalProps {
  visible: boolean;
  confirmation: string;
  onChangeConfirmation: (value: string) => void;
  error: string | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// Type-to-confirm rather than a plain yes/no: deletion is immediate and
// permanent (the server hard-deletes the account and cascades to every post,
// comment, reaction and photo it owns), so an accidental tap must not be
// enough. Guideline 5.1.1(v) allows confirmation steps like this — what it
// forbids is making the user leave the app to finish.
function DeleteAccountModal({
  visible,
  confirmation,
  onChangeConfirmation,
  error,
  deleting,
  onCancel,
  onConfirm,
}: DeleteAccountModalProps) {
  const { t } = useTranslation();
  const requiredWord = t('profile.deleteAccountConfirmWord');
  const canConfirm = confirmation.trim().toUpperCase() === requiredWord.toUpperCase() && !deleting;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <Text style={modalStyles.title}>{t('profile.deleteAccount')}</Text>
          <Text style={modalStyles.body}>{t('profile.deleteAccountWarning')}</Text>
          <Text style={modalStyles.body}>
            {t('profile.deleteAccountConfirmPrompt', { word: requiredWord })}
          </Text>

          <TextInput
            style={modalStyles.confirmInput}
            value={confirmation}
            onChangeText={onChangeConfirmation}
            placeholder={requiredWord}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          {error && <Text style={modalStyles.error}>{error}</Text>}

          <TouchableOpacity
            style={[modalStyles.confirmButton, !canConfirm && modalStyles.confirmButtonDisabled]}
            onPress={onConfirm}
            disabled={!canConfirm}
          >
            {deleting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={modalStyles.confirmButtonText}>{t('profile.deleteAccountConfirm')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={modalStyles.closeButton} onPress={onCancel} disabled={deleting}>
            <Text style={modalStyles.closeButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  body: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textBody,
    marginBottom: 12,
  },
  confirmInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
    marginBottom: 12,
  },
  error: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.danger,
    marginBottom: 12,
  },
  confirmButton: {
    backgroundColor: colors.danger,
    paddingVertical: 16,
    borderRadius: 100,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    color: colors.white,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 18,
    color: colors.textTitle,
    marginBottom: 16,
    textAlign: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  optionSelected: {
    backgroundColor: colors.bg,
  },
  optionText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
  },
  optionTextSelected: {
    fontFamily: 'Nunito_700Bold',
    color: colors.primary,
  },
  checkmark: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  closeButton: {
    marginTop: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textMuted,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 27,
    color: colors.primary,
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
  avatarWrapper: {
    marginBottom: 14,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 22,
    color: colors.textTitle,
  },
  email: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 4,
  },
  adminBadge: {
    marginTop: 12,
    backgroundColor: colors.milestone,
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
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  settingItemBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 12,
    paddingTop: 18,
  },
  notificationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  notificationColumnLabel: {
    width: 56,
    textAlign: 'center',
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  notificationLabel: {
    flex: 1,
  },
  languageValue: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.primary,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.textTitle,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
  },
  passwordError: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.accent,
    marginBottom: 10,
  },
  passwordSuccess: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.primary,
    marginBottom: 10,
  },
  passwordButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 100,
    alignItems: 'center',
  },
  passwordButtonDisabled: {
    opacity: 0.6,
  },
  passwordButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    color: colors.white,
  },
  settingLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  settingDescription: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  serverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  serverIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverInfoText: {
    gap: 2,
    flex: 1,
  },
  serverLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  serverUrl: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  serverVersion: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
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
    color: colors.textTitle,
  },
  appVersion: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  dangerSection: {
    marginTop: 28,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
    gap: 10,
  },
  dangerDescription: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textBody,
  },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.white,
  },
  deleteAccountButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.danger,
  },
  logoutButton: {
    backgroundColor: colors.primary,
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
