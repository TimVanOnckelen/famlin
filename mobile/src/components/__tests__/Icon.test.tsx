import React from 'react';
import { render } from '@testing-library/react-native';

// The real Feather set pulls in expo-font's native loader; a stub glyph is
// enough to tell the Feather font path apart from the SVG one.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Feather: ({ name }: { name: string }) => <Text testID={`feather-${name}`}>{name}</Text> };
});

import { Icon } from '@/components/Icon';

// Regression for #220: a favorited post's bookmark used to differ from an
// unfavorited one only by a near-identical tint, so it looked unselected.
describe('Icon', () => {
  it('draws a filled bookmark when filled', async () => {
    const { queryByTestId } = await render(<Icon name="bookmark" filled />);
    expect(queryByTestId('icon-bookmark-filled')).not.toBeNull();
    expect(queryByTestId('feather-bookmark')).toBeNull();
  });

  it('draws the outline as the same SVG when not filled', async () => {
    const { queryByTestId } = await render(<Icon name="bookmark" />);
    expect(queryByTestId('icon-bookmark-filled')).toBeNull();
    expect(queryByTestId('icon-bookmark-outline')).not.toBeNull();
    expect(queryByTestId('feather-bookmark')).toBeNull();
  });

  it('ignores filled for icons without a filled variant', async () => {
    const { queryByTestId } = await render(<Icon name="image" filled />);
    expect(queryByTestId('icon-image-filled')).toBeNull();
    expect(queryByTestId('feather-image')).not.toBeNull();
  });
});
