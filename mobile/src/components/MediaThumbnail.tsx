import React, { useState } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { Icon } from '@/components/Icon';
import { isVideoUrl, getVideoPosterUrl } from '@/utils/media';

interface MediaThumbnailProps {
  url: string;
  // Retried once if `url` fails to load — for a thumbnail-variant URL (see
  // getUploadUrl in @famlin/api-client) that 404s because the upload
  // predates thumbnail generation, or the source format couldn't be resized
  // server-side.
  fallbackUrl?: string;
  style?: StyleProp<ViewStyle | ImageStyle>;
}

function PlayBadge() {
  return (
    <View style={styles.playBadgeWrapper} pointerEvents="none">
      <View style={styles.playBadge}>
        <Icon name="play" size={16} color="#fff" />
      </View>
    </View>
  );
}

// Last-resort video tile: mounts a real player (native decoder + surface)
// just to show a cover frame — expensive on low-end devices, so this only
// renders when no server-generated poster exists (local picker URIs, uploads
// predating poster generation).
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
      <PlayBadge />
    </View>
  );
}

export function MediaThumbnail({ url, fallbackUrl, style }: MediaThumbnailProps) {
  const [fellBack, setFellBack] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  if (isVideoUrl(url)) {
    const posterUrl = getVideoPosterUrl(url);
    if (!posterUrl || posterFailed) {
      return <VideoThumbnail url={url} style={style} />;
    }
    const posterCacheKey = posterUrl.split('?')[0];
    return (
      <View style={style as StyleProp<ViewStyle>}>
        <Image
          source={{ uri: posterUrl, cacheKey: posterCacheKey }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={100}
          recyclingKey={posterCacheKey}
          onError={() => setPosterFailed(true)}
        />
        <PlayBadge />
      </View>
    );
  }

  const effectiveUrl = fellBack && fallbackUrl ? fallbackUrl : url;
  // The full URL carries the rotating ?token= — pin the cache to the stable
  // part so a media-token refresh doesn't invalidate every cached image
  // (same trick as PhotosScreen's grid).
  const cacheKey = effectiveUrl.split('?')[0];

  return (
    <Image
      source={{ uri: effectiveUrl, cacheKey }}
      style={style as StyleProp<ImageStyle>}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={100}
      recyclingKey={cacheKey}
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
