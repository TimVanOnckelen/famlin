import React, { useState } from 'react';
import { Image, View, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { Icon } from '@/components/Icon';
import { isVideoUrl } from '@/utils/media';

interface MediaThumbnailProps {
  url: string;
  // Retried once if `url` fails to load — for a thumbnail-variant URL (see
  // getUploadUrl in @famlin/api-client) that 404s because the upload
  // predates thumbnail generation, or the source format couldn't be resized
  // server-side.
  fallbackUrl?: string;
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

export function MediaThumbnail({ url, fallbackUrl, style }: MediaThumbnailProps) {
  const [fellBack, setFellBack] = useState(false);

  if (isVideoUrl(url)) {
    return <VideoThumbnail url={url} style={style} />;
  }

  const effectiveUrl = fellBack && fallbackUrl ? fallbackUrl : url;

  return (
    <Image
      source={{ uri: effectiveUrl }}
      style={style as StyleProp<ImageStyle>}
      onError={() => {
        if (fallbackUrl && effectiveUrl !== fallbackUrl) setFellBack(true);
      }}
    />
  );
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
