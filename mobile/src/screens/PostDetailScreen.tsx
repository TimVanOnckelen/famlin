import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
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
  createComment,
  reactToComment,
  updatePost,
  deletePost,
  updateComment,
  deleteComment,
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

export function PostDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { postId } = route.params;
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; authorName: string } | null>(null);
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostContent, setEditPostContent] = useState('');
  const [postReactionPickerOpen, setPostReactionPickerOpen] = useState(false);
  const [reactionPickerCommentId, setReactionPickerCommentId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<{ id: string; name: string }[]>([]);
  const [commentAttachment, setCommentAttachment] = useState<{ uri: string; isVideo: boolean; uploadedUrl?: string } | null>(null);

  const { data: post } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => fetchPost(postId),
  });

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
      attachmentUrl,
    }: {
      content: string;
      parentId?: string;
      mentionedUserIds?: string[];
      attachmentUrl?: string;
    }) => createComment(postId, { content: content || undefined, parentId, mentionedUserIds, attachmentUrl }),
    onSuccess: () => {
      setCommentText('');
      setReplyingTo(null);
      setSelectedMentions([]);
      setMentionQuery(null);
      setCommentAttachment(null);
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
    mutationFn: (content: string) => updatePost(postId, content),
    onSuccess: () => {
      setIsEditingPost(false);
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
    mutationFn: ({ id, content }: { id: string; content: string }) => updateComment(id, content),
    onSuccess: () => refetch(),
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.editFailed'));
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.deleteFailed'));
    },
  });

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

  const topLevelComments = useMemo(
    () => (comments || []).filter((comment: Comment) => !comment.parentId),
    [comments]
  );

  function submitComment() {
    const trimmed = commentText.trim();
    if (!trimmed && !commentAttachment?.uploadedUrl) return;
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
      attachmentUrl: commentAttachment?.uploadedUrl,
    });
  }

  const { pick: pickAttachmentMedia, uploading: attachmentUploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
      videoMaxDuration: 120,
    },
    // Show the local preview (with the uploading overlay) while the upload
    // is in flight; clear it again if the upload fails.
    onPicked: ([asset]) => setCommentAttachment({ uri: asset.uri, isVideo: asset.isVideo }),
    onError: () => setCommentAttachment(null),
  });

  async function pickCommentAttachment() {
    const result = await pickAttachmentMedia();
    if (!result) return;
    const [asset] = result.assets;
    const [uploadedUrl] = result.urls;
    setCommentAttachment({ uri: asset.uri, isVideo: asset.isVideo, uploadedUrl });
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
    setIsEditingPost(true);
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

  const canSavePostEdit = editPostContent.trim().length > 0 || allPhotoUrls.length > 0;

  return (
    <SafeAreaView
      style={styles.container}
      edges={hasPhotos ? ['left', 'right', 'bottom'] : ['top', 'left', 'right', 'bottom']}
    >
      {!hasPhotos && <ScreenHeader title={t('postDetail.title')} onBack={() => navigation.goBack()} />}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={topLevelComments}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <>
              {hasPhotos && (
                <View>
                  <TouchableOpacity activeOpacity={0.95} onPress={() => openFullscreen(0)}>
                    <MediaThumbnail url={allPhotoUrls[0]} style={styles.heroImage} />
                  </TouchableOpacity>
                  {isMilestone && (
                    <View style={styles.heroScrim} pointerEvents="none">
                      <Scrim />
                      <View style={styles.heroBadge}>
                        <Text style={styles.milestoneBadgeText}>{t('postDetail.milestoneBadge')}</Text>
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
                hasPhotos && styles.postContainerOverlap,
                isMilestone && !hasPhotos && styles.milestoneContainer,
              ]}
            >
              {isMilestone && !hasPhotos && (
                <View style={styles.milestoneBadge}>
                  <Text style={styles.milestoneBadgeText}>{t('postDetail.milestoneBadge')}</Text>
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
                  <View style={styles.postEditActions}>
                    <TouchableOpacity
                      style={styles.postEditCancelButton}
                      onPress={() => setIsEditingPost(false)}
                      disabled={editPostMutation.isPending}
                    >
                      <Text style={styles.postEditCancelText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.postEditSaveButton, !canSavePostEdit && styles.sendButtonDisabled]}
                      onPress={() => editPostMutation.mutate(editPostContent.trim())}
                      disabled={editPostMutation.isPending || !canSavePostEdit}
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

              {allPhotoUrls.length > 1 && (
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
                {reactors.length > 0 && <ReactorStack reactors={reactors} />}
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
                comment={item}
                replies={repliesByParentId.get(item.id) || []}
                currentUserId={user?.id}
                onLike={(commentId, type) => likeCommentMutation.mutate({ commentId, type })}
                onLongPressLike={(commentId) => setReactionPickerCommentId(commentId)}
                onReply={(comment) => setReplyingTo({ id: comment.id, authorName: comment.author.name })}
                onEdit={(id, content) => editCommentMutation.mutateAsync({ id, content })}
                onDelete={(commentId) => deleteCommentMutation.mutate(commentId)}
              />
            </View>
          )}
          contentContainerStyle={hasPhotos ? styles.commentsListHero : styles.commentsList}
        />

        {hasPhotos && (
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

        {commentAttachment && (
          <View style={styles.attachmentPreviewRow}>
            <View style={styles.attachmentPreview}>
              <MediaThumbnail url={commentAttachment.uri} style={styles.attachmentPreviewImage} />
              {attachmentUploading && (
                <View style={styles.attachmentUploadingOverlay}>
                  <ActivityIndicator size="small" color={colors.white} />
                </View>
              )}
              <TouchableOpacity
                style={styles.attachmentRemoveButton}
                onPress={() => setCommentAttachment(null)}
                accessibilityLabel={t('postDetail.removeAttachment')}
              >
                <Icon name="x" size={12} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.inputContainer}>
          <Avatar name={user?.name || '?'} avatarUrl={user?.avatarUrl} size={36} />
          <TouchableOpacity
            style={styles.attachButton}
            onPress={pickCommentAttachment}
            disabled={attachmentUploading}
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
              !commentText.trim() && !commentAttachment?.uploadedUrl && styles.sendButtonDisabled,
            ]}
            onPress={submitComment}
            disabled={(!commentText.trim() && !commentAttachment?.uploadedUrl) || attachmentUploading}
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
    </SafeAreaView>
  );
}

function CommentItem({
  comment,
  replies,
  currentUserId,
  onLike,
  onLongPressLike,
  onReply,
  onEdit,
  onDelete,
}: {
  comment: Comment;
  replies: Comment[];
  currentUserId?: string;
  onLike: (commentId: string, type: ReactionType) => void;
  onLongPressLike: (commentId: string) => void;
  onReply: (comment: Comment) => void;
  onEdit: (commentId: string, content: string) => Promise<unknown>;
  onDelete: (commentId: string) => void;
}) {
  return (
    <View style={styles.commentItem}>
      <Avatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} size={38} />
      <View style={styles.commentContent}>
        <CommentBody
          comment={comment}
          isOwn={comment.authorId === currentUserId}
          onLike={(type) => onLike(comment.id, type)}
          onLongPressLike={() => onLongPressLike(comment.id)}
          onReply={() => onReply(comment)}
          onEdit={onEdit}
          onDelete={onDelete}
        />

        {replies.length > 0 && (
          <View style={styles.repliesContainer}>
            {replies.map((reply) => (
              <View key={reply.id} style={styles.replyItem}>
                <Avatar name={reply.author.name} avatarUrl={reply.author.avatarUrl} size={30} />
                <View style={styles.commentContent}>
                  <CommentBody
                    comment={reply}
                    isOwn={reply.authorId === currentUserId}
                    onLike={(type) => onLike(reply.id, type)}
                    onLongPressLike={() => onLongPressLike(reply.id)}
                    onReply={() => onReply(comment)}
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
  comment,
  isOwn,
  onLike,
  onLongPressLike,
  onReply,
  onEdit,
  onDelete,
}: {
  comment: Comment;
  isOwn: boolean;
  onLike: (type: ReactionType) => void;
  onLongPressLike: () => void;
  onReply: () => void;
  onEdit: (commentId: string, content: string) => Promise<unknown>;
  onDelete: (commentId: string) => void;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setEditText(comment.content);
    setIsEditing(true);
  }

  async function saveEdit() {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onEdit(comment.id, trimmed);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(t('postDetail.deleteCommentConfirmTitle'), t('postDetail.deleteCommentConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => onDelete(comment.id) },
    ]);
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
        <View style={styles.commentEditActions}>
          <TouchableOpacity onPress={() => setIsEditing(false)} disabled={saving}>
            <Text style={styles.commentAction}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={saveEdit} disabled={saving || !editText.trim()}>
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
      {!!comment.attachmentUrl && (
        <TouchableOpacity
          style={styles.commentAttachment}
          activeOpacity={0.9}
          accessibilityLabel={t('postDetail.viewAttachment')}
          onPress={() =>
            navigation.navigate('ImageViewer', { urls: [getUploadUrl(comment.attachmentUrl!)], initialIndex: 0 })
          }
        >
          <MediaThumbnail
            url={getUploadUrl(comment.attachmentUrl, 'thumbnail')}
            fallbackUrl={getUploadUrl(comment.attachmentUrl)}
            style={styles.commentAttachmentImage}
          />
        </TouchableOpacity>
      )}
      <View style={styles.commentMetaRow}>
        <Text style={styles.commentTime}>
          {formatRelativeDate(comment.createdAt)}
          {comment.editedAt ? ` · ${t('common.edited')}` : ''}
        </Text>
        <TouchableOpacity onPress={() => onLike(comment.myReaction ?? 'LIKE')} onLongPress={onLongPressLike}>
          <Text style={[styles.commentAction, comment.myReaction && styles.commentActionActive]}>
            {comment.myReaction ? REACTION_EMOJI[comment.myReaction] : t('postDetail.like')}
            {comment.likeCount > 0 ? ` · ${comment.likeCount}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onReply}>
          <Text style={styles.commentAction}>{t('postDetail.reply')}</Text>
        </TouchableOpacity>
        {isOwn && (
          <>
            <TouchableOpacity onPress={startEdit}>
              <Text style={styles.commentAction}>{t('common.edit')}</Text>
            </TouchableOpacity>
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
  milestoneBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.milestoneText,
    backgroundColor: colors.milestone,
    paddingHorizontal: 13,
    paddingVertical: 4,
    borderRadius: 100,
    alignSelf: 'flex-start',
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
