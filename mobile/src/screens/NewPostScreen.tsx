import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Switch,
  Alert,
  SafeAreaView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { api } from '@/api/client';
import { Group, Post } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { uploadMedia, getUploadUrl } from '@/api/uploads';
import { isVideoUrl } from '@/utils/media';
import { LocationPickerModal, PickedLocation } from '@/components/LocationPickerModal';

const MILESTONE_TAG_KEYS = ['birthday', 'birth', 'anniversary', 'graduation'] as const;

function MutedVideoThumb({ uri, style }: { uri: string; style: any }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.muted = true;
  });

  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

export function NewPostScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [content, setContent] = useState('');
  const [isMilestone, setIsMilestone] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isCustomTag, setIsCustomTag] = useState(false);
  const [customTagText, setCustomTagText] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [uploadedAssetUrls, setUploadedAssetUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingAssets, setPendingAssets] = useState<{ uri: string; isVideo: boolean }[]>([]);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  const { data: groups } = useQuery<Group[], Error>({
    queryKey: ['groups'],
    queryFn: async (): Promise<Group[]> => {
      const response = await api.get<Group[]>('/groups');
      return response.data;
    },
  });

  React.useEffect(() => {
    if (groups && groups.length > 0 && !groupId) {
      setGroupId(groups[0].id);
    }
  }, [groups]);

  const createPost = useMutation({
    mutationFn: async () => {
      if (!groupId) throw new Error(t('newPost.alerts.noGroupSelected'));
      const response = await api.post<Post>('/posts', {
        groupId,
        content,
        type: isMilestone ? 'MILESTONE' : 'UPDATE',
        milestoneTag: isMilestone ? (isCustomTag ? customTagText.trim() || undefined : selectedTag ?? undefined) : undefined,
        uploadedAssetUrls,
        latitude: location?.latitude,
        longitude: location?.longitude,
        locationName: location?.locationName,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('newPost.alerts.postFailed'));
    },
  });

  const canSubmit = content.trim().length > 0 || uploadedAssetUrls.length > 0;

  async function pickImagesFromDevice() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('newPost.alerts.permissionRequiredTitle'), t('newPost.alerts.permissionRequiredMessage'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.8,
      videoMaxDuration: 120,
    });

    if (result.canceled) return;

    const files = result.assets.map((asset, index) => {
      const isVideo = asset.type === 'video';
      return {
        uri: asset.uri,
        name: asset.fileName || `${isVideo ? 'video' : 'photo'}-${index}.${isVideo ? 'mp4' : 'jpg'}`,
        type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
      };
    });

    setPendingAssets(files.map((file) => ({ uri: file.uri, isVideo: file.type.startsWith('video') })));

    try {
      setUploading(true);
      const urls = await uploadMedia(files);
      setUploadedAssetUrls((prev) => [...prev, ...urls]);
    } catch (err: any) {
      console.error('Upload error:', err);
      Alert.alert(t('newPost.alerts.uploadFailed'), err.response?.data?.error || err.message || t('common.tryAgain'));
    } finally {
      setUploading(false);
      setPendingAssets([]);
    }
  }

  function removeUploadedAsset(url: string) {
    setUploadedAssetUrls((prev) => prev.filter((u) => u !== url));
  }

  const allAssets = uploadedAssetUrls.map((url) => ({ type: 'upload' as const, url }));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancelButton}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('newPost.title')}</Text>
        <TouchableOpacity
          style={[styles.postButton, !canSubmit && styles.postButtonDisabled]}
          onPress={() => createPost.mutate()}
          disabled={!canSubmit}
        >
          <Text style={styles.postButtonText}>{t('newPost.postButton')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.form} contentContainerStyle={styles.formContent}>
        <View style={styles.authorRow}>
          <Avatar name={user?.name || '?'} avatarUrl={user?.avatarUrl} size={48} />
          <View>
            <Text style={styles.authorName}>{user?.name}</Text>
            <Text style={styles.groupName}>
              {groups?.find((g: Group) => g.id === groupId)?.name || t('newPost.loading')}
            </Text>
          </View>
        </View>

        {groups && groups.length > 1 && (
          <View style={styles.groupSelector}>
            <Text style={styles.sectionLabel}>{t('newPost.groupLabel')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {groups.map((group: Group) => (
                <TouchableOpacity
                  key={group.id}
                  style={[styles.groupChip, group.id === groupId && styles.groupChipActive]}
                  onPress={() => setGroupId(group.id)}
                >
                  <Text
                    style={[
                      styles.groupChipText,
                      group.id === groupId && styles.groupChipTextActive,
                    ]}
                  >
                    {group.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <TextInput
          style={styles.textInput}
          placeholder={t('newPost.contentPlaceholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          value={content}
          onChangeText={setContent}
          autoFocus
        />

        {(allAssets.length > 0 || pendingAssets.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectedAssets}>
            {allAssets.map((asset) => {
              const isVideo = isVideoUrl(asset.url);
              return (
                <View key={asset.url} style={styles.selectedAsset}>
                  {isVideo ? (
                    <MutedVideoThumb uri={getUploadUrl(asset.url)} style={styles.selectedAssetImage} />
                  ) : (
                    <Image
                      source={{ uri: getUploadUrl(asset.url) }}
                      style={styles.selectedAssetImage}
                    />
                  )}
                  {isVideo && (
                    <View style={styles.videoBadge} pointerEvents="none">
                      <Icon name="play" size={14} color={colors.white} />
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.removeAssetButton}
                    onPress={() => removeUploadedAsset(asset.url)}
                  >
                    <Icon name="x" size={12} color={colors.white} />
                  </TouchableOpacity>
                </View>
              );
            })}
            {pendingAssets.map((asset, index) => (
              <View key={`pending-${index}`} style={styles.selectedAsset}>
                {asset.isVideo ? (
                  <MutedVideoThumb uri={asset.uri} style={styles.selectedAssetImage} />
                ) : (
                  <Image source={{ uri: asset.uri }} style={styles.selectedAssetImage} />
                )}
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator size="small" color={colors.white} />
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        <TouchableOpacity style={styles.addPhotoButton} onPress={pickImagesFromDevice} disabled={uploading}>
          <View style={styles.addPhotoIcon}>
            <Icon name="smartphone" size={18} color={colors.white} />
          </View>
          <View>
            <Text style={styles.addPhotoTitle}>{t('newPost.addPhotoTitle')}</Text>
            <Text style={styles.addPhotoSubtitle}>{t('newPost.addPhotoSubtitle')}</Text>
          </View>
        </TouchableOpacity>

        {location ? (
          <View style={styles.locationChip}>
            <Icon name="map-pin" size={16} color={colors.primary} />
            <Text style={styles.locationChipText} numberOfLines={1}>
              {location.locationName || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`}
            </Text>
            <TouchableOpacity onPress={() => setShowLocationPicker(true)}>
              <Text style={styles.locationChipAction}>{t('common.edit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLocation(null)}>
              <Icon name="x" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.addPhotoButton} onPress={() => setShowLocationPicker(true)}>
            <View style={styles.addPhotoIcon}>
              <Icon name="map-pin" size={18} color={colors.white} />
            </View>
            <View>
              <Text style={styles.addPhotoTitle}>{t('newPost.location.addTitle')}</Text>
              <Text style={styles.addPhotoSubtitle}>{t('newPost.location.addSubtitle')}</Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.divider} />

        <View style={styles.milestoneRow}>
          <View>
            <Text style={styles.milestoneTitle}>{t('newPost.milestoneTitle')}</Text>
            <Text style={styles.milestoneSubtitle}>{t('newPost.milestoneSubtitle')}</Text>
          </View>
          <Switch
            value={isMilestone}
            onValueChange={setIsMilestone}
            trackColor={{ false: colors.border, true: colors.milestone }}
            thumbColor={colors.white}
          />
        </View>

        {isMilestone && (
          <View style={styles.tagList}>
            {MILESTONE_TAG_KEYS.map((tagKey) => {
              const tag = t(`newPost.milestoneTags.${tagKey}`);
              const active = !isCustomTag && selectedTag === tag;
              return (
                <TouchableOpacity
                  key={tagKey}
                  style={[styles.tagChip, active && styles.tagChipActive]}
                  onPress={() => {
                    setIsCustomTag(false);
                    setSelectedTag(tag);
                  }}
                >
                  <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.tagChip, isCustomTag && styles.tagChipActive]}
              onPress={() => {
                setIsCustomTag(true);
                setSelectedTag(null);
              }}
            >
              <Text style={[styles.tagChipText, isCustomTag && styles.tagChipTextActive]}>
                {t('newPost.milestoneTags.custom')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {isMilestone && isCustomTag && (
          <TextInput
            style={styles.customTagInput}
            placeholder={t('newPost.milestoneTags.customPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={customTagText}
            onChangeText={setCustomTagText}
            maxLength={50}
            autoFocus
          />
        )}
      </ScrollView>

      <LocationPickerModal
        visible={showLocationPicker}
        initialLocation={location}
        onCancel={() => setShowLocationPicker(false)}
        onConfirm={(picked) => {
          setLocation(picked);
          setShowLocationPicker(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancelButton: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 17,
    color: colors.primary,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  postButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 100,
  },
  postButtonDisabled: {
    backgroundColor: colors.border,
  },
  postButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.white,
  },
  form: {
    flex: 1,
  },
  formContent: {
    padding: 16,
    paddingBottom: 44,
    gap: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  authorName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  groupName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  groupSelector: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textTitle,
  },
  groupChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  groupChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  groupChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textTitle,
  },
  groupChipTextActive: {
    color: colors.white,
  },
  textInput: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 18,
    color: colors.textTitle,
    lineHeight: 28,
    minHeight: 100,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 16,
  },
  selectedAssets: {
    gap: 10,
    paddingVertical: 4,
  },
  selectedAsset: {
    width: 110,
    height: 110,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  selectedAssetImage: {
    width: 110,
    height: 110,
  },
  removeAssetButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.bg,
    borderRadius: 14,
    padding: 12,
  },
  addPhotoIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  addPhotoSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  milestoneTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  milestoneSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  tagList: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  tagChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  tagChipActive: {
    borderColor: colors.milestone,
    backgroundColor: '#FFF5E6',
  },
  tagChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
  },
  tagChipTextActive: {
    color: colors.textTitle,
    fontFamily: 'Nunito_700Bold',
  },
  customTagInput: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
    borderWidth: 1.5,
    borderColor: colors.milestone,
    backgroundColor: '#FFF5E6',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  locationChipText: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textTitle,
  },
  locationChipAction: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.primary,
  },
});
