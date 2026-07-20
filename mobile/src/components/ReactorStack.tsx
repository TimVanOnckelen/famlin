import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { colors } from '@/constants/colors';

interface Reactor {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

// "Show who reacted, not just a count" — small avatars overlapping with a
// 2px white border, most recent first (the server sends them newest-first).
// Tapping opens the full "who reacted with what" list (see ReactionsModal)
// when a handler is provided.
export function ReactorStack({ reactors, onPress }: { reactors: Reactor[]; onPress?: () => void }) {
  if (reactors.length === 0) return null;

  const stack = (
    <View style={styles.row}>
      {reactors.slice(0, 3).map((reactor, index) => (
        <View key={reactor.id} style={[styles.face, index > 0 && styles.faceOverlap]}>
          <Avatar name={reactor.name} avatarUrl={reactor.avatarUrl} size={26} />
        </View>
      ))}
    </View>
  );

  if (!onPress) return stack;

  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      {stack}
    </TouchableOpacity>
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
