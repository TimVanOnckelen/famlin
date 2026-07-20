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
import { TravelerPickerModal } from '@/components/TravelerPickerModal';
import {
  buildGroupSelectionPayload,
  toggleGroupSelection,
  resolveOfferedPostTypes,
  reconcilePostTypeSelection,
} from '@/utils/newPost';
import { useGroupMembersIntersection } from '@/hooks/useGroupMembersIntersection';

const MILESTONE_TAG_KEYS = ['birthday', 'birth', 'anniversary', 'graduation'] as const;
const POST_TYPES = ['UPDATE', 'MILESTONE', 'POLL', 'TRIP'] as const;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 10;
// 'YYYY-MM-DD' — matches the backend contract's typeData.startDate/endDate
// shape exactly (no time component).
const TRIP_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Icon/accent used by the "what do you want to share?" type-chooser step.
const POST_TYPE_ICON: Record<string, string> = {
  UPDATE: '📝',
  MILESTONE: '🎂',
  POLL: '🗳️',
  TRIP: '🧳',
};
const POST_TYPE_ICON_BG: Record<string, string> = {
  UPDATE: colors.updateBg,
  MILESTONE: colors.milestoneBg,
  POLL: colors.primaryTint,
  TRIP: colors.tripTint,
};

// Colors for the swappable type chip at the top of the compose step — one
// palette per type, echoing the type-chooser row it was picked from.
const POST_TYPE_CHIP_STYLE: Record<string, { bg: string; border: string; iconBg: string; text: string }> = {
  UPDATE: { bg: colors.updateBg, border: '#f0c3ac', iconBg: colors.accent, text: '#8a3f22' },
  MILESTONE: { bg: colors.milestoneBg, border: colors.milestoneDivider, iconBg: colors.milestone, text: colors.milestoneText },
  POLL: { bg: colors.primaryTint, border: '#a9dced', iconBg: colors.primary, text: colors.primaryDark },
  TRIP: { bg: colors.tripTint, border: colors.tripBorder, iconBg: colors.trip, text: colors.tripDark },
};

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
  // Which post type to share is chosen up front, on its own step, before the
  // rest of the composer (content, media, type-specific fields) is shown.
  const [composerStep, setComposerStep] = useState<'type' | 'compose'>('type');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isCustomTag, setIsCustomTag] = useState(false);
  const [customTagText, setCustomTagText] = useState('');
  // Poll composer state: option text inputs, starting at the minimum of 2.
  // Only non-empty ones are sent (see createPostMutation below).
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  // Trip composer state (design 6g) — dates are plain 'YYYY-MM-DD' text,
  // there's no date-picker dependency in this app yet.
  const [tripTitle, setTripTitle] = useState('');
  const [tripDestination, setTripDestination] = useState('');
  const [tripStartDate, setTripStartDate] = useState('');
  const [tripEndDate, setTripEndDate] = useState('');
  const [tripCoverPhotoUrl, setTripCoverPhotoUrl] = useState<string | null>(null);
  // Co-travelers: group members (besides the author) who may also check in.
  const [tripTravelerIds, setTripTravelerIds] = useState<string[]>([]);
  const [showTravelerPicker, setShowTravelerPicker] = useState(false);
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
  const isTrip = postType === 'TRIP';

  // Valid trip co-travelers = members of EVERY selected group (the server
  // enforces this per target group on a cross-posted trip). Shares the
  // ['groupMembers', ...] caches with the picker modal.
  const { members: travelerCandidates, loaded: travelerCandidatesLoaded } = useGroupMembersIntersection(
    selectedGroupIds,
    isTrip
  );
  const travelerCandidateIdsKey = travelerCandidates.map((member) => member.id).join(',');

  // When the group selection changes, previously picked co-travelers may no
  // longer be in the intersection — drop them (only once every member list
  // has loaded, so an in-flight fetch can't wrongly clear the selection).
  React.useEffect(() => {
    if (!isTrip || !travelerCandidatesLoaded) return;
    setTripTravelerIds((prev) => {
      const next = prev.filter((id) => travelerCandidates.some((member) => member.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [isTrip, travelerCandidatesLoaded, travelerCandidateIdsKey]);
  const tripStartDateValid = TRIP_DATE_REGEX.test(tripStartDate);
  const tripEndDateValid = tripEndDate.length === 0 || TRIP_DATE_REGEX.test(tripEndDate);

  const createPostMutation = useMutation({
    mutationFn: () => {
      if (selectedGroupIds.length === 0) throw new Error(t('newPost.alerts.noGroupSelected'));
      return createPost({
        ...buildGroupSelectionPayload(selectedGroupIds),
        content: isTrip ? undefined : content,
        type: postType,
        milestoneTag: isMilestone ? (isCustomTag ? customTagText.trim() || undefined : selectedTag ?? undefined) : undefined,
        typeData: isTrip
          ? {
              title: tripTitle.trim(),
              destination: tripDestination.trim() || undefined,
              startDate: tripStartDate,
              endDate: tripEndDate || undefined,
              coverPhotoUrl: tripCoverPhotoUrl || undefined,
              travelerUserIds: tripTravelerIds.length > 0 ? tripTravelerIds : undefined,
            }
          : postType === 'POLL'
            ? { options: nonEmptyPollOptions.map((text) => ({ text })) }
            : undefined,
        uploadedAssetUrls: isTrip ? [] : uploadedAssetUrls,
        latitude: isTrip ? undefined : location?.latitude,
        longitude: isTrip ? undefined : location?.longitude,
        locationName: isTrip ? undefined : location?.locationName,
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
    (isTrip
      ? tripTitle.trim().length > 0 && tripStartDateValid && tripEndDateValid
      : postType === 'POLL'
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

  // Trip's cover photo is a single optional image, separate from the
  // multi-photo attach flow above — reuses the same pick-then-upload hook
  // with single-selection options.
  const { pick: pickTripCoverMedia, uploading: tripCoverUploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.8,
    },
    onError: (err) => console.error('Cover photo upload error:', err),
  });

  async function pickTripCoverPhoto() {
    const result = await pickTripCoverMedia();
    if (result && result.urls[0]) setTripCoverPhotoUrl(result.urls[0]);
  }

  // Step 1: pick who to share with and what kind of post to make, as a
  // separate screen of large, unambiguous tap targets — before showing any
  // of the compose form below. Selecting a type here just pre-fills
  // `postType` and advances the step; changing your mind afterwards still
  // works via the segmented control further down in the compose step.
  if (composerStep === 'type') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.cancelButton}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('newPost.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.form} contentContainerStyle={styles.chooserContent}>
          {groups && groups.length > 1 && (
            <View style={styles.groupSelector}>
              <Text style={styles.sectionLabel}>{t('newPost.groupsLabel')}</Text>
              <View style={styles.chooserGroupChips}>
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
              </View>
            </View>
          )}

          <View style={styles.chooserTypeSection}>
            <Text style={styles.chooserSectionTitle}>{t('newPost.chooserTitle')}</Text>

            {noOfferedPostTypes ? (
              <Text style={styles.noPostTypesNotice}>{t('newPost.noPostTypesForSelection')}</Text>
            ) : (
              <View style={styles.typeList}>
                {offeredPostTypes.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={styles.typeRow}
                    onPress={() => {
                      setPostType(option);
                      setComposerStep('compose');
                    }}
                  >
                    <View style={[styles.typeRowIcon, { backgroundColor: POST_TYPE_ICON_BG[option] }]}>
                      <Text style={styles.typeRowEmoji}>{POST_TYPE_ICON[option]}</Text>
                    </View>
                    <View style={styles.typeRowText}>
                      <Text style={styles.typeRowTitle}>{t(`newPost.postType.${option.toLowerCase()}`)}</Text>
                      <Text style={styles.typeRowSubtitle}>
                        {t(`newPost.postTypeSubtitle.${option.toLowerCase()}`)}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const chipStyle = POST_TYPE_CHIP_STYLE[postType] ?? POST_TYPE_CHIP_STYLE.UPDATE;
  const contentPlaceholder =
    postType === 'POLL'
      ? t('poll.questionPlaceholder')
      : isMilestone
        ? t('newPost.milestoneContentPlaceholder')
        : t('newPost.contentPlaceholder');

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
        {/* Swappable type chip: tapping it returns to the type-chooser step
            (postType and everything already typed is preserved). Its colors
            and icon reflect whichever type is currently selected. */}
        <View>
          <TouchableOpacity
            style={[styles.typeChip, { backgroundColor: chipStyle.bg, borderColor: chipStyle.border }]}
            onPress={() => setComposerStep('type')}
          >
            <View style={[styles.typeChipIcon, { backgroundColor: chipStyle.iconBg }]}>
              <Text style={styles.typeChipEmoji}>{POST_TYPE_ICON[postType]}</Text>
            </View>
            <Text style={[styles.typeChipLabel, { color: chipStyle.text }]}>
              {t(`newPost.postType.${postType.toLowerCase()}`)}
            </Text>
            <Icon name="chevron-down" size={14} color={chipStyle.text} />
          </TouchableOpacity>
          {noOfferedPostTypes ? (
            // Cross-post target groups with disjoint allow-lists: nothing can
            // be composed for this combination — tell the user why submit is
            // disabled instead of leaving it a mystery.
            <Text style={styles.noPostTypesNotice}>{t('newPost.noPostTypesForSelection')}</Text>
          ) : (
            <Text style={styles.typeChipHint}>{t('newPost.changeTypeHint')}</Text>
          )}
        </View>

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

        {!isTrip && (
          <TextInput
            style={styles.textInput}
            placeholder={contentPlaceholder}
            placeholderTextColor={colors.textMuted}
            multiline
            value={content}
            onChangeText={setContent}
            autoFocus
          />
        )}

        {/* Type-specific fields sit right under the content field, matching
            whichever post type the chip above says is selected. */}
        {isTrip && offeredPostTypes.includes('TRIP') && (
          <View style={styles.tripFields}>
            <Text style={styles.tripHelperText}>{t('newPost.trip.helper')}</Text>

            <View>
              <Text style={styles.sectionLabel}>{t('newPost.trip.titleLabel')} *</Text>
              <TextInput
                style={styles.tripInput}
                placeholder={t('newPost.trip.titlePlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={tripTitle}
                onChangeText={setTripTitle}
                maxLength={120}
                autoFocus
              />
            </View>

            <View>
              <Text style={styles.sectionLabel}>{t('newPost.trip.destinationLabel')}</Text>
              <TextInput
                style={styles.tripInput}
                placeholder={t('newPost.trip.destinationPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={tripDestination}
                onChangeText={setTripDestination}
                maxLength={160}
              />
            </View>

            <View style={styles.tripDateRow}>
              <View style={styles.tripDateField}>
                <Text style={styles.sectionLabel}>{t('newPost.trip.startDateLabel')} *</Text>
                <TextInput
                  style={[styles.tripInput, tripStartDate.length > 0 && !tripStartDateValid && styles.tripInputInvalid]}
                  placeholder={t('newPost.trip.datePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={tripStartDate}
                  onChangeText={setTripStartDate}
                  maxLength={10}
                />
              </View>
              <View style={styles.tripDateField}>
                <Text style={styles.sectionLabel}>{t('newPost.trip.endDateLabel')}</Text>
                <TextInput
                  style={[styles.tripInput, tripEndDate.length > 0 && !tripEndDateValid && styles.tripInputInvalid]}
                  placeholder={t('newPost.trip.endDateOptional')}
                  placeholderTextColor={colors.textMuted}
                  value={tripEndDate}
                  onChangeText={setTripEndDate}
                  maxLength={10}
                />
              </View>
            </View>
            <Text style={styles.tripDateHint}>{t('newPost.trip.dateHint')}</Text>

            {tripCoverPhotoUrl ? (
              <View style={styles.tripCoverPreviewWrap}>
                <Image source={{ uri: getUploadUrl(tripCoverPhotoUrl) }} style={styles.tripCoverPreview} />
                <TouchableOpacity style={styles.tripCoverRemoveButton} onPress={() => setTripCoverPhotoUrl(null)}>
                  <Icon name="x" size={12} color={colors.white} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.tripCoverButton}
                onPress={pickTripCoverPhoto}
                disabled={tripCoverUploading}
              >
                <View style={styles.tripCoverButtonIcon}>
                  {tripCoverUploading ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Icon name="plus" size={18} color={colors.white} />
                  )}
                </View>
                <View style={styles.tripCoverButtonText}>
                  <Text style={styles.tripCoverButtonTitle}>{t('newPost.trip.coverPhotoTitle')}</Text>
                  <Text style={styles.tripCoverButtonSubtitle}>{t('newPost.trip.coverPhotoSubtitle')}</Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.tripCoverButton} onPress={() => setShowTravelerPicker(true)}>
              <View style={styles.tripCoverButtonIcon}>
                <Icon name="users" size={16} color={colors.white} />
              </View>
              <View style={styles.tripCoverButtonText}>
                <Text style={styles.tripCoverButtonTitle}>{t('newPost.trip.travelersLabel')}</Text>
                <Text style={styles.tripCoverButtonSubtitle}>
                  {tripTravelerIds.length > 0
                    ? t('newPost.trip.travelersSelected', { count: tripTravelerIds.length })
                    : t('newPost.trip.travelersSubtitle')}
                </Text>
              </View>
            </TouchableOpacity>
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
          <View style={styles.milestoneFields}>
            <Text style={styles.sectionLabel}>{t('newPost.milestoneSubtitle')}</Text>
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
            {isCustomTag && (
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
          </View>
        )}

        {!isTrip && <View style={styles.divider} />}

        {/* Attachments: a compact, growable pill row instead of stacked
            cards, plus a thumbnail strip for whatever's already added. Not
            shown for TRIP — its only photo is the optional cover above,
            handled by the trip fields block. */}
        {!isTrip && (
        <View style={styles.attachSection}>
          <Text style={styles.sectionLabel}>{t('newPost.attachLabel')}</Text>

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

          <View style={styles.attachPillRow}>
            <TouchableOpacity style={styles.attachPill} onPress={pickImagesFromDevice} disabled={uploading}>
              <View style={styles.attachPillIcon}>
                <Icon name="smartphone" size={13} color={colors.white} />
              </View>
              <Text style={styles.attachPillLabel}>{t('newPost.addPhotoTitle')}</Text>
            </TouchableOpacity>

            {(!!mediaAlbums?.length || mediaAlbumsErrored) && (
              <TouchableOpacity style={styles.attachPill} onPress={() => setShowMediaPicker(true)}>
                <View style={styles.attachPillIcon}>
                  <Icon name="image" size={13} color={colors.white} />
                </View>
                <Text style={styles.attachPillLabel}>{t('newPost.addAlbumPhotoTitle')}</Text>
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
              <TouchableOpacity style={styles.attachPill} onPress={() => setShowLocationPicker(true)}>
                <View style={styles.attachPillIcon}>
                  <Icon name="map-pin" size={13} color={colors.white} />
                </View>
                <Text style={styles.attachPillLabel}>{t('newPost.location.addTitle')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
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

      {selectedGroupIds.length > 0 && (
        <TravelerPickerModal
          visible={showTravelerPicker}
          groupIds={selectedGroupIds}
          excludeUserId={user?.id}
          initialSelectedIds={tripTravelerIds}
          onCancel={() => setShowTravelerPicker(false)}
          onConfirm={(userIds) => {
            setTripTravelerIds(userIds);
            setShowTravelerPicker(false);
          }}
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
  headerSpacer: {
    width: 76,
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
  chooserContent: {
    padding: 16,
    paddingBottom: 44,
    gap: 22,
  },
  chooserGroupChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chooserTypeSection: {
    gap: 12,
  },
  chooserSectionTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 18,
    color: colors.textTitle,
  },
  typeList: {
    gap: 10,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 76,
  },
  typeRowIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeRowEmoji: {
    fontSize: 22,
  },
  typeRowText: {
    flex: 1,
  },
  typeRowTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16.5,
    color: colors.textTitle,
  },
  typeRowSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13.5,
    color: colors.textMuted,
    marginTop: 2,
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
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 100,
    paddingVertical: 9,
    paddingHorizontal: 16,
    paddingLeft: 10,
    minHeight: 44,
  },
  typeChipIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeChipEmoji: {
    fontSize: 14,
  },
  typeChipLabel: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
  },
  typeChipHint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 6,
  },
  noPostTypesNotice: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  attachSection: {
    gap: 10,
  },
  attachPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attachPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 100,
    paddingVertical: 10,
    paddingHorizontal: 16,
    paddingLeft: 10,
    minHeight: 44,
  },
  attachPillIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachPillLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textTitle,
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
  milestoneFields: {
    gap: 10,
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
  tripFields: {
    gap: 14,
  },
  tripHelperText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: -6,
  },
  tripInput: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  tripInputInvalid: {
    borderColor: colors.accent,
  },
  tripDateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tripDateField: {
    flex: 1,
  },
  tripDateHint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: -8,
  },
  tripCoverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.tripBorder,
    backgroundColor: colors.tripBg,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tripCoverButtonIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.trip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripCoverButtonText: {
    flex: 1,
  },
  tripCoverButtonTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  tripCoverButtonSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 1,
  },
  tripCoverPreviewWrap: {
    width: 140,
    height: 100,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  tripCoverPreview: {
    width: '100%',
    height: '100%',
  },
  tripCoverRemoveButton: {
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
});
