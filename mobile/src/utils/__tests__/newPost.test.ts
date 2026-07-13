import { buildGroupSelectionPayload, toggleGroupSelection } from '@/utils/newPost';

describe('buildGroupSelectionPayload', () => {
  it('sends only groupId when a single group is selected (no cross-post)', () => {
    expect(buildGroupSelectionPayload(['g1'])).toEqual({
      groupId: 'g1',
      groupIds: undefined,
    });
  });

  it('sends groupId as the first selection plus groupIds when 2+ groups are selected', () => {
    expect(buildGroupSelectionPayload(['g1', 'g2', 'g3'])).toEqual({
      groupId: 'g1',
      groupIds: ['g1', 'g2', 'g3'],
    });
  });

  it('uses whichever group was selected first as the primary groupId, not selection order in the UI list', () => {
    expect(buildGroupSelectionPayload(['g2', 'g1'])).toEqual({
      groupId: 'g2',
      groupIds: ['g2', 'g1'],
    });
  });

  it('throws when nothing is selected', () => {
    expect(() => buildGroupSelectionPayload([])).toThrow();
  });
});

describe('toggleGroupSelection', () => {
  it('adds a group that is not yet selected', () => {
    expect(toggleGroupSelection(['g1'], 'g2')).toEqual(['g1', 'g2']);
  });

  it('removes a selected group when others remain selected', () => {
    expect(toggleGroupSelection(['g1', 'g2'], 'g1')).toEqual(['g2']);
  });

  it('refuses to deselect the last remaining group', () => {
    expect(toggleGroupSelection(['g1'], 'g1')).toEqual(['g1']);
  });

  it('is a no-op removal on an empty selection (nothing to remove)', () => {
    expect(toggleGroupSelection([], 'g1')).toEqual(['g1']);
  });
});
