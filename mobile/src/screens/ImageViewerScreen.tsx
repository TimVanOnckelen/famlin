import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Text,
  Modal,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image } from 'expo-image';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { ReactionPicker } from '@/components/ReactionPicker';
import { isVideoUrl } from '@/utils/media';
import { Comment, Post, ReactionType } from '@/types';
import {
  fetchComments,
  createComment,
  deleteComment,
  fetchPost,
  reactToPost,
  toggleFavoritePost,
} from '@famlin/api-client';
import { REACTION_EMOJI } from '@/constants/reactions';
import { patchPostInCaches } from '@/utils/postCache';
import { formatRelativeDate } from '@/i18n/utils';
import { useAuthStore } from '@/stores/authStore';

function VideoPage({
  url,
  width,
  isActive,
  accessibilityLabel,
}: {
  url: string;
  width: number;
  isActive: boolean;
  accessibilityLabel: string;
}) {
  const player = useVideoPlayer({ uri: url }, (p) => {
    p.loop = true;
  });
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isActive && isFocused) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, isFocused, player]);

  return (
    <View style={[styles.page, { width }]}>
      <VideoView
        player={player}
        style={styles.image}
        contentFit="contain"
        nativeControls
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const MAX_ZOOM_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_WINDOW_MS = 300;

// Pinch-to-zoom / pan / double-tap image page built on core PanResponder +
// Animated (no gesture-handler/reanimated dependency). Interplay with the
// surrounding pager: at scale 1 single-finger drags are deliberately ceded
// to the horizontal ScrollView (onPanResponderTerminationRequest) so paging
// keeps working; once zoomed the parent disables paging and the swipe-down
// dismiss (via onZoomChange), so drags pan the photo instead.
function ImagePage({
  url,
  width,
  isActive,
  accessibilityLabel,
  onZoomChange,
}: {
  url: string;
  width: number;
  isActive: boolean;
  accessibilityLabel: string;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  // Live gesture bookkeeping — refs, not state, so the PanResponder callbacks
  // (created once) always see current values without re-renders per frame.
  const z = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    pinchBase: null as number | null,
    panStart: null as { dx: number; dy: number; tx: number; ty: number } | null,
    moved: false,
    lastTapAt: 0,
    pageHeight: 0,
  }).current;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  function clampPan(s: number, value: number, size: number) {
    const max = Math.max(0, (size * (s - 1)) / 2);
    return Math.min(max, Math.max(-max, value));
  }

  function apply(nextScale: number, nextTx: number, nextTy: number) {
    const wasZoomed = z.scale > 1;
    z.scale = nextScale;
    z.tx = clampPan(nextScale, nextTx, width);
    z.ty = clampPan(nextScale, nextTy, z.pageHeight || width);
    scale.setValue(z.scale);
    translateX.setValue(z.tx);
    translateY.setValue(z.ty);
    const isZoomed = z.scale > 1;
    if (isZoomed !== wasZoomed) onZoomChangeRef.current(isZoomed);
  }

  function animateTo(nextScale: number) {
    const wasZoomed = z.scale > 1;
    z.scale = nextScale;
    z.tx = clampPan(nextScale, z.tx, width);
    z.ty = clampPan(nextScale, z.ty, z.pageHeight || width);
    Animated.parallel([
      Animated.timing(scale, { toValue: z.scale, duration: 200, useNativeDriver: false }),
      Animated.timing(translateX, { toValue: z.tx, duration: 200, useNativeDriver: false }),
      Animated.timing(translateY, { toValue: z.ty, duration: 200, useNativeDriver: false }),
    ]).start();
    const isZoomed = z.scale > 1;
    if (isZoomed !== wasZoomed) onZoomChangeRef.current(isZoomed);
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) =>
        evt.nativeEvent.touches.length >= 2 ||
        (z.scale > 1 && (Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2)),
      // At scale 1, let the paging ScrollView steal single-finger drags.
      onPanResponderTerminationRequest: () => z.scale <= 1,
      onPanResponderGrant: () => {
        z.pinchBase = null;
        z.panStart = null;
        z.moved = false;
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          z.moved = true;
          z.panStart = null;
          const dist = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY
          );
          if (dist <= 0) return;
          // pinchBase = finger distance per unit of scale, captured at pinch
          // start, so scale tracks the fingers relative to where they began.
          if (z.pinchBase === null) z.pinchBase = dist / z.scale;
          const next = Math.min(MAX_ZOOM_SCALE, Math.max(1, dist / z.pinchBase));
          apply(next, z.tx, z.ty);
        } else if (z.scale > 1) {
          z.pinchBase = null;
          if (Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4) z.moved = true;
          if (!z.panStart) {
            z.panStart = { dx: gestureState.dx, dy: gestureState.dy, tx: z.tx, ty: z.ty };
          }
          apply(
            z.scale,
            z.panStart.tx + (gestureState.dx - z.panStart.dx),
            z.panStart.ty + (gestureState.dy - z.panStart.dy)
          );
        }
      },
      onPanResponderRelease: () => {
        z.pinchBase = null;
        z.panStart = null;
        if (!z.moved) {
          const now = Date.now();
          if (now - z.lastTapAt < DOUBLE_TAP_WINDOW_MS) {
            z.lastTapAt = 0;
            animateTo(z.scale > 1 ? 1 : DOUBLE_TAP_SCALE);
          } else {
            z.lastTapAt = now;
          }
        } else if (z.scale < 1.05) {
          // Pinched back to (almost) fit — snap clean so paging re-enables.
          animateTo(1);
        }
      },
      onPanResponderTerminate: () => {
        z.pinchBase = null;
        z.panStart = null;
      },
    })
  ).current;

  useEffect(() => {
    // Swiping away resets the zoom, so returning to this photo starts fitted.
    if (!isActive && z.scale > 1) {
      z.tx = 0;
      z.ty = 0;
      animateTo(1);
    }
  }, [isActive]);

  return (
    <View
      style={[styles.page, { width }]}
      onLayout={(e) => {
        z.pageHeight = e.nativeEvent.layout.height;
      }}
      {...responder.panHandlers}
    >
      <Animated.View style={[styles.zoomContainer, { transform: [{ translateX }, { translateY }, { scale }] }]}>
        <Image
          // cacheKey strips the rotating ?token= (see PhotosScreen) so a
          // token refresh doesn't invalidate already-downloaded previews.
          source={{ uri: url, cacheKey: url.split('?')[0] }}
          style={styles.image}
          contentFit="contain"
          transition={100}
          onLoadStart={() => setLoading(true)}
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
          accessible
          accessibilityLabel={accessibilityLabel}
        />
      </Animated.View>
      {loading && (
        <View style={styles.pageLoader} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.white} />
        </View>
      )}
    </View>
  );
}

// Per-photo metadata for viewers opened over mixed sources (the photos
// tab): entries line up with `urls` by index. Photos belonging to a post
// carry that post's id plus their raw asset path so the action bar and
// per-photo comments work; album assets carry neither — there is no
// backend object to like, favorite, or comment on.
interface ViewerItem {
  postId?: string;
  assetUrl?: string;
  // Absolute URL of the rendition worth saving to the device (the original,
  // not the preview shown in the pager). Falls back to the displayed URL.
  downloadUrl?: string;
}

function PhotoActionsBar({
  postId,
  canComment,
  downloadUrl,
  onOpenComments,
}: {
  postId?: string;
  canComment: boolean;
  downloadUrl: string;
  onOpenComments: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Album photos without a post still get the bar (download only).
  const { data: post } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => fetchPost(postId!),
    enabled: !!postId,
  });

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      // writeOnly: add-to-library is all we need — avoids the scarier
      // full-library read permission prompt on iOS.
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert(t('common.error'), t('imageViewer.downloadPermissionDenied'));
        return;
      }
      const cleanPath = downloadUrl.split('?')[0];
      const filename = cleanPath.substring(cleanPath.lastIndexOf('/') + 1) || 'photo.jpg';
      const destination = new File(Paths.cache, filename);
      if (destination.exists) destination.delete();
      const file = await File.downloadFileAsync(downloadUrl, destination);
      await MediaLibrary.saveToLibraryAsync(file.uri);
      file.delete();
      Alert.alert(t('imageViewer.downloadSuccess'));
    } catch {
      Alert.alert(t('common.error'), t('imageViewer.downloadError'));
    } finally {
      setDownloading(false);
    }
  }

  // Same optimistic patch PostCard applies, so the feed/detail caches stay
  // in sync with what the viewer shows.
  const likeMutation = useMutation({
    mutationFn: (type: ReactionType) => reactToPost(postId!, type),
    onMutate: async (type) => {
      if (!post) return;
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      await queryClient.cancelQueries({ queryKey: ['post', postId] });

      const nextReaction = post.myReaction === type ? null : type;
      const patch = (p: Post) => {
        const reactions = { ...p.reactions };
        if (p.myReaction) reactions[p.myReaction] = Math.max(0, (reactions[p.myReaction] || 0) - 1);
        if (nextReaction) reactions[nextReaction] = (reactions[nextReaction] || 0) + 1;
        return {
          ...p,
          myReaction: nextReaction,
          reactions,
          likeCount: Object.values(reactions).reduce((sum, n) => sum + (n || 0), 0),
          likedByMe: nextReaction !== null,
        };
      };

      patchPostInCaches(queryClient, postId!, patch);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: () => toggleFavoritePost(postId!),
    onMutate: async () => {
      if (!post) return;
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      await queryClient.cancelQueries({ queryKey: ['post', postId] });

      const nextFavorited = !post.favoritedByMe;
      patchPostInCaches(queryClient, postId!, (p: Post) => ({ ...p, favoritedByMe: nextFavorited }));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  return (
    <>
      <View style={styles.actionBar}>
        {post && (
          <>
            <TouchableOpacity
              style={styles.actionBarButton}
              onPress={() => likeMutation.mutate(post.myReaction ?? 'LOVE')}
              onLongPress={() => setReactionPickerOpen(true)}
              disabled={likeMutation.isPending}
              hitSlop={8}
              accessibilityLabel={t('imageViewer.likeButton')}
              accessibilityState={{ selected: !!post.myReaction }}
            >
              {post.myReaction ? (
                <Text style={styles.reactionEmoji}>{REACTION_EMOJI[post.myReaction]}</Text>
              ) : (
                <Icon name="heart" size={22} color={colors.white} />
              )}
              {post.likeCount > 0 && <Text style={styles.actionBarCount}>{post.likeCount}</Text>}
            </TouchableOpacity>

            {canComment && (
              <TouchableOpacity
                style={styles.actionBarButton}
                onPress={onOpenComments}
                hitSlop={8}
                accessibilityLabel={t('imageViewer.commentsButton')}
              >
                <Icon name="message-circle" size={22} color={colors.white} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.actionBarButton}
              onPress={() => favoriteMutation.mutate()}
              disabled={favoriteMutation.isPending}
              hitSlop={8}
              accessibilityLabel={t('imageViewer.favoriteButton')}
              accessibilityState={{ selected: !!post.favoritedByMe }}
            >
              <Icon
                name="bookmark"
                size={22}
                color={post.favoritedByMe ? colors.primary : colors.white}
              />
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={styles.actionBarButton}
          onPress={handleDownload}
          disabled={downloading}
          hitSlop={8}
          accessibilityLabel={t('imageViewer.downloadButton')}
        >
          {downloading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Icon name="download" size={22} color={colors.white} />
          )}
        </TouchableOpacity>
      </View>

      <ReactionPicker
        visible={reactionPickerOpen}
        onSelect={(type) => {
          setReactionPickerOpen(false);
          likeMutation.mutate(type);
        }}
        onClose={() => setReactionPickerOpen(false)}
      />
    </>
  );
}

export function ImageViewerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { urls, initialIndex = 0, postId, assetUrls, items } = route.params;
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // Post-context callers (PostCard, PostDetail) pass one postId + parallel
  // assetUrls; the photos tab passes per-index `items` instead, since its
  // grid mixes photos from different posts and albums.
  const currentItem: ViewerItem | undefined = items?.[currentIndex];
  const currentPostId: string | undefined = items ? currentItem?.postId : postId;
  const currentAssetUrl: string | undefined = items ? currentItem?.assetUrl : assetUrls?.[currentIndex];
  const canComment = !!currentPostId && !!currentAssetUrl;
  const currentDownloadUrl: string = currentItem?.downloadUrl ?? urls[currentIndex];

  // While a photo is zoomed, paging and the swipe-down dismiss are disabled
  // so drags pan the photo instead. State drives scrollEnabled; the ref is
  // read inside the PanResponder callbacks (created once).
  const [isZoomed, setIsZoomed] = useState(false);
  const isZoomedRef = useRef(false);
  function handleZoomChange(zoomed: boolean) {
    isZoomedRef.current = zoomed;
    setIsZoomed(zoomed);
  }

  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = translateY.interpolate({
    inputRange: [0, height],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) =>
        // Single-finger only, and never while zoomed: two-finger pinches and
        // pans of a zoomed photo must reach the ImagePage underneath.
        gestureState.numberActiveTouches === 1 &&
        !isZoomedRef.current &&
        Math.abs(gestureState.dy) > 10 &&
        Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: height,
            duration: 200,
            useNativeDriver: true,
          }).start(() => navigation.goBack());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    ScreenOrientation.unlockAsync();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  useEffect(() => {
    // Keep the current page aligned when the width changes on rotation.
    scrollViewRef.current?.scrollTo({ x: currentIndex * width, animated: false });
  }, [width]);

  useEffect(() => {
    // Swiping to a different photo means the sheet no longer applies to it.
    setCommentsVisible(false);
  }, [currentIndex]);

  function handleScroll(event: any) {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    setCurrentIndex(index);
  }

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
      <Animated.View
        style={[styles.animatedContent, { transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton} hitSlop={16}>
              <Icon name="x" size={24} color={colors.white} />
            </TouchableOpacity>
            {urls.length > 1 && (
              <Text style={styles.counter}>
                {currentIndex + 1} / {urls.length}
              </Text>
            )}
            <View style={styles.placeholder} />
          </View>

          <ScrollView
            ref={scrollViewRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: initialIndex * width, y: 0 }}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={handleScroll}
            scrollEnabled={!isZoomed}
            style={styles.scrollView}
          >
            {urls.map((url: string, index: number) =>
              isVideoUrl(url) ? (
                <VideoPage
                  key={`${url}-${index}`}
                  url={url}
                  width={width}
                  isActive={index === currentIndex}
                  accessibilityLabel={t('imageViewer.videoAccessibilityLabel', { index: index + 1, total: urls.length })}
                />
              ) : (
                <ImagePage
                  key={`${url}-${index}`}
                  url={url}
                  width={width}
                  isActive={index === currentIndex}
                  onZoomChange={handleZoomChange}
                  accessibilityLabel={t('imageViewer.photoAccessibilityLabel', { index: index + 1, total: urls.length })}
                />
              )
            )}
          </ScrollView>

          {/* Remount per post so the bar never briefly shows the previous
              post's counts while swiping across posts in the photos tab.
              Without a post it still renders (download-only). */}
          <PhotoActionsBar
            key={currentPostId ?? 'no-post'}
            postId={currentPostId}
            canComment={canComment}
            downloadUrl={currentDownloadUrl}
            onOpenComments={() => setCommentsVisible(true)}
          />

          {canComment && (
            <PhotoCommentsSheet
              visible={commentsVisible}
              onClose={() => setCommentsVisible(false)}
              postId={currentPostId!}
              assetUrl={currentAssetUrl!}
            />
          )}
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

function PhotoCommentsSheet({
  visible,
  onClose,
  postId,
  assetUrl,
}: {
  visible: boolean;
  onClose: () => void;
  postId: string;
  assetUrl: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [commentText, setCommentText] = useState('');

  const { data: comments, isLoading } = useQuery({
    queryKey: ['comments', postId, assetUrl],
    queryFn: () => fetchComments(postId, assetUrl),
    enabled: visible,
  });

  function invalidateComments() {
    queryClient.invalidateQueries({ queryKey: ['comments', postId] });
    queryClient.invalidateQueries({ queryKey: ['post', postId] });
    queryClient.invalidateQueries({ queryKey: ['posts'] });
  }

  const commentMutation = useMutation({
    mutationFn: (content: string) => createComment(postId, { content, assetUrl }),
    onSuccess: () => {
      setCommentText('');
      invalidateComments();
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('common.tryAgain'));
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: () => invalidateComments(),
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('postDetail.alerts.deleteFailed'));
    },
  });

  function confirmDelete(commentId: string) {
    Alert.alert(t('postDetail.deleteCommentConfirmTitle'), t('postDetail.deleteCommentConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteCommentMutation.mutate(commentId) },
    ]);
  }

  function submitComment() {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    commentMutation.mutate(trimmed);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheetStyles.overlay}>
        <TouchableOpacity style={sheetStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={sheetStyles.sheet}
        >
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.headerRow}>
            <Text style={sheetStyles.title}>{t('imageViewer.commentsTitle')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Icon name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={comments || []}
            keyExtractor={(item) => item.id}
            style={sheetStyles.list}
            contentContainerStyle={sheetStyles.listContent}
            ListEmptyComponent={
              isLoading ? null : (
                <Text style={sheetStyles.emptyText}>{t('imageViewer.noComments')}</Text>
              )
            }
            renderItem={({ item }) => (
              <View style={sheetStyles.commentItem}>
                <Avatar name={item.author.name} avatarUrl={item.author.avatarUrl} size={32} />
                <View style={sheetStyles.commentBody}>
                  <View style={sheetStyles.commentBubble}>
                    <Text style={sheetStyles.commentAuthor}>{item.author.name}</Text>
                    <Text style={sheetStyles.commentText}>{item.content}</Text>
                  </View>
                  <View style={sheetStyles.commentMetaRow}>
                    <Text style={sheetStyles.commentTime}>{formatRelativeDate(item.createdAt)}</Text>
                    {item.authorId === user?.id && (
                      <TouchableOpacity onPress={() => confirmDelete(item.id)}>
                        <Text style={sheetStyles.commentDelete}>{t('common.delete')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            )}
          />

          <View style={sheetStyles.inputRow}>
            <Avatar name={user?.name || '?'} avatarUrl={user?.avatarUrl} size={32} />
            <TextInput
              style={sheetStyles.input}
              placeholder={t('postDetail.commentPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={commentText}
              onChangeText={setCommentText}
              multiline
            />
            <TouchableOpacity
              style={[sheetStyles.sendButton, !commentText.trim() && sheetStyles.sendButtonDisabled]}
              onPress={submitComment}
              disabled={!commentText.trim() || commentMutation.isPending}
            >
              <Icon name="send" size={16} color={colors.white} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
  animatedContent: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 24,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.white,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 100,
    overflow: 'hidden',
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  page: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  zoomContainer: {
    width: '100%',
    height: '100%',
  },
  pageLoader: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  actionBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 44,
    justifyContent: 'center',
  },
  actionBarCount: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.white,
  },
  reactionEmoji: {
    fontSize: 20,
  },
});

const sheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    color: colors.textTitle,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    padding: 16,
    gap: 14,
  },
  emptyText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },
  commentItem: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  commentBody: {
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
    fontSize: 13,
    color: colors.textTitle,
    marginBottom: 3,
  },
  commentText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textTitle,
    lineHeight: 20,
  },
  commentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
    marginLeft: 4,
  },
  commentTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: colors.textMuted,
  },
  commentDelete: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: colors.textMuted,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 90,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
});
