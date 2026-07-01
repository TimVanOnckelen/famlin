import React, { useState } from 'react';
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
  Image,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { api } from '@/api/client';
import { Post, Comment } from '@/types';
import { getImmichAssetUrl } from '@/api/immich';
import { getUploadUrl } from '@/api/uploads';

export function PostDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { postId } = route.params;
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState('');

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

  const commentMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await api.post(`/posts/${postId}/comments`, { content });
      return response.data;
    },
    onSuccess: () => {
      setCommentText('');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  if (!post) return null;

  const isMilestone = post.type === 'MILESTONE';

  const allPhotoUrls = [
    ...post.immichAssetIds.map((id: string) => getImmichAssetUrl(id, 'thumbnail')),
    ...post.uploadedAssetUrls.map((url: string) => getUploadUrl(url)),
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={18} color={colors.coral} />
          <Text style={styles.backButtonText}>Terug</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bericht</Text>
        <View style={styles.headerRight} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={comments || []}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={[styles.postContainer, isMilestone && styles.milestoneContainer]}>
              {isMilestone && (
                <View style={styles.milestoneBadge}>
                  <Text style={styles.milestoneBadgeText}>🎂 MIJLPAAL</Text>
                </View>
              )}

              <View style={styles.authorRow}>
                <View style={[styles.avatar, { backgroundColor: getAvatarColor(post.author.name) }]}>
                  <Text style={styles.avatarText}>{getInitials(post.author.name)}</Text>
                </View>
                <View>
                  <Text style={styles.authorName}>{post.author.name}</Text>
                  <Text style={styles.postTime}>{formatDate(post.createdAt)}</Text>
                </View>
              </View>

              {isMilestone ? (
                <Text style={styles.milestoneTitle}>{post.content}</Text>
              ) : (
                <Text style={styles.postContent}>{post.content}</Text>
              )}

              {allPhotoUrls.length > 0 && (
                <View style={styles.photoGallery}>
                  {allPhotoUrls.map((url: string) => (
                    <View
                      key={url}
                      style={[
                        styles.photoWrapper,
                        allPhotoUrls.length === 1 && styles.photoWrapperSingle,
                      ]}
                    >
                      <Image source={{ uri: url }} style={styles.photoImage} />
                    </View>
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
                color={post.likedByMe ? colors.coral : colors.warmGray}
              />
              <Text style={[styles.likeButtonText, post.likedByMe && styles.likeButtonTextActive]}>
                {post.likeCount}
              </Text>
                </TouchableOpacity>
                <Text style={styles.commentCount}>{post.commentCount} reacties</Text>
              </View>

              <Text style={styles.commentsHeader}>Reacties · {comments?.length || 0}</Text>
            </View>
          }
          renderItem={({ item }) => <CommentItem comment={item} />}
          contentContainerStyle={styles.commentsList}
        />

        <View style={styles.inputContainer}>
          <View style={styles.inputAvatar}>
            <Text style={styles.inputAvatarText}>?</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Schrijf een reactie..."
            placeholderTextColor={colors.warmGray}
            value={commentText}
            onChangeText={setCommentText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, !commentText.trim() && styles.sendButtonDisabled]}
            onPress={() => commentText.trim() && commentMutation.mutate(commentText.trim())}
            disabled={!commentText.trim()}
          >
            <Icon name="send" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <View style={styles.commentItem}>
      <View style={[styles.commentAvatar, { backgroundColor: getAvatarColor(comment.author.name) }]}>
        <Text style={styles.commentAvatarText}>{getInitials(comment.author.name)}</Text>
      </View>
      <View style={styles.commentContent}>
        <View style={styles.commentBubble}>
          <Text style={styles.commentAuthor}>{comment.author.name}</Text>
          <Text style={styles.commentText}>{comment.content}</Text>
        </View>
        <Text style={styles.commentTime}>{formatDate(comment.createdAt)}</Text>
      </View>
    </View>
  );
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarColor(name: string) {
  const colors_list = ['#E07A6B', '#F2B85C', '#6BB5E0', '#9FD96A', '#D96AB5'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors_list[Math.abs(hash) % colors_list.length];
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Zojuist';
  if (diffHours < 24) return `${diffHours} uur geleden`;
  if (diffDays === 1) return 'Gisteren';
  return date.toLocaleDateString('nl-NL', { weekday: 'long' });
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
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
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
    color: colors.coral,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.warmBlack,
  },
  headerRight: {
    width: 70,
  },
  postContainer: {
    padding: 14,
    backgroundColor: colors.white,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.lightGray,
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
    backgroundColor: colors.amber,
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
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 18,
    color: colors.white,
  },
  authorName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.warmBlack,
  },
  postTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
    marginTop: 2,
  },
  postContent: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.warmBlack,
    lineHeight: 26,
    marginBottom: 12,
  },
  milestoneTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 23,
    color: colors.warmBlack,
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
    borderTopColor: colors.lightGray,
    paddingTop: 10,
  },
  actionsRowMilestone: {
    borderTopColor: 'rgba(242, 184, 92, 0.3)',
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.cream,
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
    color: colors.warmGray,
  },
  likeButtonTextActive: {
    color: colors.coral,
  },
  commentCount: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.warmGray,
  },
  commentsHeader: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: colors.warmGray,
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
  commentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 14,
    color: colors.white,
  },
  commentContent: {
    flex: 1,
  },
  commentBubble: {
    backgroundColor: colors.cream,
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
    color: colors.warmBlack,
    marginBottom: 3,
  },
  commentText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.warmBlack,
    lineHeight: 22,
  },
  commentTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.warmGray,
    marginTop: 4,
    marginLeft: 4,
  },
  inputContainer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.lightGray,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingBottom: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputAvatarText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 14,
    color: colors.warmGray,
  },
  input: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.warmBlack,
    borderWidth: 1,
    borderColor: colors.lightGray,
    maxHeight: 100,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.lightGray,
  },
  sendButtonText: {
    color: colors.white,
    fontSize: 18,
    marginLeft: 2,
  },
});
