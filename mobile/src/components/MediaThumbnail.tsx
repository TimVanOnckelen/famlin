import React from 'react';
import { Image, View, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { Icon } from '@/components/Icon';
import { isVideoUrl } from '@/utils/media';

interface MediaThumbnailProps {
  url: string;
  style?: StyleProp<ViewStyle | ImageStyle>;
}

function VideoThumbnail({ url, style }: MediaThumbnailProps) {
  const player = useVideoPlayer({ uri: url }, (p) => {
    p.muted = true;
  });

  return (
    <View style={style as StyleProp<ViewStyle>}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <View style={styles.playBadgeWrapper} pointerEvents="none">
        <View style={styles.playBadge}>
          <Icon name="play" size={16} color="#fff" />
        </View>
      </View>
    </View>
  );
}

export function MediaThumbnail({ url, style }: MediaThumbnailProps) {
  if (isVideoUrl(url)) {
    return <VideoThumbnail url={url} style={style} />;
  }

  return <Image source={{ uri: url }} style={style as StyleProp<ImageStyle>} />;
}

const styles = StyleSheet.create({
  playBadgeWrapper: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
