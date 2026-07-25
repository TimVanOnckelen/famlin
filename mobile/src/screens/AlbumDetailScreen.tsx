import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { AddAlbumPhotosModal } from '@/components/AddAlbumPhotosModal';
import { Comment } from '@/types';
import { fetchPost, fetchComments, createComment, addAlbumPhotos, closeAlbum } from '@famlin/api-client';
import { getUploadUrl } from '@/api/uploads';
import { formatTime } from '@/i18n/utils';
import { useAuthStore } from '@/stores/authStore';
import { patchPostInCaches } from '@/utils/postCache';
import { collectAlbumPhotos, isAlbumDiscussionComment } from '@/utils/album';

// The detail + contribute view of a collaborative photo album — the mobile
// counterpart of web's AlbumDetailPage. Unlike the trip screen, an album is
// inherently collaborative: any group member can add photos (the "Add photos"
// button), and the author can close the album. Photos live on the album's
// contribution comments (utils/album.ts splits them from ordinary comments).
export function AlbumDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { postId } = route.params;
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  const [contributeOpen, setContributeOpen] = useState(false);
  const [commentText, setCommentText] = useState('');

  const { data: post } = useQuery({ queryKey: ['post', postId], queryFn: () => fetchPost(postId) });
  const { data: comments, refetch: refetchComments } = useQuery({
    queryKey: ['comments', postId],
    queryFn: () => fetchComments(postId),
  });

  const album = post?.album;

  const photos = useMemo(() => collectAlbumPhotos(comments || []), [comments]);
  const discussion = useMemo(() => (comments || []).filter((c) => !c.parentId && isAlbumDiscussionComment(c)), [comments]);

  const contributeMutation = useMutation({
    mutationFn: (data: { photoUrls: string[]; caption?: string }) => addAlbumPhotos(postId, data),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, postId, () => updatedPost);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      refetchComments();
      setContributeOpen(false);
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('album.addPhotos.alerts.failed'));
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeAlbum(postId),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, postId, () => updatedPost);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('album.close.alerts.failed'));
    },
  });

  const commentMutation = useMutation({
    mutationFn: (content: string) => createComment(postId, { content }),
    onSuccess: () => {
      setCommentText('');
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('common.tryAgain'));
    },
  });

  if (!post || !album) return null;

  const isAuthor = post.authorId === user?.id;
  const coverUrl = album.coverPhotoUrl || album.collagePhotoUrls[0];
  const photoUris = photos.map((p) => getUploadUrl(p.url));

  function openPhotos(index: number) {
    navigation.navigate('ImageViewer', { urls: photoUris, initialIndex: index });
  }

  function confirmClose() {
    Alert.alert(t('album.close.confirmTitle'), t('album.close.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('album.close.confirmButton'), style: 'destructive', onPress: () => closeMutation.mutate() },
    ]);
  }

  function submitComment() {
    const trimmed = commentText.trim();
    if (trimmed && !commentMutation.isPending) commentMutation.mutate(trimmed);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="chevron-left" size={24} color={colors.textTitle} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {album.title}
        </Text>
        {isAuthor && !album.closed ? (
          <TouchableOpacity onPress={confirmClose} style={styles.headerButton}>
            <Text style={styles.headerAction}>{t('album.detail.closeCta')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerButton} />
        )}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {coverUrl ? (
            <MediaThumbnail url={getUploadUrl(coverUrl)} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <Text style={styles.coverPlaceholderEmoji}>🖼️</Text>
            </View>
          )}

          <View style={styles.section}>
            <View style={album.closed ? styles.closedBadge : styles.badge}>
              <Text style={album.closed ? styles.closedBadgeText : styles.badgeText}>
                {album.closed ? t('album.detail.closedBadge') : t('album.detail.badge')}
              </Text>
            </View>
            <Text style={styles.title}>{album.title}</Text>
            {!!post.content && <Text style={styles.description}>{post.content}</Text>}

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{album.photoCount}</Text>
                <Text style={styles.statLabel}>{t('album.detail.statsPhotos')}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{album.contributorCount}</Text>
                <Text style={styles.statLabel}>{t('album.detail.statsContributors')}</Text>
              </View>
            </View>

            {album.contributors.length > 0 && (
              <View style={styles.contributorRow}>
                <View style={styles.contributorStack}>
                  {album.contributors.slice(0, 6).map((contributor, i) => (
                    <View key={contributor.id} style={[styles.contributorFace, i > 0 && styles.contributorFaceOverlap]}>
                      <Avatar name={contributor.name} avatarUrl={contributor.avatarUrl} size={26} />
                    </View>
                  ))}
                </View>
                <Text style={styles.contributorText} numberOfLines={1}>
                  {t('album.detail.contributedBy', { names: album.contributors.map((c) => c.name).join(', ') })}
                </Text>
              </View>
            )}

            {!album.closed && (
              <TouchableOpacity style={styles.addButton} onPress={() => setContributeOpen(true)}>
                <Icon name="plus" size={18} color={colors.white} />
                <Text style={styles.addButtonText}>{t('album.detail.addPhotosCta')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {photos.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🖼️</Text>
              <Text style={styles.emptyTitle}>{t('album.detail.emptyTitle')}</Text>
              <Text style={styles.emptyDescription}>
                {album.closed ? t('album.detail.emptyClosedDescription') : t('album.detail.emptyDescription')}
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {photos.map((photo, index) => (
                <TouchableOpacity key={`${photo.comment.id}-${photo.url}`} style={styles.gridTile} onPress={() => openPhotos(index)}>
                  <MediaThumbnail url={getUploadUrl(photo.url)} style={styles.gridImage} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('album.detail.commentsSectionTitle')}</Text>
            {discussion.length === 0 ? (
              <Text style={styles.noComments}>{t('comments.empty')}</Text>
            ) : (
              discussion.map((comment: Comment) => (
                <View key={comment.id} style={styles.comment}>
                  <Avatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} size={32} />
                  <View style={styles.commentBody}>
                    <Text style={styles.commentAuthor}>
                      {comment.author.name} <Text style={styles.commentTime}>· {formatTime(comment.createdAt)}</Text>
                    </Text>
                    <Text style={styles.commentText}>{comment.content}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>

        <View style={styles.commentComposer}>
          <TextInput
            style={styles.commentInput}
            placeholder={t('comments.placeholder')}
            placeholderTextColor={colors.textMuted}
            value={commentText}
            onChangeText={setCommentText}
            maxLength={2000}
            multiline
          />
          <TouchableOpacity onPress={submitComment} disabled={!commentText.trim() || commentMutation.isPending}>
            <Text style={[styles.commentSend, (!commentText.trim() || commentMutation.isPending) && styles.commentSendDisabled]}>
              {t('comments.send')}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <AddAlbumPhotosModal
        visible={contributeOpen}
        albumTitle={album.title}
        submitting={contributeMutation.isPending}
        onCancel={() => setContributeOpen(false)}
        onSubmit={(data) => contributeMutation.mutate(data)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerButton: { minWidth: 64, paddingHorizontal: 8, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'Nunito_800ExtraBold', fontSize: 17, color: colors.textTitle },
  headerAction: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.primaryDark, textAlign: 'right' },
  scroll: { paddingBottom: 24 },
  cover: { width: '100%', height: 240 },
  coverPlaceholder: { backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  coverPlaceholderEmoji: { fontSize: 56 },
  section: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 11, color: colors.white },
  closedBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.primaryTint,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  closedBadgeText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 11, color: colors.primaryDark },
  title: { fontFamily: 'Nunito_900Black', fontSize: 24, color: colors.textTitle, letterSpacing: -0.4 },
  description: { fontFamily: 'Nunito_400Regular', fontSize: 15, color: colors.textBody, lineHeight: 22 },
  statsRow: { flexDirection: 'row', gap: 28, marginTop: 4 },
  stat: {},
  statNumber: { fontFamily: 'Nunito_900Black', fontSize: 20, color: colors.primaryDark },
  statLabel: { fontFamily: 'Nunito_700Bold', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  contributorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contributorStack: { flexDirection: 'row' },
  contributorFace: { borderRadius: 13, borderWidth: 2, borderColor: colors.surface },
  contributorFaceOverlap: { marginLeft: -8 },
  contributorText: { fontFamily: 'Nunito_600SemiBold', fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 6,
  },
  addButtonText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 15, color: colors.white },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, paddingHorizontal: 16 },
  gridTile: { width: '32.5%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.primaryTint },
  gridImage: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: 'Nunito_800ExtraBold', fontSize: 17, color: colors.textTitle, marginTop: 8 },
  emptyDescription: { fontFamily: 'Nunito_400Regular', fontSize: 14, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  sectionTitle: { fontFamily: 'Nunito_800ExtraBold', fontSize: 15, color: colors.textTitle },
  noComments: { fontFamily: 'Nunito_400Regular', fontSize: 14, color: colors.textMuted },
  comment: { flexDirection: 'row', gap: 10, marginTop: 12 },
  commentBody: { flex: 1 },
  commentAuthor: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.textTitle },
  commentTime: { fontFamily: 'Nunito_400Regular', fontSize: 12, color: colors.textMuted },
  commentText: { fontFamily: 'Nunito_400Regular', fontSize: 15, color: colors.textBody, marginTop: 2 },
  commentComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  commentInput: {
    flex: 1,
    fontFamily: 'Nunito_400Regular',
    fontSize: 15,
    color: colors.textTitle,
    maxHeight: 100,
    paddingVertical: 6,
  },
  commentSend: { fontFamily: 'Nunito_800ExtraBold', fontSize: 15, color: colors.primary },
  commentSendDisabled: { opacity: 0.4 },
});
