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
  SafeAreaView,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { Avatar } from '@/components/Avatar';
import { PostLocationPreview } from '@/components/PostLocationPreview';
import { api } from '@/api/client';
import { Post, Comment } from '@/types';
import { getUploadUrl } from '@/api/uploads';
import { formatRelativeDate } from '@/i18n/utils';
import { useAuthStore } from '@/stores/authStore';

export function PostDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { postId } = route.params;
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; authorName: string } | null>(null);
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostContent, setEditPostContent] = useState('');

  const { data: post } = useQuery({
    queryKey: ['post', postId],
    queryFn: async () => {
      const response = await api.get<Post>(`/posts/${postId}`);
      return response.data;
    },
  });

  const { data: comments, refetch } = useQuery({
    queryKey: ['comments', postId],
    queryFn: async () => {
      const response = await api.get<Comment[]>(`/posts/${postId}/comments`);
      return response.data;
    },
  });

  const likeMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/posts/${postId}/like`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/posts/${postId}/favorite`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string }) => {
      const response = await api.post(`/posts/${postId}/comments`, { content, parentId });
      return response.data;
    },
    onSuccess: () => {
      setCommentText('');
      setReplyingTo(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  const likeCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const response = await api.post(`/comments/${commentId}/like`);
      return response.data;
    },
    onSuccess: () => refetch(),
  });

  const editPostMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await api.patch(`/posts/${postId}`, { content });
      return response.data;
    },
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
    mutationFn: async () => {
      await api.delete(`/posts/${postId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.deleteFailed'));
    },
  });

  const editCommentMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const response = await api.patch(`/comments/${id}`, { content });
      return response.data;
    },
    onSuccess: () => refetch(),
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.editFailed'));
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await api.delete(`/comments/${commentId}`);
    },
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
    if (!commentText.trim()) return;
    commentMutation.mutate({ content: commentText.trim(), parentId: replyingTo?.id });
  }

  if (!post) return null;

  const isMilestone = post.type === 'MILESTONE';

  const allPhotoUrls = post.uploadedAssetUrls.map((url: string) => getUploadUrl(url));
  const fullscreenUrls = allPhotoUrls;

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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={18} color={colors.primary} />
          <Text style={styles.backButtonText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('postDetail.title')}</Text>
        <View style={styles.headerRight} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={topLevelComments}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={[styles.postContainer, isMilestone && styles.milestoneContainer]}>
              {isMilestone && (
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
                <Text style={styles.milestoneTitle}>{post.content}</Text>
              ) : (
                <Text style={styles.postContent}>{post.content}</Text>
              )}

              {post.latitude != null && post.longitude != null && (
                <PostLocationPreview latitude={post.latitude} longitude={post.longitude} locationName={post.locationName} />
              )}

              {allPhotoUrls.length > 0 && (
                <View style={styles.photoGallery}>
                  {allPhotoUrls.map((url: string, index: number) => (
                    <TouchableOpacity
                      key={url}
                      activeOpacity={0.95}
                      style={[
                        styles.photoWrapper,
                        allPhotoUrls.length === 1 && styles.photoWrapperSingle,
                      ]}
                      onPress={() => openFullscreen(index)}
                    >
                      <MediaThumbnail url={url} style={styles.photoImage} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={[styles.actionsRow, isMilestone && styles.actionsRowMilestone]}>
                <TouchableOpacity
                  style={[styles.likeButton, post.likedByMe && styles.likeButtonActive]}
                  onPress={() => likeMutation.mutate()}
                >
              <Icon
                name="heart"
                size={16}
                color={post.likedByMe ? colors.primary : colors.textMuted}
              />
              <Text style={[styles.likeButtonText, post.likedByMe && styles.likeButtonTextActive]}>
                {post.likeCount}
              </Text>
                </TouchableOpacity>
                <Text style={styles.commentCount}>{t('postDetail.comments', { count: post.commentCount })}</Text>
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
          }
          renderItem={({ item }) => (
            <CommentItem
              comment={item}
              replies={repliesByParentId.get(item.id) || []}
              currentUserId={user?.id}
              onLike={(commentId) => likeCommentMutation.mutate(commentId)}
              onReply={(comment) => setReplyingTo({ id: comment.id, authorName: comment.author.name })}
              onEdit={(id, content) => editCommentMutation.mutateAsync({ id, content })}
              onDelete={(commentId) => deleteCommentMutation.mutate(commentId)}
            />
          )}
          contentContainerStyle={styles.commentsList}
        />

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

        <View style={styles.inputContainer}>
          <Avatar name={user?.name || '?'} avatarUrl={user?.avatarUrl} size={36} />
          <TextInput
            style={styles.input}
            placeholder={replyingTo ? t('postDetail.replyPlaceholder') : t('postDetail.commentPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={commentText}
            onChangeText={setCommentText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, !commentText.trim() && styles.sendButtonDisabled]}
            onPress={submitComment}
            disabled={!commentText.trim()}
          >
            <Icon name="send" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CommentItem({
  comment,
  replies,
  currentUserId,
  onLike,
  onReply,
  onEdit,
  onDelete,
}: {
  comment: Comment;
  replies: Comment[];
  currentUserId?: string;
  onLike: (commentId: string) => void;
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
          onLike={() => onLike(comment.id)}
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
                    onLike={() => onLike(reply.id)}
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
  onReply,
  onEdit,
  onDelete,
}: {
  comment: Comment;
  isOwn: boolean;
  onLike: () => void;
  onReply: () => void;
  onEdit: (commentId: string, content: string) => Promise<unknown>;
  onDelete: (commentId: string) => void;
}) {
  const { t } = useTranslation();
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
        <Text style={styles.commentText}>{comment.content}</Text>
      </View>
      <View style={styles.commentMetaRow}>
        <Text style={styles.commentTime}>
          {formatRelativeDate(comment.createdAt)}
          {comment.editedAt ? ` · ${t('common.edited')}` : ''}
        </Text>
        <TouchableOpacity onPress={onLike}>
          <Text style={[styles.commentAction, comment.likedByMe && styles.commentActionActive]}>
            {t('postDetail.like')}
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  backButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.primary,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  headerRight: {
    width: 70,
  },
  postContainer: {
    padding: 14,
    backgroundColor: colors.white,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
  },
  milestoneContainer: {
    backgroundColor: '#FFF5E6',
    borderBottomColor: 'rgba(242, 184, 92, 0.3)',
  },
  milestoneBadge: {
    marginBottom: 10,
  },
  milestoneBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.white,
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
    fontSize: 16,
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
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
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
  commentText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
    lineHeight: 22,
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
    width: 42,
    height: 42,
    borderRadius: 21,
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
});
