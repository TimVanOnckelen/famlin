import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { getUploadUrl } from '@/api/uploads';
import { colors } from '@/constants/colors';

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}

const AVATAR_COLORS = ['#006e94', '#318ea2', '#4b8b5a', '#005480', '#ed835e'];

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function Avatar({ name, avatarUrl, size = 44 }: AvatarProps) {
  // Retried without the variant if the thumbnail 404s — for avatar uploads
  // that predate server-side thumbnail generation.
  const [fellBack, setFellBack] = useState(false);
  const dimensionStyle = { width: size, height: size, borderRadius: size / 2 };

  if (avatarUrl) {
    const isExternal = avatarUrl.startsWith('http');
    // Avatars render at 22–48px, so the 400px thumbnail variant is plenty.
    const uri = isExternal
      ? avatarUrl
      : getUploadUrl(avatarUrl, fellBack ? undefined : 'thumbnail');
    return (
      <Image
        // cacheKey drops the rotating ?token= so a media-token refresh
        // doesn't invalidate every cached avatar.
        source={{ uri, cacheKey: uri.split('?')[0] }}
        style={[styles.image, dimensionStyle]}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={avatarUrl}
        onError={() => {
          if (!isExternal && !fellBack) setFellBack(true);
        }}
      />
    );
  }

  return (
    <View style={[styles.fallback, dimensionStyle, { backgroundColor: getAvatarColor(name) }]}>
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{getInitials(name || '?')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.border,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: 'Nunito_800ExtraBold',
    color: colors.white,
  },
});
