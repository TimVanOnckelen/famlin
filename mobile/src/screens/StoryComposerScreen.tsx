import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  PanResponder,
  ScrollView,
  StatusBar,
  LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { Group, createStory, fetchGroups, fetchMyCircles } from '@famlin/api-client';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { uploadMedia } from '@/api/uploads';
import {
  ComposerState,
  EMPTY_COMPOSER,
  OverlayItem,
  addOverlay,
  extendStroke,
  moveOverlay,
  removeOverlay,
  startStroke,
  storyAudienceBody,
  strokeToPath,
  undo,
} from '@/utils/stories';

const PALETTE = ['#FFFFFF', '#0F222A', colors.primary, colors.accent, colors.milestone, '#4B8B5A', '#E05A4C'];
// Stickers are user content, like reactions, so native emoji are the right
// rendering here (see the note in components/Icon.tsx).
const STICKERS = ['❤️', '😂', '🎉', '🥳', '😍', '👶', '🎂', '🌞', '🏖️', '⚽', '🐶', '🌸', '✨', '👍', '🙏', '🏡'];
const STROKE_WIDTH = 6;
// Every story is flattened to a 1080x1920 JPEG, the size a phone screen
// shows it at, so overlays land where the author put them on every device.
const OUTPUT = { width: 1080, height: 1920 };

type Mode = 'move' | 'draw';

// Compose a story: take or pick a photo, decorate it with text, emoji
// stickers and freehand drawing, pick who sees it, share. The overlays are
// flattened into the photo on the device (react-native-view-shot), so the
// server and the web viewer only ever get a plain JPEG.
export function StoryComposerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const defaultGroupIds: string[] = route.params?.defaultGroupIds ?? [];

  const canvasRef = useRef<View>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>('move');
  const [color, setColor] = useState(PALETTE[0]);
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
  const storyGroups = useMemo(() => (groups ?? []).filter((g: Group) => g.storiesEnabled), [groups]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(null);
  // Default audience: the feed's family filter if it points at story-enabled
  // families, otherwise the first family that has stories on.
  const effectiveGroupIds =
    selectedGroupIds ??
    (() => {
      const fromFilter = defaultGroupIds.filter((id) => storyGroups.some((g) => g.id === id));
      return fromFilter.length > 0 ? fromFilter : storyGroups.slice(0, 1).map((g) => g.id);
    })();
  const [circleId, setCircleId] = useState<string | null>(null);

  const singleGroupId = effectiveGroupIds.length === 1 ? effectiveGroupIds[0] : null;
  const { data: circles } = useQuery({
    queryKey: ['circles', singleGroupId],
    queryFn: () => fetchMyCircles(singleGroupId!),
    enabled: !!singleGroupId,
  });

  function toggleGroup(id: string) {
    const next = effectiveGroupIds.includes(id)
      ? effectiveGroupIds.filter((g) => g !== id)
      : [...effectiveGroupIds, id];
    setSelectedGroupIds(next);
    // A circle belongs to one family and can't be combined with several.
    setCircleId(null);
  }

  async function pick(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert(t('stories.permissionDenied'));
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setComposer(EMPTY_COMPOSER);
    }
  }

  // Freehand drawing — only active in draw mode, so dragging text/stickers
  // doesn't also scribble.
  const drawResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setComposer((s) => startStroke(s, color, STROKE_WIDTH, [locationX, locationY]));
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setComposer((s) => extendStroke(s, [locationX, locationY]));
        },
      }),
    [color]
  );

  function onCanvasLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setCanvas({ width, height });
  }

  async function share() {
    const audience = storyAudienceBody(effectiveGroupIds, circleId);
    if (!photoUri || !audience) return;
    setSharing(true);
    try {
      const uri = await captureRef(canvasRef, { format: 'jpg', quality: 0.9, result: 'tmpfile', ...OUTPUT });
      const [imageUrl] = await uploadMedia([{ uri, name: 'story.jpg', type: 'image/jpeg' }]);
      await createStory({ imageUrl, ...audience });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      navigation.goBack();
    } catch (err: any) {
      Alert.alert(t('stories.shareFailed'), err?.response?.data?.error ?? undefined);
    } finally {
      setSharing(false);
    }
  }

  if (!photoUri) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton} accessibilityLabel={t('common.close')}>
            <Icon name="x" size={26} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('stories.newStory')}</Text>
          <View style={styles.iconButton} />
        </View>
        <View style={styles.pickArea}>
          {storyGroups.length === 0 && groups !== undefined ? (
            <Text style={styles.hint}>{t('stories.noStoryGroups')}</Text>
          ) : (
            <>
              <TouchableOpacity style={styles.pickButton} onPress={() => pick('camera')}>
                <Icon name="camera" size={28} color={colors.white} />
                <Text style={styles.pickText}>{t('stories.takePhoto')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickButton} onPress={() => pick('library')}>
                <Icon name="image" size={28} color={colors.white} />
                <Text style={styles.pickText}>{t('stories.chooseFromLibrary')}</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>{t('stories.expiresHint')}</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => setPhotoUri(null)} style={styles.iconButton} accessibilityLabel={t('stories.back')}>
          <Icon name="chevron-left" size={26} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.tools}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => {
              setMode('move');
              setTextDraft('');
            }}
            accessibilityLabel={t('stories.addText')}
          >
            <Icon name="type" size={22} color={colors.white} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => {
              setMode('move');
              setStickersOpen(true);
            }}
            accessibilityLabel={t('stories.addSticker')}
          >
            <Icon name="smile" size={22} color={colors.white} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, mode === 'draw' && styles.toolActive]}
            onPress={() => setMode(mode === 'draw' ? 'move' : 'draw')}
            accessibilityLabel={t('stories.draw')}
            accessibilityState={{ selected: mode === 'draw' }}
          >
            <Icon name="edit-2" size={22} color={colors.white} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setComposer(undo)}
            disabled={composer.history.length === 0}
            accessibilityLabel={t('stories.undo')}
          >
            <Icon name="rotate-ccw" size={22} color={composer.history.length ? colors.white : 'rgba(255,255,255,0.35)'} />
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'draw' && (
        <View style={styles.palette}>
          {PALETTE.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
              onPress={() => setColor(c)}
              accessibilityLabel={c}
            />
          ))}
        </View>
      )}

      <View style={styles.canvasWrap}>
        <View ref={canvasRef} collapsable={false} style={styles.canvas} onLayout={onCanvasLayout}>
          <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {composer.strokes.map((stroke) => (
              <Path
                key={stroke.id}
                d={strokeToPath(stroke.points)}
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </Svg>
          {mode === 'draw' && <View style={StyleSheet.absoluteFill} {...drawResponder.panHandlers} />}
          {composer.items.map((item) => (
            <DraggableOverlay
              key={item.id}
              item={item}
              canvas={canvas}
              disabled={mode === 'draw'}
              onMove={(dx, dy) => setComposer((s) => moveOverlay(s, item.id, dx, dy, canvas))}
              onRemove={() =>
                Alert.alert(t('stories.removeOverlay'), undefined, [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('stories.remove'), style: 'destructive', onPress: () => setComposer((s) => removeOverlay(s, item.id)) },
                ])
              }
            />
          ))}
        </View>
      </View>

      <View style={styles.bottom}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {storyGroups.map((g) => {
            const active = effectiveGroupIds.includes(g.id);
            return (
              <TouchableOpacity
                key={g.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => toggleGroup(g.id)}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{g.name}</Text>
              </TouchableOpacity>
            );
          })}
          {!!singleGroupId &&
            (circles ?? []).map((c) => {
              const active = circleId === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, styles.circleChip, active && styles.circleChipActive]}
                  onPress={() => setCircleId(active ? null : c.id)}
                  accessibilityState={{ selected: active }}
                >
                  <Icon name="users" size={13} color={active ? colors.white : colors.circleDark} />
                  <Text style={[styles.chipText, { color: active ? colors.white : colors.circleDark }]}>{c.name}</Text>
                </TouchableOpacity>
              );
            })}
        </ScrollView>
        <TouchableOpacity
          style={[styles.shareButton, (sharing || effectiveGroupIds.length === 0) && styles.shareDisabled]}
          onPress={share}
          disabled={sharing || effectiveGroupIds.length === 0}
        >
          {sharing ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Text style={styles.shareText}>{t('stories.share')}</Text>
              <Icon name="send" size={18} color={colors.white} />
            </>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={textDraft !== null} transparent animationType="fade" onRequestClose={() => setTextDraft(null)}>
        <View style={styles.textModal}>
          <TextInput
            style={[styles.textInput, { color }]}
            value={textDraft ?? ''}
            onChangeText={setTextDraft}
            autoFocus
            multiline
            maxLength={120}
            placeholder={t('stories.textPlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.6)"
          />
          <View style={styles.palette}>
            {PALETTE.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
                onPress={() => setColor(c)}
                accessibilityLabel={c}
              />
            ))}
          </View>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => {
              setComposer((s) => addOverlay(s, 'text', textDraft ?? '', color));
              setTextDraft(null);
            }}
          >
            <Text style={styles.shareText}>{t('stories.done')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={stickersOpen} transparent animationType="slide" onRequestClose={() => setStickersOpen(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} onPress={() => setStickersOpen(false)} />
        <View style={styles.stickerSheet}>
          {STICKERS.map((sticker) => (
            <TouchableOpacity
              key={sticker}
              style={styles.stickerOption}
              onPress={() => {
                setComposer((s) => addOverlay(s, 'sticker', sticker, color));
                setStickersOpen(false);
              }}
            >
              <Text style={styles.stickerOptionText}>{sticker}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// A text or sticker overlay the author can drag around, and long-press to
// remove. Reports incremental pixel deltas; the composer model turns them
// into canvas fractions.
function DraggableOverlay({
  item,
  canvas,
  disabled,
  onMove,
  onRemove,
}: {
  item: OverlayItem;
  canvas: { width: number; height: number };
  disabled: boolean;
  onMove: (dx: number, dy: number) => void;
  onRemove: () => void;
}) {
  const last = useRef({ dx: 0, dy: 0 });
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only once it actually moves, so a plain
        // long-press still reaches the TouchableOpacity below (remove).
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          last.current = { dx: 0, dy: 0 };
        },
        onPanResponderMove: (_e, g) => {
          moveRef.current(g.dx - last.current.dx, g.dy - last.current.dy);
          last.current = { dx: g.dx, dy: g.dy };
        },
      }),
    []
  );
  const [size, setSize] = useState({ width: 0, height: 0 });

  return (
    <View
      {...(disabled ? {} : responder.panHandlers)}
      pointerEvents={disabled ? 'none' : 'auto'}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      style={[
        styles.overlayItem,
        { left: item.x * canvas.width - size.width / 2, top: item.y * canvas.height - size.height / 2 },
      ]}
    >
      <TouchableOpacity onLongPress={onRemove} activeOpacity={1} disabled={disabled}>
        {item.kind === 'sticker' ? (
          <Text style={styles.sticker}>{item.value}</Text>
        ) : (
          <Text style={[styles.overlayText, { color: item.color }]}>{item.value}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  title: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 17,
    color: colors.white,
  },
  tools: {
    flexDirection: 'row',
    gap: 4,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pickArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  pickButton: {
    width: '100%',
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 18,
  },
  pickText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.white,
  },
  hint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    maxWidth: 320,
  },
  palette: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  swatchActive: {
    borderColor: colors.white,
    transform: [{ scale: 1.15 }],
  },
  canvasWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    height: '100%',
    aspectRatio: 9 / 16,
    maxWidth: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  overlayItem: {
    position: 'absolute',
  },
  overlayText: {
    fontFamily: 'Nunito_900Black',
    fontSize: 30,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    maxWidth: 280,
  },
  sticker: {
    fontSize: 64,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chips: {
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  circleChip: {
    backgroundColor: colors.circleTint,
  },
  circleChipActive: {
    backgroundColor: colors.circle,
  },
  chipText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.white,
  },
  chipTextActive: {
    color: colors.white,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 100,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minWidth: 110,
  },
  shareDisabled: {
    opacity: 0.5,
  },
  shareText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.white,
  },
  textModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  textInput: {
    width: '100%',
    fontFamily: 'Nunito_900Black',
    fontSize: 30,
    textAlign: 'center',
  },
  sheetBackdrop: {
    flex: 1,
  },
  stickerSheet: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1b1b1b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: 36,
  },
  stickerOption: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickerOptionText: {
    fontSize: 38,
  },
});
