import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Post } from '@famlin/api-client';
import { colors } from '../constants/colors';
import { CircleMembersModal } from './CircleMembersModal';

// "Shared in Grandparents" — marks a post that went to a Circle rather than
// the whole family.
//
// The tag itself is presentation only: the server never sends a circle post
// to someone outside that circle, so nothing is hidden client-side here.
// Tapping it opens the circle's member list, which is the transparency half
// of the privacy model — an admin can add themselves to a circle, so the
// guarantee members get is "nobody reads this silently", and that needs
// somewhere to look. Mirrors web's CircleBadge.
export function CircleTag({ post }: { post: Post }) {
  const [membersOpen, setMembersOpen] = useState(false);

  if (!post.circle) return null;

  const circle = post.circle;

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.circleTag}
        onPress={() => setMembersOpen(true)}
        accessibilityRole="button"
      >
        <Text style={styles.circleTagText} numberOfLines={1}>
          {circle.name}
        </Text>
      </TouchableOpacity>

      <CircleMembersModal
        visible={membersOpen}
        circleId={circle.id}
        circleName={circle.name}
        onClose={() => setMembersOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'flex-start' },
  circleTag: {
    backgroundColor: colors.circleTint,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
    maxWidth: 160,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  circleTagText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.circleDark,
  },
});
