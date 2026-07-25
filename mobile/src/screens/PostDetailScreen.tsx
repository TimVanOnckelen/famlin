import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { Avatar } from '@/components/Avatar';
import { PostLocationPreview } from '@/components/PostLocationPreview';
import { ReactionPicker } from '@/components/ReactionPicker';
import { ReactionsModal } from '@/components/ReactionsModal';
import { ReactorStack } from '@/components/ReactorStack';
import { Scrim } from '@/components/Scrim';
import { ScreenHeader } from '@/components/ScreenHeader';
import { postTypeRenderers } from '@/components/postTypes';
import { Comment, ReactionType } from '@/types';
import {
  fetchPost,
  fetchComments,
  fetchGroupMembers,
  GroupMember,
  CommentGroup,
  MAX_COMMENT_ATTACHMENTS,
  createComment,
  reactToComment,
  updatePost,
  deletePost,
  updateComment,
  deleteComment,
  groupCommentAttachments,
  // Aliased: this screen already has a `commentAttachments` state variable
  // for the comment being composed, which is a different thing entirely.
  commentAttachments as commentAttachmentUrls,
} from '@famlin/api-client';
import { REACTION_EMOJI } from '@/constants/reactions';
import { getUploadUrl } from '@/api/uploads';
import { formatRelativeDate } from '@/i18n/utils';
import { useAuthStore } from '@/stores/authStore';
import { useReactToPost, useToggleFavorite } from '@/hooks/usePostMutations';
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia';

// Matches a trailing "@partial-name" at the end of the text being typed —
// deliberately only the end, not anywhere in the string, since that's the
// only place a user is actively composing a mention.
const TRAILING_MENTION_REGEX = /(?:^|\s)@([\p{L}\d_]*)$/u;

// Up to this many photos on one comment card lay out as a wrapping grid;
// beyond it the card becomes a horizontally scrolling gallery instead, so a
// long photo burst never pushes the rest of the thread off the screen.
const COMMENT_GRID_MAX_TILES = 4;

// Same rule for the post's own photos: up to four (hero included) lay out as
// the wrapping grid, more than that scrolls sideways.
const POST_GRID_MAX_PHOTOS = 4;

/** Mirrors uploadedAssetUrls' max in the backend's updatePostBodySchema. */
const MAX_POST_ASSETS = 20;

export function PostDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { postId } = route.params;
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; authorName: string } | null>(null);
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostContent, setEditPostContent] = useState('');
  // The post's photos as the edit has them so far — seeded from the post when
  // editing starts, then added to and removed from until save, which sends
  // the whole list. Pending entries are local URIs whose upload is still in
  // flight, shown with a spinner and not yet part of the list being saved.
  const [editPostAssets, setEditPostAssets] = useState<string[]>([]);
  const [editPostPendingAssets, setEditPostPendingAssets] = useState<{ uri: string; isVideo: boolean }[]>([]);
  const [postReactionPickerOpen, setPostReactionPickerOpen] = useState(false);
  const [reactionPickerCommentId, setReactionPickerCommentId] = useState<string | null>(null);
  const [reactionsModalOpen, setReactionsModalOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<{ id: string; name: string }[]>([]);
  // Staged attachments for the comment being written — a local preview each,
  // with uploadedUrl filled in once its upload lands.
  const [commentAttachments, setCommentAttachments] = useState<
    { uri: string; isVideo: boolean; uploadedUrl?: string }[]
  >([]);
  const uploadedAttachmentUrls = commentAttachments
    .map((a) => a.uploadedUrl)
    .filter((url): url is string => !!url);

  const { data: post } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => fetchPost(postId),
  });

  // TRIP posts have their own detail screen (cover/timeline/check-ins) —
  // any navigation that lands here for one instead (a notification, a chat
  // milestone reference, a deep link) gets redirected rather than rendering
  // this screen's generic UPDATE/MILESTONE/POLL layout for it.
  useEffect(() => {
    if (post?.type === 'TRIP') {
      navigation.replace('TripDetail', { postId });
    } else if (post?.type === 'ALBUM') {
      navigation.replace('AlbumDetail', { postId });
    }
  }, [post?.type, postId]);

  const { data: comments, refetch } = useQuery({
    queryKey: ['comments', postId],
    queryFn: () => fetchComments(postId),
  });

  const { data: groupMembers } = useQuery<GroupMember[]>({
    queryKey: ['groupMembers', post?.groupId],
    queryFn: () => fetchGroupMembers(post!.groupId),
    enabled: !!post?.groupId,
  });

  // Shared optimistic mutations — same intent as the previous local
  // invalidate-only variants, but the caches now update immediately like
  // they do from PostCard / the image viewer. The action buttons only render
  // once `post` is loaded (the screen returns null until then), so the
  // non-null assertion never bites at mutate time.
  const likeMutation = useReactToPost(post!);
  const favoriteMutation = useToggleFavorite(post!);

  const commentMutation = useMutation({
    mutationFn: ({
      content,
      parentId,
      mentionedUserIds,
      attachmentUrls,
    }: {
      content: string;
      parentId?: string;
      mentionedUserIds?: string[];
      attachmentUrls?: string[];
    }) => createComment(postId, { content: content || undefined, parentId, mentionedUserIds, attachmentUrls }),
    onSuccess: () => {
      setCommentText('');
      setReplyingTo(null);
      setSelectedMentions([]);
      setMentionQuery(null);
      setCommentAttachments([]);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('common.tryAgain'));
    },
  });

  const likeCommentMutation = useMutation({
    mutationFn: ({ commentId, type }: { commentId: string; type: ReactionType }) => reactToComment(commentId, type),
    onSuccess: () => refetch(),
  });

  const editPostMutation = useMutation({
    mutationFn: ({ content, uploadedAssetUrls }: { content: string; uploadedAssetUrls: string[] }) =>
      updatePost(postId, { content, uploadedAssetUrls }),
    onSuccess: () => {
      setIsEditingPost(false);
      setEditPostPendingAssets([]);
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.editFailed'));
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: () => deletePost(postId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.deleteFailed'));
    },
  });

  const editCommentMutation = useMutation({
    // attachmentUrls is always sent (never undefined) because the edit UI
    // always shows the comment's photos — an unchanged list is the same list.
    mutationFn: ({ id, content, attachmentUrls }: { id: string; content: string; attachmentUrls: string[] }) =>
      updateComment(id, { content, attachmentUrls }),
    onSuccess: () => {
      refetch();
      // An edit can now change a comment's photos, so refresh the post the
      // same way deleting a comment does rather than only the thread.
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.editFailed'));
    },
  });

  const deleteCommentMutation = useMutation({
    // Takes a list because a bundled photo card stands for several comments —
    // deleting it removes exactly the ones it shows.
    mutationFn: (commentIds: string[]) => Promise.all(commentIds.map((id) => deleteComment(id))),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.deleteFailed'));
    },
  });

  // Runs of photo-only comments by the same author collapse into one card
  // (see groupCommentAttachments) — both at top level and within a thread.
  const repliesByParentId = useMemo(() => {
    const map = new Map<string, Comment[]>();
    for (const comment of comments || []) {
      if (!comment.parentId) continue;
      const list = map.get(comment.parentId) || [];
      list.push(comment);
      map.set(comment.parentId, list);
    }
    return map;
  }, [comments]);

  // A bundle stands for several comments, so its replies are everything
  // hanging off any of them, back in chronological order.
  const replyGroupsFor = (group: CommentGroup): CommentGroup[] =>
    groupCommentAttachments(
      group.comments
        .flatMap((comment) => repliesByParentId.get(comment.id) || [])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );

  const topLevelGroups = useMemo(
    () => groupCommentAttachments((comments || []).filter((comment: Comment) => !comment.parentId)),
    [comments]
  );

  function submitComment() {
    const trimmed = commentText.trim();
    if (!trimmed && !uploadedAttachmentUrls.length) return;
    // Only mention someone whose "@name" is still actually present in the
    // final text — if the user deleted it after picking it from the list,
    // don't notify them.
    const mentionedUserIds = selectedMentions
      .filter((m) => commentText.includes(`@${m.name}`))
      .map((m) => m.id);
    commentMutation.mutate({
      content: trimmed,
      parentId: replyingTo?.id,
      mentionedUserIds,
      attachmentUrls: uploadedAttachmentUrls,
    });
  }

  const attachmentRoom = MAX_COMMENT_ATTACHMENTS - commentAttachments.length;
  // How many placeholders the batch in flight appended, so a failed upload
  // removes exactly those and leaves earlier picks alone.
  const attachmentBatchSize = useRef(0);

  const { pick: pickAttachmentMedia, uploading: attachmentUploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, attachmentRoom),
      quality: 0.8,
      videoMaxDuration: 120,
    },
    includeIndexInName: true,
    // Show the local previews (with the uploading overlay) while the upload
    // is in flight; drop them again if it fails.
    onPicked: (assets) => {
      attachmentBatchSize.current = assets.length;
      setCommentAttachments((old) => [
        ...old,
        ...assets.map((asset) => ({ uri: asset.uri, isVideo: asset.isVideo })),
      ]);
    },
    onError: () => {
      setCommentAttachments((old) => old.slice(0, Math.max(0, old.length - attachmentBatchSize.current)));
    },
  });

  async function pickCommentAttachments() {
    if (attachmentRoom <= 0) return;
    const result = await pickAttachmentMedia();
    if (!result) return;
    // Swap the placeholders this batch added for the uploaded versions.
    setCommentAttachments((old) => [
      ...old.slice(0, Math.max(0, old.length - result.assets.length)),
      ...result.assets.map((asset, index) => ({
        uri: asset.uri,
        isVideo: asset.isVideo,
        uploadedUrl: result.urls[index],
      })),
    ]);
  }

  function removeCommentAttachment(index: number) {
    setCommentAttachments((old) => old.filter((_, i) => i !== index));
  }

  // Same pick-then-upload flow as the composer's, for photos added while
  // editing the post. Removing one is local until save — nothing is deleted
  // from the server, the saved list just stops referring to it.
  const editPostAssetRoom = MAX_POST_ASSETS - editPostAssets.length;

  const { pick: pickEditPostMedia, uploading: editPostUploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, editPostAssetRoom),
      quality: 0.8,
      videoMaxDuration: 120,
    },
    includeIndexInName: true,
    onPicked: setEditPostPendingAssets,
  });

  async function pickEditPostAssets() {
    if (editPostAssetRoom <= 0) return;
    const result = await pickEditPostMedia();
    if (result) setEditPostAssets((prev) => [...prev, ...result.urls]);
    setEditPostPendingAssets([]);
  }

  function removeEditPostAsset(url: string) {
    setEditPostAssets((prev) => prev.filter((u) => u !== url));
  }

  function handleCommentTextChange(text: string) {
    setCommentText(text);
    const match = text.match(TRAILING_MENTION_REGEX);
    setMentionQuery(match ? match[1] : null);
  }

  function selectMention(member: GroupMember) {
    const replaced = commentText.replace(TRAILING_MENTION_REGEX, (matched) =>
      (matched.startsWith(' ') ? ' ' : '') + `@${member.name} `
    );
    setCommentText(replaced);
    setSelectedMentions((prev) => (prev.some((m) => m.id === member.id) ? prev : [...prev, { id: member.id, name: member.name }]));
    setMentionQuery(null);
  }

  const mentionSuggestions = (groupMembers || []).filter(
    (m) => mentionQuery !== null && m.id !== user?.id && m.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  if (!post) return null;

  const isMilestone = post.type === 'MILESTONE';

  const allPhotoUrls = post.uploadedAssetUrls.map((url: string) => getUploadUrl(url));
  const allPhotoThumbUrls = post.uploadedAssetUrls.map((url: string) => getUploadUrl(url, 'thumbnail'));
  const fullscreenUrls = allPhotoUrls;
  const hasPhotos = allPhotoUrls.length > 0;
  const reactors = post.recentReactors ?? [];
  const TypeCardBody = postTypeRenderers[post.type]?.CardBody;

  function openFullscreen(index: number) {
    navigation.navigate('ImageViewer', {
      urls: fullscreenUrls,
      assetUrls: post!.uploadedAssetUrls,
      postId: post!.id,
      initialIndex: index,
    });
  }

  const isOwnPost = post.authorId === user?.id;

  function startEditPost() {
    setEditPostContent(post!.content || '');
    setEditPostAssets(post!.uploadedAssetUrls);
    setEditPostPendingAssets([]);
    setIsEditingPost(true);
  }

  function cancelEditPost() {
    setIsEditingPost(false);
    setEditPostPendingAssets([]);
  }

  function confirmDeletePost() {
    Alert.alert(t('postDetail.deletePostConfirmTitle'), t('postDetail.deletePostConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deletePostMutation.mutate() },
    ]);
  }

  function openPostMenu() {
    Alert.alert(t('postDetail.postOptions'), undefined, [
      { text: t('postDetail.editPost'), onPress: startEditPost },
      { text: t('postDetail.deletePost'), style: 'destructive', onPress: confirmDeletePost },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  // A post can be photos-only or text-only, but not neither — and it's the
  // edit's own photo list that decides, not the one currently on screen.
  const canSavePostEdit = editPostContent.trim().length > 0 || editPostAssets.length > 0;

  // While editing, the photo strip in the editor IS the post's photo list —
  // the read-only hero and gallery would show a stale second copy of it (and
  // a photo the user just removed), so they step aside for the duration. The
  // hero doubles as the screen's chrome when there are photos, so everything
  // keyed off it (the safe-area top edge, the header, the floating back
  // button, the sheet's overlap) has to follow the same flag.
  const showHeroPhoto = hasPhotos && !isEditingPost;

  return (
    <SafeAreaView
      style={styles.container}
      edges={showHeroPhoto ? ['left', 'right', 'bottom'] : ['top', 'left', 'right', 'bottom']}
    >
      {!showHeroPhoto && <ScreenHeader title={t('postDetail.title')} onBack={() => navigation.goBack()} />}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={topLevelGroups}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={
            <>
              {showHeroPhoto && (
                <View>
                  <TouchableOpacity activeOpacity={0.95} onPress={() => openFullscreen(0)}>
                    <MediaThumbnail url={allPhotoUrls[0]} style={styles.heroImage} />
                  </TouchableOpacity>
                  {isMilestone && (
                    <View style={styles.heroScrim} pointerEvents="none">
                      <Scrim />
                      <View style={styles.heroBadge}>
                        <View style={styles.milestoneBadgePill}>
                          <Icon name="gift" size={12} color={colors.milestoneText} />
                          <Text style={styles.milestoneBadgeText}>{t('postDetail.milestoneBadge')}</Text>
                        </View>
                      </View>
                      {!!post.content && (
                        <Text style={styles.heroMilestoneTitle} numberOfLines={3}>
                          {post.content}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}
            <View
              style={[
                styles.postContainer,
                showHeroPhoto && styles.postContainerOverlap,
                isMilestone && !hasPhotos && styles.milestoneContainer,
              ]}
            >
              {isMilestone && !hasPhotos && (
                <View style={styles.milestoneBadge}>
                  <View style={styles.milestoneBadgePill}>
                    <Icon name="gift" size={12} color={colors.milestoneText} />
                    <Text style={styles.milestoneBadgeText}>{t('postDetail.milestoneBadge')}</Text>
                  </View>
                </View>
              )}

              <View style={styles.authorRow}>
                <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={48} />
                <View style={styles.authorInfo}>
                  <Text style={styles.authorName}>{post.author.name}</Text>
                  <Text style={styles.postTime}>
                    {post.group?.name
                      ? t('postDetail.postedInGroup', {
                          group: post.group.name,
                          time: formatRelativeDate(post.createdAt),
                        })
                      : formatRelativeDate(post.createdAt)}
                    {post.editedAt ? ` · ${t('common.edited')}` : ''}
                  </Text>
                </View>
                {isOwnPost && !isEditingPost && (
                  <TouchableOpacity
                    onPress={openPostMenu}
                    style={styles.postMenuButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="more-vertical" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {isEditingPost ? (
                <View style={styles.postEditContainer}>
                  <TextInput
                    style={styles.postEditInput}
                    value={editPostContent}
                    onChangeText={setEditPostContent}
                    placeholder={t('postDetail.editPlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    multiline
                    autoFocus
                  />

                  {(editPostAssets.length > 0 || editPostPendingAssets.length > 0) && (
                    <View style={styles.editAttachmentRow}>
                      {editPostAssets.map((url) => (
                        <View style={styles.attachmentPreview} key={url}>
                          <MediaThumbnail
                            url={getUploadUrl(url, 'thumbnail')}
                            fallbackUrl={getUploadUrl(url)}
                            style={styles.attachmentPreviewImage}
                          />
                          <TouchableOpacity
                            style={styles.attachmentRemoveButton}
                            onPress={() => removeEditPostAsset(url)}
                            accessibilityLabel={t('postDetail.removeAttachment')}
                          >
                            <Icon name="x" size={12} color={colors.white} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {editPostPendingAssets.map((asset, index) => (
                        <View style={styles.attachmentPreview} key={`pending-${index}`}>
                          <MediaThumbnail url={asset.uri} style={styles.attachmentPreviewImage} />
                          <View style={styles.attachmentUploadingOverlay}>
                            <ActivityIndicator size="small" color={colors.white} />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.postEditActions}>
                    <TouchableOpacity
                      style={styles.editAddPhotoButton}
                      onPress={pickEditPostAssets}
                      disabled={editPostUploading || editPostAssetRoom <= 0}
                      accessibilityLabel={t('postDetail.addAttachment')}
                    >
                      <Icon name="image" size={16} color={colors.primary} />
                      <Text style={styles.editAddPhotoText}>{t('postDetail.addPhotos')}</Text>
                    </TouchableOpacity>
                    <View style={styles.editActionsSpacer} />
                    <TouchableOpacity
                      style={styles.postEditCancelButton}
                      onPress={cancelEditPost}
                      disabled={editPostMutation.isPending}
                    >
                      <Text style={styles.postEditCancelText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.postEditSaveButton,
                        (!canSavePostEdit || editPostUploading) && styles.sendButtonDisabled,
                      ]}
                      onPress={() =>
                        editPostMutation.mutate({
                          content: editPostContent.trim(),
                          uploadedAssetUrls: editPostAssets,
                        })
                      }
                      disabled={editPostMutation.isPending || editPostUploading || !canSavePostEdit}
                    >
                      <Text style={styles.postEditSaveText}>{t('common.save')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : isMilestone ? (
                !hasPhotos && <Text style={styles.milestoneTitle}>{post.content}</Text>
              ) : (
                !!post.content && <Text style={styles.postContent}>{post.content}</Text>
              )}

              {/* Registry entry for post.type (e.g. POLL) — renders below the
                  content above, which for a poll is already the question, so
                  this must not repeat it. Hidden while editing the post's own
                  content, same as the content Text above. */}
              {!isEditingPost && TypeCardBody && <TypeCardBody post={post} />}

              {post.latitude != null && post.longitude != null && (
                <PostLocationPreview latitude={post.latitude} longitude={post.longitude} locationName={post.locationName} />
              )}

              {!isEditingPost && allPhotoUrls.length > 1 && allPhotoUrls.length <= POST_GRID_MAX_PHOTOS && (
                <View style={styles.photoGallery}>
                  {allPhotoUrls.slice(1).map((url: string, index: number) => (
                    <TouchableOpacity
                      key={url}
                      activeOpacity={0.95}
                      style={styles.photoWrapper}
                      onPress={() => openFullscreen(index + 1)}
                    >
                      <MediaThumbnail url={allPhotoThumbUrls[index + 1]} fallbackUrl={url} style={styles.photoImage} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Past POST_GRID_MAX_PHOTOS the wrapping grid would push the
                  post's text and comments far down the screen — scroll the
                  photos sideways instead. */}
              {!isEditingPost && allPhotoUrls.length > POST_GRID_MAX_PHOTOS && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.photoStrip}
                  contentContainerStyle={styles.photoStripContent}
                >
                  {allPhotoUrls.slice(1).map((url: string, index: number) => (
                    <TouchableOpacity
                      key={url}
                      activeOpacity={0.95}
                      style={styles.photoStripItem}
                      onPress={() => openFullscreen(index + 1)}
                    >
                      <MediaThumbnail url={allPhotoThumbUrls[index + 1]} fallbackUrl={url} style={styles.photoImage} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <View style={[styles.actionsRow, isMilestone && styles.actionsRowMilestone]}>
                <TouchableOpacity
                  style={[styles.likeButton, post.myReaction && styles.likeButtonActive]}
                  onPress={() => likeMutation.mutate(post.myReaction ?? 'LOVE')}
                  onLongPress={() => setPostReactionPickerOpen(true)}
                >
              {post.myReaction ? (
                <Text style={styles.reactionEmoji}>{REACTION_EMOJI[post.myReaction]}</Text>
              ) : (
                <Icon name="heart" size={16} color={colors.textMuted} />
              )}
              <Text style={[styles.likeButtonText, post.myReaction && styles.likeButtonTextActive]}>
                {post.likeCount}
              </Text>
                </TouchableOpacity>
                <Text style={styles.commentCount}>{t('postDetail.comments', { count: post.commentCount })}</Text>
                {reactors.length > 0 && (
                  <ReactorStack reactors={reactors} onPress={() => setReactionsModalOpen(true)} />
                )}
                <TouchableOpacity
                  style={styles.favoriteButton}
                  onPress={() => favoriteMutation.mutate()}
                  disabled={favoriteMutation.isPending}
                  accessibilityLabel={t('postDetail.favorite')}
                >
                  <Icon
                    name="bookmark"
                    size={18}
                    color={post.favoritedByMe ? colors.primary : colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              <Text style={styles.commentsHeader}>{t('postDetail.commentsHeader', { count: comments?.length || 0 })}</Text>
            </View>
            </>
          }
          renderItem={({ item }) => (
            <View style={hasPhotos ? styles.commentPad : undefined}>
              <CommentItem
                group={item}
                replyGroups={replyGroupsFor(item)}
                currentUserId={user?.id}
                onLike={(commentId, type) => likeCommentMutation.mutate({ commentId, type })}
                onLongPressLike={(commentId) => setReactionPickerCommentId(commentId)}
                onReply={(comment) => setReplyingTo({ id: comment.id, authorName: comment.author.name })}
                onEdit={(id, content, attachmentUrls) =>
                  editCommentMutation.mutateAsync({ id, content, attachmentUrls })
                }
                onDelete={(commentIds) => deleteCommentMutation.mutate(commentIds)}
              />
            </View>
          )}
          contentContainerStyle={hasPhotos ? styles.commentsListHero : styles.commentsList}
        />

        {showHeroPhoto && (
          <TouchableOpacity
            style={[styles.floatingBack, { top: insets.top + 8 }]}
            onPress={() => navigation.goBack()}
            accessibilityLabel={t('common.back')}
          >
            <Icon name="arrow-left" size={20} color={colors.textTitle} />
          </TouchableOpacity>
        )}

        {replyingTo && (
          <View style={styles.replyingBar}>
            <Text style={styles.replyingBarText}>
              {t('postDetail.replyingTo', { name: replyingTo.authorName })}
            </Text>
            <TouchableOpacity onPress={() => setReplyingTo(null)}>
              <Text style={styles.replyingBarCancel}>{t('postDetail.cancelReply')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {mentionSuggestions.length > 0 && (
          <View style={styles.mentionList}>
            {mentionSuggestions.slice(0, 5).map((member) => (
              <TouchableOpacity key={member.id} style={styles.mentionItem} onPress={() => selectMention(member)}>
                <Avatar name={member.name} avatarUrl={member.avatarUrl} size={28} />
                <Text style={styles.mentionItemText}>{member.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {commentAttachments.length > 0 && (
          <View style={styles.attachmentPreviewRow}>
            {commentAttachments.map((attachment, index) => (
              <View style={styles.attachmentPreview} key={`${attachment.uri}-${index}`}>
                <MediaThumbnail url={attachment.uri} style={styles.attachmentPreviewImage} />
                {!attachment.uploadedUrl && (
                  <View style={styles.attachmentUploadingOverlay}>
                    <ActivityIndicator size="small" color={colors.white} />
                  </View>
                )}
                <TouchableOpacity
                  style={styles.attachmentRemoveButton}
                  onPress={() => removeCommentAttachment(index)}
                  accessibilityLabel={t('postDetail.removeAttachment')}
                >
                  <Icon name="x" size={12} color={colors.white} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.inputContainer}>
          <Avatar name={user?.name || '?'} avatarUrl={user?.avatarUrl} size={36} />
          <TouchableOpacity
            style={styles.attachButton}
            onPress={pickCommentAttachments}
            disabled={attachmentUploading || attachmentRoom <= 0}
            accessibilityLabel={t('postDetail.addAttachment')}
          >
            <Icon name="image" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={replyingTo ? t('postDetail.replyPlaceholder') : t('postDetail.commentPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={commentText}
            onChangeText={handleCommentTextChange}
            multiline
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !commentText.trim() && !uploadedAttachmentUrls.length && styles.sendButtonDisabled,
            ]}
            onPress={submitComment}
            disabled={(!commentText.trim() && !uploadedAttachmentUrls.length) || attachmentUploading}
          >
            <Icon name="send" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <ReactionPicker
        visible={postReactionPickerOpen}
        onSelect={(type) => {
          setPostReactionPickerOpen(false);
          likeMutation.mutate(type);
        }}
        onClose={() => setPostReactionPickerOpen(false)}
      />
      <ReactionPicker
        visible={reactionPickerCommentId !== null}
        onSelect={(type) => {
          if (reactionPickerCommentId) likeCommentMutation.mutate({ commentId: reactionPickerCommentId, type });
          setReactionPickerCommentId(null);
        }}
        onClose={() => setReactionPickerCommentId(null)}
      />
      <ReactionsModal
        postId={reactionsModalOpen ? postId : null}
        onClose={() => setReactionsModalOpen(false)}
      />
    </SafeAreaView>
  );
}

function CommentItem({
  group,
  replyGroups,
  currentUserId,
  onLike,
  onLongPressLike,
  onReply,
  onEdit,
  onDelete,
}: {
  group: CommentGroup;
  replyGroups: CommentGroup[];
  currentUserId?: string;
  onLike: (commentId: string, type: ReactionType) => void;
  onLongPressLike: (commentId: string) => void;
  onReply: (comment: Comment) => void;
  onEdit: (commentId: string, content: string, attachmentUrls: string[]) => Promise<unknown>;
  onDelete: (commentIds: string[]) => void;
}) {
  const { lead } = group;
  return (
    <View style={styles.commentItem}>
      <Avatar name={lead.author.name} avatarUrl={lead.author.avatarUrl} size={38} />
      <View style={styles.commentContent}>
        <CommentBody
          group={group}
          isOwn={lead.authorId === currentUserId}
          onLike={(type) => onLike(group.reactionTargetId, type)}
          onLongPressLike={() => onLongPressLike(group.reactionTargetId)}
          onReply={() => onReply(lead)}
          onEdit={onEdit}
          onDelete={onDelete}
        />

        {replyGroups.length > 0 && (
          <View style={styles.repliesContainer}>
            {replyGroups.map((replyGroup) => (
              <View key={replyGroup.key} style={styles.replyItem}>
                <Avatar name={replyGroup.lead.author.name} avatarUrl={replyGroup.lead.author.avatarUrl} size={30} />
                <View style={styles.commentContent}>
                  <CommentBody
                    group={replyGroup}
                    isOwn={replyGroup.lead.authorId === currentUserId}
                    onLike={(type) => onLike(replyGroup.reactionTargetId, type)}
                    onLongPressLike={() => onLongPressLike(replyGroup.reactionTargetId)}
                    onReply={() => onReply(lead)}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function CommentBody({
  group,
  isOwn,
  onLike,
  onLongPressLike,
  onReply,
  onEdit,
  onDelete,
}: {
  group: CommentGroup;
  isOwn: boolean;
  onLike: (type: ReactionType) => void;
  onLongPressLike: () => void;
  onReply: () => void;
  onEdit: (commentId: string, content: string, attachmentUrls: string[]) => Promise<unknown>;
  onDelete: (commentIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const comment = group.lead;
  const attachmentUrls = group.attachments.map((attachment) => attachment.url);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  // The comment's photos as the edit has them so far, same wholesale-replace
  // contract as the post editor above. Editing is only offered on a
  // single-comment card (see the Edit button below), so these are exactly
  // this comment's own attachments.
  const [editAttachments, setEditAttachments] = useState<string[]>([]);
  const [editPendingAttachments, setEditPendingAttachments] = useState<{ uri: string; isVideo: boolean }[]>([]);
  const [saving, setSaving] = useState(false);

  const editAttachmentRoom = MAX_COMMENT_ATTACHMENTS - editAttachments.length;

  const { pick: pickEditMedia, uploading: editUploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, editAttachmentRoom),
      quality: 0.8,
      videoMaxDuration: 120,
    },
    includeIndexInName: true,
    onPicked: setEditPendingAttachments,
  });

  async function pickEditAttachments() {
    if (editAttachmentRoom <= 0) return;
    const result = await pickEditMedia();
    if (result) setEditAttachments((prev) => [...prev, ...result.urls]);
    setEditPendingAttachments([]);
  }

  function startEdit() {
    setEditText(comment.content);
    setEditAttachments(commentAttachmentUrls(comment));
    setEditPendingAttachments([]);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditPendingAttachments([]);
  }

  const canSaveEdit = !!editText.trim() || editAttachments.length > 0;

  async function saveEdit() {
    if (!canSaveEdit) return;
    setSaving(true);
    try {
      await onEdit(comment.id, editText.trim(), editAttachments);
      setIsEditing(false);
      setEditPendingAttachments([]);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    // A bundle is one card standing for several comments, so say how many are
    // about to go rather than silently deleting more than the user sees.
    const message = group.isBundle
      ? t('postDetail.deletePhotoCommentsConfirmMessage', { count: group.comments.length })
      : t('postDetail.deleteCommentConfirmMessage');
    Alert.alert(t('postDetail.deleteCommentConfirmTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => onDelete(group.comments.map((c) => c.id)),
      },
    ]);
  }

  function openViewer(index: number) {
    navigation.navigate('ImageViewer', {
      urls: attachmentUrls.map((url) => getUploadUrl(url)),
      initialIndex: index,
    });
  }

  if (isEditing) {
    return (
      <View style={styles.commentEditContainer}>
        <TextInput
          style={styles.commentEditInput}
          value={editText}
          onChangeText={setEditText}
          multiline
          autoFocus
        />

        {(editAttachments.length > 0 || editPendingAttachments.length > 0) && (
          <View style={styles.editAttachmentRow}>
            {editAttachments.map((url) => (
              <View style={styles.attachmentPreview} key={url}>
                <MediaThumbnail
                  url={getUploadUrl(url, 'thumbnail')}
                  fallbackUrl={getUploadUrl(url)}
                  style={styles.attachmentPreviewImage}
                />
                <TouchableOpacity
                  style={styles.attachmentRemoveButton}
                  onPress={() => setEditAttachments((prev) => prev.filter((u) => u !== url))}
                  accessibilityLabel={t('postDetail.removeAttachment')}
                >
                  <Icon name="x" size={12} color={colors.white} />
                </TouchableOpacity>
              </View>
            ))}
            {editPendingAttachments.map((asset, index) => (
              <View style={styles.attachmentPreview} key={`pending-${index}`}>
                <MediaThumbnail url={asset.uri} style={styles.attachmentPreviewImage} />
                <View style={styles.attachmentUploadingOverlay}>
                  <ActivityIndicator size="small" color={colors.white} />
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.commentEditActions}>
          <TouchableOpacity
            style={styles.editAddPhotoButton}
            onPress={pickEditAttachments}
            disabled={editUploading || editAttachmentRoom <= 0}
            accessibilityLabel={t('postDetail.addAttachment')}
          >
            <Icon name="image" size={16} color={colors.primary} />
            <Text style={styles.editAddPhotoText}>{t('postDetail.addPhotos')}</Text>
          </TouchableOpacity>
          <View style={styles.editActionsSpacer} />
          <TouchableOpacity onPress={cancelEdit} disabled={saving}>
            <Text style={styles.commentAction}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={saveEdit} disabled={saving || editUploading || !canSaveEdit}>
            <Text style={[styles.commentAction, styles.commentActionActive]}>{t('common.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.commentBubble}>
        <Text style={styles.commentAuthor}>{comment.author.name}</Text>
        {!!comment.content && <Text style={styles.commentText}>{comment.content}</Text>}
      </View>
      {attachmentUrls.length === 1 && (
        <TouchableOpacity
          style={styles.commentAttachment}
          activeOpacity={0.9}
          accessibilityLabel={t('postDetail.viewAttachment')}
          onPress={() => openViewer(0)}
        >
          <MediaThumbnail
            url={getUploadUrl(attachmentUrls[0], 'thumbnail')}
            fallbackUrl={getUploadUrl(attachmentUrls[0])}
            style={styles.commentAttachmentImage}
          />
        </TouchableOpacity>
      )}
      {attachmentUrls.length > 1 && attachmentUrls.length <= COMMENT_GRID_MAX_TILES && (
        <View style={styles.commentAttachmentGrid}>
          {attachmentUrls.map((url, index) => (
            <TouchableOpacity
              key={`${url}-${index}`}
              style={styles.commentAttachmentTile}
              activeOpacity={0.9}
              accessibilityLabel={t('postDetail.viewAttachment')}
              onPress={() => openViewer(index)}
            >
              <MediaThumbnail
                url={getUploadUrl(url, 'thumbnail')}
                fallbackUrl={getUploadUrl(url)}
                style={styles.commentAttachmentTileImage}
              />
            </TouchableOpacity>
          ))}
        </View>
      )}
      {attachmentUrls.length > COMMENT_GRID_MAX_TILES && (
        // A scrolling row needs to say so — the count badge is what tells you
        // there's more here than the tiles that happen to fit.
        <View style={styles.commentAttachmentGallery}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.commentAttachmentGalleryContent}
          >
            {attachmentUrls.map((url, index) => (
              <TouchableOpacity
                key={`${url}-${index}`}
                style={styles.commentAttachmentTile}
                activeOpacity={0.9}
                accessibilityLabel={t('postDetail.viewAttachment')}
                onPress={() => openViewer(index)}
              >
                <MediaThumbnail
                  url={getUploadUrl(url, 'thumbnail')}
                  fallbackUrl={getUploadUrl(url)}
                  style={styles.commentAttachmentTileImage}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.commentAttachmentCount} pointerEvents="none">
            <Icon name="image" size={11} color={colors.white} />
            <Text style={styles.commentAttachmentCountText}>{attachmentUrls.length}</Text>
          </View>
        </View>
      )}
      <View style={styles.commentMetaRow}>
        <Text style={styles.commentTime}>
          {formatRelativeDate(comment.createdAt)}
          {comment.editedAt ? ` · ${t('common.edited')}` : ''}
        </Text>
        {attachmentUrls.length > 1 && (
          <Text style={styles.commentTime}>
            {t('postDetail.photoCount', { count: attachmentUrls.length })}
          </Text>
        )}
        <TouchableOpacity onPress={() => onLike(group.myReaction ?? 'LIKE')} onLongPress={onLongPressLike}>
          <Text style={[styles.commentAction, group.myReaction && styles.commentActionActive]}>
            {group.myReaction ? REACTION_EMOJI[group.myReaction] : t('postDetail.like')}
            {group.likeCount > 0 ? ` · ${group.likeCount}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onReply}>
          <Text style={styles.commentAction}>{t('postDetail.reply')}</Text>
        </TouchableOpacity>
        {isOwn && (
          <>
            {/* Editing a bundle would write text onto just one of the photos
                it stands for, so it stays a single-comment action. */}
            {!group.isBundle && (
              <TouchableOpacity onPress={startEdit}>
                <Text style={styles.commentAction}>{t('common.edit')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={confirmDelete}>
              <Text style={styles.commentAction}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  flex: {
    flex: 1,
  },
  postContainer: {
    padding: 14,
    backgroundColor: colors.white,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
    marginBottom: 14,
  },
  heroImage: {
    width: '100%',
    height: 360,
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 64,
    paddingHorizontal: 16,
    // Room for the sheet below to overlap the photo without covering the title.
    paddingBottom: 52,
    justifyContent: 'flex-end',
  },
  heroBadge: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  heroMilestoneTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 23,
    color: colors.white,
    letterSpacing: -0.3,
  },
  postContainerOverlap: {
    marginTop: -36,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
  },
  floatingBack: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 5,
  },
  commentPad: {
    paddingHorizontal: 14,
  },
  milestoneContainer: {
    backgroundColor: colors.milestoneBg,
    borderBottomColor: colors.milestoneDivider,
  },
  milestoneBadge: {
    marginBottom: 10,
  },
  milestoneBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.milestone,
    paddingHorizontal: 13,
    paddingVertical: 4,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  milestoneBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.milestoneText,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  authorInfo: {
    flex: 1,
  },
  authorName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  postTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  postMenuButton: {
    padding: 4,
  },
  postContent: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 17,
    color: colors.textBody,
    lineHeight: 26,
    marginBottom: 12,
  },
  postEditContainer: {
    marginBottom: 12,
  },
  postEditInput: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    lineHeight: 24,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  postEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  postEditCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.bg,
  },
  postEditCancelText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textMuted,
  },
  postEditSaveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.primary,
  },
  postEditSaveText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.white,
  },
  milestoneTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 23,
    color: colors.textTitle,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  photoGallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  photoStrip: {
    marginBottom: 12,
  },
  photoStripContent: {
    gap: 6,
  },
  photoStripItem: {
    width: 150,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  photoWrapper: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  photoWrapperSingle: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  actionsRowMilestone: {
    borderTopColor: 'rgba(242, 184, 92, 0.3)',
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.bg,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 100,
  },
  likeButtonActive: {
    backgroundColor: 'rgba(217, 106, 94, 0.12)',
  },
  likeButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textMuted,
  },
  likeButtonTextActive: {
    color: colors.primary,
  },
  commentCount: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
    flex: 1,
  },
  favoriteButton: {
    padding: 4,
  },
  commentsHeader: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 14,
  },
  commentsList: {
    padding: 14,
    paddingBottom: 80,
  },
  // Hero variant: no horizontal padding so the photo runs edge-to-edge;
  // comment rows re-add it via commentPad.
  commentsListHero: {
    paddingBottom: 80,
  },
  commentItem: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  commentContent: {
    flex: 1,
  },
  commentBubble: {
    backgroundColor: colors.bg,
    borderRadius: 4,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  commentAuthor: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textTitle,
    marginBottom: 3,
  },
  commentAttachment: {
    marginTop: 6,
    width: 160,
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
  },
  commentAttachmentImage: {
    width: '100%',
    height: '100%',
  },
  // Several photos — one multi-photo comment, or a bundle of consecutive
  // photo-only comments from the same author (see groupCommentAttachments).
  commentAttachmentGrid: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    maxWidth: 244,
  },
  // More than COMMENT_GRID_MAX_TILES photos: one scrollable strip instead of
  // a grid that would grow taller with every burst.
  commentAttachmentGallery: {
    marginTop: 6,
    position: 'relative',
  },
  commentAttachmentGalleryContent: {
    gap: 4,
    paddingRight: 14,
  },
  commentAttachmentCount: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(20, 10, 5, 0.62)',
  },
  commentAttachmentCountText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  commentAttachmentTile: {
    width: 78,
    height: 78,
    borderRadius: 10,
    overflow: 'hidden',
  },
  commentAttachmentTileImage: {
    width: '100%',
    height: '100%',
  },
  commentText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 16,
    color: colors.textBody,
    lineHeight: 24,
  },
  commentTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    marginLeft: 4,
  },
  commentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
    marginLeft: 4,
  },
  commentAction: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.textMuted,
  },
  commentActionActive: {
    color: colors.primary,
  },
  commentEditContainer: {
    flex: 1,
  },
  commentEditInput: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
    lineHeight: 22,
    backgroundColor: colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 13,
    paddingVertical: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  commentEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 14,
    marginTop: 6,
    marginLeft: 4,
  },
  repliesContainer: {
    marginTop: 12,
    marginLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: 12,
    gap: 14,
  },
  replyItem: {
    flexDirection: 'row',
    gap: 8,
  },
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  replyingBarText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  replyingBarCancel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.primary,
  },
  attachmentPreviewRow: {
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Same tiles as the composer's preview row above, minus that row's screen
  // padding — these sit inside the post/comment editor's own container.
  editAttachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  editAddPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  editAddPhotoText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.primary,
  },
  editActionsSpacer: {
    flex: 1,
  },
  attachmentPreview: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  attachmentPreviewImage: {
    width: '100%',
    height: '100%',
  },
  attachmentUploadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentRemoveButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingBottom: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
  sendButtonText: {
    color: colors.white,
    fontSize: 18,
    marginLeft: 2,
  },
  reactionEmoji: {
    fontSize: 16,
  },
  mentionList: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 6,
    maxHeight: 200,
  },
  mentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  mentionItemText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
  },
});
