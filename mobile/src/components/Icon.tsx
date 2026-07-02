import React from 'react';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';

interface IconProps {
  name: keyof typeof Feather.glyphMap;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 24, color = colors.textTitle }: IconProps) {
  return <Feather name={name} size={size} color={color} />;
}
