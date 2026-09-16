import { View, Text, StyleSheet } from 'react-native';
import { Post } from '@famlin/api-client';
import { colors } from '../constants/colors';

// "Shared in Grandparents" — marks a post that went to a Circle rather than
// the whole family.
//
// Presentation only: the server never sends a circle post to someone who
// isn't in that circle, so nothing is being hidden client-side here. What
// this buys is that a reader can TELL the post is narrower than usual, which
// is the feature's social contract.
//
// Mirrors web's CircleBadge, including the warm palette that distinguishes it
// from the neutral family tag next to it.
export function CircleTag({ post }: { post: Post }) {
  if (!post.circle) return null;

  return (
    <View style={styles.circleTag}>
      <Text style={styles.circleTagText} numberOfLines={1}>
        {post.circle.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
