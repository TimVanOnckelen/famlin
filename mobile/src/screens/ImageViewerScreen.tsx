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

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { isVideoUrl } from '@/utils/media';
import { Comment } from '@/types';
import { fetchComments, createComment, deleteComment } from '@famlin/api-client';
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

function ImagePage({
  url,
  width,
  accessibilityLabel,
}: {
  url: string;
  width: number;
  accessibilityLabel: string;
}) {
  const [loading, setLoading] = useState(true);

  return (
    <View style={[styles.page, { width }]}>
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
      {loading && (
        <View style={styles.pageLoader} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.white} />
        </View>
      )}
    </View>
  );
}

export function ImageViewerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { urls, initialIndex = 0, postId, assetUrls } = route.params;
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const currentAssetUrl: string | undefined = assetUrls?.[currentIndex];
  const canComment = !!postId && !!currentAssetUrl;

  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = translateY.interpolate({
    inputRange: [0, height],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) =>
        Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
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
            {canComment ? (
              <TouchableOpacity
                onPress={() => setCommentsVisible(true)}
                style={styles.closeButton}
                hitSlop={16}
                accessibilityLabel={t('imageViewer.commentsButton')}
              >
                <Icon name="message-circle" size={22} color={colors.white} />
              </TouchableOpacity>
            ) : (
              <View style={styles.placeholder} />
            )}
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
                  accessibilityLabel={t('imageViewer.photoAccessibilityLabel', { index: index + 1, total: urls.length })}
                />
              )
            )}
          </ScrollView>

          {canComment && (
            <PhotoCommentsSheet
              visible={commentsVisible}
              onClose={() => setCommentsVisible(false)}
              postId={postId}
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
  pageLoader: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
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
