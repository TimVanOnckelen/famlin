import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
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
  const dimensionStyle = { width: size, height: size, borderRadius: size / 2 };

  if (avatarUrl) {
    const uri = avatarUrl.startsWith('http') ? avatarUrl : getUploadUrl(avatarUrl);
    return <Image source={{ uri }} style={[styles.image, dimensionStyle]} />;
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
