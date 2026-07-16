import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { Group, PostType } from '@/types';
import { fetchGroups, createPost, getGroupMediaAlbums } from '@famlin/api-client';
import { useAuthStore } from '@/stores/authStore';
import { getUploadUrl } from '@/api/uploads';
import { isVideoUrl } from '@/utils/media';
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia';
import { LocationPickerModal, PickedLocation } from '@/components/LocationPickerModal';
import { MediaPickerModal } from '@/components/MediaPickerModal';
import {
  buildGroupSelectionPayload,
  toggleGroupSelection,
  resolveOfferedPostTypes,
  reconcilePostTypeSelection,
} from '@/utils/newPost';

const MILESTONE_TAG_KEYS = ['birthday', 'birth', 'anniversary', 'graduation'] as const;
const POST_TYPES = ['UPDATE', 'MILESTONE', 'POLL'] as const;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 10;

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
  const user = useAuthStore((state) => state.user);
  const [content, setContent] = useState('');
  const [postType, setPostType] = useState<PostType>('UPDATE');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isCustomTag, setIsCustomTag] = useState(false);
  const [customTagText, setCustomTagText] = useState('');
  // Poll composer state: option text inputs, starting at the minimum of 2.
  // Only non-empty ones are sent (see createPostMutation below).
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const isMilestone = postType === 'MILESTONE';
  // Multi-select: which groups this post goes to. The first entry is the
  // "primary" group (also what the media/album picker is scoped to); more
  // than one selected turns the submit into a cross-post. At least one is
  // always required — see toggleGroupSelection.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [uploadedAssetUrls, setUploadedAssetUrls] = useState<string[]>([]);
  const [pendingAssets, setPendingAssets] = useState<{ uri: string; isVideo: boolean }[]>([]);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  const { data: groups } = useQuery<Group[], Error>({
    queryKey: ['groups'],
    queryFn: fetchGroups,
  });

  // The linked-album media picker targets a single group — when several are
  // selected, drive it from the first one chosen.
  const primaryGroupId = selectedGroupIds[0] ?? null;

  const { data: mediaAlbums, isError: mediaAlbumsErrored } = useQuery({
    queryKey: ['media-albums', primaryGroupId],
    queryFn: () => getGroupMediaAlbums(primaryGroupId!),
    enabled: !!primaryGroupId,
  });

  React.useEffect(() => {
    if (groups && groups.length > 0 && selectedGroupIds.length === 0) {
      setSelectedGroupIds([groups[0].id]);
    }
  }, [groups]);

  // Only the post types EVERY selected target group allows are offered —
  // the server enforces each group's allowedPostTypes on POST /api/posts,
  // so the segmented control must not offer a type a target group rejects.
  // An empty intersection (possible when cross-posting to groups with
  // disjoint allow-lists) disables submit with a notice instead.
  const offeredPostTypes = resolveOfferedPostTypes(POST_TYPES, groups, selectedGroupIds);
  const noOfferedPostTypes = offeredPostTypes.length === 0;

  // When the group selection changes and the current type is no longer
  // offered, snap to the first offered type (UPDATE in practice).
  React.useEffect(() => {
    const reconciled = reconcilePostTypeSelection(postType, offeredPostTypes);
    if (reconciled !== null && reconciled !== postType) {
      setPostType(reconciled);
    }
  }, [offeredPostTypes.join(','), postType]);

  const nonEmptyPollOptions = pollOptions.map((option) => option.trim()).filter((option) => option.length > 0);

  const createPostMutation = useMutation({
    mutationFn: () => {
      if (selectedGroupIds.length === 0) throw new Error(t('newPost.alerts.noGroupSelected'));
      return createPost({
        ...buildGroupSelectionPayload(selectedGroupIds),
        content,
        type: postType,
        milestoneTag: isMilestone ? (isCustomTag ? customTagText.trim() || undefined : selectedTag ?? undefined) : undefined,
        typeData: postType === 'POLL' ? { options: nonEmptyPollOptions.map((text) => ({ text })) } : undefined,
        uploadedAssetUrls,
        latitude: location?.latitude,
        longitude: location?.longitude,
        locationName: location?.locationName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('newPost.alerts.postFailed'));
    },
  });

  const canSubmit =
    selectedGroupIds.length > 0 &&
    !noOfferedPostTypes &&
    offeredPostTypes.includes(postType) &&
    (postType === 'POLL'
      ? content.trim().length > 0 && nonEmptyPollOptions.length >= MIN_POLL_OPTIONS
      : content.trim().length > 0 || uploadedAssetUrls.length > 0);

  function addPollOption() {
    setPollOptions((prev) => (prev.length >= MAX_POLL_OPTIONS ? prev : [...prev, '']));
  }

  function removePollOption(index: number) {
    setPollOptions((prev) => (prev.length <= MIN_POLL_OPTIONS ? prev : prev.filter((_, i) => i !== index)));
  }

  function updatePollOption(index: number, text: string) {
    setPollOptions((prev) => prev.map((option, i) => (i === index ? text : option)));
  }

  const { pick: pickDeviceMedia, uploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.8,
      videoMaxDuration: 120,
    },
    includeIndexInName: true,
    // Show the picked assets (with an uploading overlay) while the upload
    // is in flight.
    onPicked: setPendingAssets,
    onError: (err) => console.error('Upload error:', err),
  });

  async function pickImagesFromDevice() {
    const result = await pickDeviceMedia();
    if (result) setUploadedAssetUrls((prev) => [...prev, ...result.urls]);
    setPendingAssets([]);
  }

  function removeUploadedAsset(url: string) {
    setUploadedAssetUrls((prev) => prev.filter((u) => u !== url));
  }

  function handleMediaConfirm(urls: string[]) {
    setShowMediaPicker(false);
    setUploadedAssetUrls((prev) => [...prev, ...urls]);
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
          onPress={() => createPostMutation.mutate()}
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
              {selectedGroupIds.length > 1
                ? t('newPost.multipleGroupsSelected', { count: selectedGroupIds.length })
                : groups?.find((g: Group) => g.id === primaryGroupId)?.name || t('newPost.loading')}
            </Text>
          </View>
        </View>

        {groups && groups.length > 1 && (
          <View style={styles.groupSelector}>
            <Text style={styles.sectionLabel}>{t('newPost.groupsLabel')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {groups.map((group: Group) => {
                const isActive = selectedGroupIds.includes(group.id);
                return (
                  <TouchableOpacity
                    key={group.id}
                    style={[styles.groupChip, isActive && styles.groupChipActive]}
                    onPress={() => setSelectedGroupIds((prev) => toggleGroupSelection(prev, group.id))}
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.groupChipText, isActive && styles.groupChipTextActive]}>
                      {group.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <TextInput
          style={styles.textInput}
          placeholder={postType === 'POLL' ? t('poll.questionPlaceholder') : t('newPost.contentPlaceholder')}
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

        {(!!mediaAlbums?.length || mediaAlbumsErrored) && (
          <TouchableOpacity style={styles.addPhotoButton} onPress={() => setShowMediaPicker(true)}>
            <View style={styles.addPhotoIcon}>
              <Icon name="image" size={18} color={colors.white} />
            </View>
            <View>
              <Text style={styles.addPhotoTitle}>{t('newPost.addAlbumPhotoTitle')}</Text>
              <Text style={styles.addPhotoSubtitle}>{t('newPost.addAlbumPhotoSubtitle')}</Text>
            </View>
          </TouchableOpacity>
        )}

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

        {noOfferedPostTypes ? (
          // Cross-post target groups with disjoint allow-lists: nothing can
          // be composed for this combination — tell the user why submit is
          // disabled instead of showing an empty control.
          <Text style={styles.noPostTypesNotice}>{t('newPost.noPostTypesForSelection')}</Text>
        ) : (
          <View style={styles.segmentedControl}>
            {offeredPostTypes.map((option) => {
              const active = postType === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.segmentButton, active && styles.segmentButtonActive]}
                  onPress={() => setPostType(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.segmentButtonText, active && styles.segmentButtonTextActive]}>
                    {t(`newPost.postType.${option.toLowerCase()}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {postType === 'POLL' && offeredPostTypes.includes('POLL') && (
          <View style={styles.pollOptionsContainer}>
            {pollOptions.map((optionText, index) => (
              <View key={index} style={styles.pollOptionRow}>
                <TextInput
                  style={styles.pollOptionInput}
                  placeholder={t('poll.optionPlaceholder', { number: index + 1 })}
                  placeholderTextColor={colors.textMuted}
                  value={optionText}
                  onChangeText={(text) => updatePollOption(index, text)}
                  maxLength={100}
                />
                {pollOptions.length > MIN_POLL_OPTIONS && (
                  <TouchableOpacity
                    style={styles.pollOptionRemoveButton}
                    onPress={() => removePollOption(index)}
                    accessibilityLabel={t('poll.removeOption')}
                  >
                    <Icon name="x" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {pollOptions.length < MAX_POLL_OPTIONS && (
              <TouchableOpacity style={styles.pollAddOptionButton} onPress={addPollOption}>
                <Icon name="plus" size={16} color={colors.primary} />
                <Text style={styles.pollAddOptionText}>{t('poll.addOption')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isMilestone && offeredPostTypes.includes('MILESTONE') && (
          <Text style={styles.milestoneSubtitle}>{t('newPost.milestoneSubtitle')}</Text>
        )}

        {isMilestone && offeredPostTypes.includes('MILESTONE') && (
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

        {isMilestone && offeredPostTypes.includes('MILESTONE') && isCustomTag && (
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

      {primaryGroupId && (
        <MediaPickerModal
          visible={showMediaPicker}
          groupId={primaryGroupId}
          onCancel={() => setShowMediaPicker(false)}
          onConfirm={handleMediaConfirm}
        />
      )}
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
    minHeight: 44,
    justifyContent: 'center',
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
    // Matches the FeedScreen family-filter chips for a consistent look.
    backgroundColor: colors.white,
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
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  noPostTypesNotice: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  segmentButtonText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
  },
  segmentButtonTextActive: {
    fontFamily: 'Nunito_700Bold',
    color: colors.primary,
  },
  pollOptionsContainer: {
    gap: 8,
  },
  pollOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pollOptionInput: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pollOptionRemoveButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollAddOptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  pollAddOptionText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.primary,
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
    backgroundColor: colors.milestoneBg,
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
    backgroundColor: colors.milestoneBg,
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
