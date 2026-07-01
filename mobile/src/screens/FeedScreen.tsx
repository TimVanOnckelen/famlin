import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { colors } from '@/constants/colors';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { api } from '@/api/client';
import { Post, Group } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { getImmichAssetUrl } from '@/api/immich';
import { getUploadUrl } from '@/api/uploads';

export function FeedScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const response = await api.get<Group[]>('/groups');
      return response.data;
    },
  });

  const activeGroupId = selectedGroupId || groups?.[0]?.id;

  const { data: posts, isLoading, refetch } = useQuery({
    queryKey: ['posts', activeGroupId],
    queryFn: async () => {
      if (!activeGroupId) return [];
      const response = await api.get<Post[]>(`/posts?groupId=${activeGroupId}`);
      return response.data;
    },
    enabled: !!activeGroupId,
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Famlin</Text>
        <TouchableOpacity
          style={styles.notificationButton}
          onPress={() => navigation.navigate('Notifications')}
        >
          <Icon name="bell" size={20} color={colors.coral} />
        </TouchableOpacity>
      </View>

      {groups && groups.length > 1 && (
        <View style={styles.groupSwitcher}>
          <FlatList
            horizontal
            data={groups}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.groupChip,
                  item.id === activeGroupId && styles.groupChipActive,
                ]}
                onPress={() => setSelectedGroupId(item.id)}
              >
                <Text
                  style={[
                    styles.groupChipText,
                    item.id === activeGroupId && styles.groupChipTextActive,
                  ]}
                >
                  {item.name}
                </Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.groupList}
          />
        </View>
      )}

      <FlatList
        data={posts || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedList}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.coral} />
        }
        renderItem={({ item }) => <PostCard post={item} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>Nog geen berichten in deze groep.</Text>
              <Text style={styles.emptyStateSubtext}>Wees de eerste om iets te delen!</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function PostCard({ post }: { post: Post }) {
  const navigation = useNavigation<any>();
  const isMilestone = post.type === 'MILESTONE';

  const allPhotoUrls = [
    ...post.immichAssetIds.map((id) => getImmichAssetUrl(id, 'thumbnail')),
    ...post.uploadedAssetUrls.map((url) => getUploadUrl(url)),
  ];

  return (
    <TouchableOpacity
      style={[styles.postCard, isMilestone && styles.milestoneCard]}
      onPress={() => navigation.navigate('PostDetail', { postId: post.id })}
      activeOpacity={0.95}
    >
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
          {allPhotoUrls.slice(0, 3).map((url, index) => (
            <View
              key={url}
              style={[
                styles.photoWrapper,
                index === 0 && styles.photoWrapperFirst,
                allPhotoUrls.length === 1 && styles.photoWrapperSingle,
              ]}
            >
              <Image source={{ uri: url }} style={styles.photoImage} />
              {index === 2 && allPhotoUrls.length > 3 && (
                <View style={styles.photoOverlay}>
                  <Text style={styles.photoOverlayText}>+{allPhotoUrls.length - 3}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={[styles.actionsRow, isMilestone && styles.actionsRowMilestone]}>
        <TouchableOpacity style={styles.actionButton}>
          <Icon
            name="heart"
            size={18}
            color={post.likedByMe ? colors.coral : colors.warmGray}
          />
          <Text style={[styles.actionText, post.likedByMe && styles.actionTextActive]}>
            {post.likeCount}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Icon name="message-circle" size={18} color={colors.warmGray} />
          <Text style={styles.actionText}>{post.commentCount} reacties</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
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
    backgroundColor: colors.cream,
  },
  header: {
    backgroundColor: colors.white,
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 27,
    color: colors.coral,
    letterSpacing: -0.5,
  },
  notificationButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(217, 106, 94, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSwitcher: {
    backgroundColor: colors.white,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
  },
  groupList: {
    paddingHorizontal: 12,
    gap: 8,
  },
  groupChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  groupChipActive: {
    backgroundColor: colors.coral,
    borderColor: colors.coral,
  },
  groupChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.warmBlack,
  },
  groupChipTextActive: {
    color: colors.white,
  },
  feedList: {
    padding: 12,
    paddingBottom: 110,
    gap: 10,
  },
  postCard: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  milestoneCard: {
    backgroundColor: '#FFF5E6',
    borderWidth: 1.5,
    borderColor: colors.amber,
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
    letterSpacing: 0.3,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
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
    lineHeight: 24,
    marginBottom: 10,
  },
  milestoneTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 22,
    color: colors.warmBlack,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  photoGallery: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  photoWrapper: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  photoWrapperFirst: {
    flex: 2,
  },
  photoWrapperSingle: {
    flex: 1,
    aspectRatio: 16 / 9,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoOverlayText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 20,
    color: colors.white,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: colors.lightGray,
    paddingTop: 10,
  },
  actionsRowMilestone: {
    borderTopColor: 'rgba(242, 184, 92, 0.3)',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  actionText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.warmGray,
  },
  actionTextActive: {
    color: colors.coral,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.warmBlack,
  },
  emptyStateSubtext: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.warmGray,
    marginTop: 6,
  },
});
