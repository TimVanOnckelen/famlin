import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import { colors } from '@/constants/colors';
import { REACTION_TYPES, REACTION_EMOJI, ReactionType } from '@/constants/reactions';

// A row of emoji reactions shown in a transparent full-screen modal so a tap
// anywhere else dismisses it — used from both the post and comment "like"
// buttons on long-press.
export function ReactionPicker({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (type: ReactionType) => void;
  onClose: () => void;
}) {
  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.row}>
          {REACTION_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={styles.button}
              onPress={() => onSelect(type)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.emoji}>{REACTION_EMOJI[type]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  button: {
    padding: 2,
  },
  emoji: {
    fontSize: 28,
  },
});
