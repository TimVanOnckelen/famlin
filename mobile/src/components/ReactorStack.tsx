import React from 'react';
import { View, StyleSheet } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { colors } from '@/constants/colors';

interface Reactor {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

// "Show who reacted, not just a count" — small avatars overlapping with a
// 2px white border, most recent first (the server sends them newest-first).
export function ReactorStack({ reactors }: { reactors: Reactor[] }) {
  if (reactors.length === 0) return null;

  return (
    <View style={styles.row}>
      {reactors.slice(0, 3).map((reactor, index) => (
        <View key={reactor.id} style={[styles.face, index > 0 && styles.faceOverlap]}>
          <Avatar name={reactor.name} avatarUrl={reactor.avatarUrl} size={26} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  face: {
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: 15,
  },
  faceOverlap: {
    marginLeft: -8,
  },
});
