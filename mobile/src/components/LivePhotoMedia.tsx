import { useEffect, useRef, useState } from 'react';
import { AppState, Dimensions, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { getUploadUrl } from '@famlin/api-client';
import { Icon } from './Icon';

function Motion({ url, paused }: { url: string; paused: boolean }) {
  const player = useVideoPlayer({ uri: getUploadUrl(url) }, (video) => { video.loop = true; video.muted = true; });
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

export function LivePhotoMedia({ imageUrl, videoUrl, style }: { imageUrl: string; videoUrl: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const view = useRef<View>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const focused = useIsFocused();
  useEffect(() => {
    const measure = () => {
      if (!focused || AppState.currentState !== 'active') { setVisible(false); return; }
      view.current?.measureInWindow((_x, y, width, height) => setVisible(width > 0 && height > 0 && y + height > 0 && y < Dimensions.get('window').height));
    };
    measure();
    const interval = setInterval(measure, 500);
    const subscription = AppState.addEventListener('change', measure);
    return () => { clearInterval(interval); subscription.remove(); };
  }, [focused]);
  return <View ref={view} style={style} collapsable={false}>
    <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
    {visible && <Motion url={videoUrl} paused={paused} />}
    <TouchableOpacity style={styles.badge} accessibilityRole="button"
      accessibilityLabel={t(paused ? 'media.playLivePhoto' : 'media.pauseLivePhoto')}
      onPress={(event) => { event.stopPropagation(); setPaused((value) => !value); }}>
      <Icon name="disc" size={18} color="white" /><Text style={styles.label}>LIVE</Text>
    </TouchableOpacity>
  </View>;
}
const styles = StyleSheet.create({
  badge: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,34,42,0.72)', padding: 6, borderRadius: 18 },
  label: { color: 'white', fontSize: 10, fontWeight: '700' },
});
