import {
  buildGroupSelectionPayload,
  toggleGroupSelection,
  resolveOfferedPostTypes,
  reconcilePostTypeSelection,
} from '@/utils/newPost';

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

describe('resolveOfferedPostTypes', () => {
  const KNOWN = ['UPDATE', 'MILESTONE', 'POLL'] as const;

  it('offers a single group its own allowed list, in known-type order', () => {
    const groups = [{ id: 'g1', allowedPostTypes: ['POLL', 'UPDATE'] }];
    expect(resolveOfferedPostTypes(KNOWN, groups, ['g1'])).toEqual(['UPDATE', 'POLL']);
  });

  it('intersects the allowed lists of every selected group for a cross-post', () => {
    const groups = [
      { id: 'g1', allowedPostTypes: ['UPDATE', 'MILESTONE', 'POLL'] },
      { id: 'g2', allowedPostTypes: ['UPDATE', 'POLL'] },
      { id: 'g3', allowedPostTypes: ['UPDATE', 'MILESTONE'] },
    ];
    expect(resolveOfferedPostTypes(KNOWN, groups, ['g1', 'g2', 'g3'])).toEqual(['UPDATE']);
  });

  it('returns an empty list when the selected groups have disjoint allow-lists', () => {
    const groups = [
      { id: 'g1', allowedPostTypes: ['MILESTONE'] },
      { id: 'g2', allowedPostTypes: ['POLL'] },
    ];
    expect(resolveOfferedPostTypes(KNOWN, groups, ['g1', 'g2'])).toEqual([]);
  });

  it('treats a group missing allowedPostTypes as allowing everything (older server)', () => {
    const groups = [
      { id: 'g1' },
      { id: 'g2', allowedPostTypes: ['UPDATE', 'POLL'] },
    ];
    expect(resolveOfferedPostTypes(KNOWN, groups, ['g1', 'g2'])).toEqual(['UPDATE', 'POLL']);
  });

  it('offers everything when no selected group constrains (all missing the field)', () => {
    const groups = [{ id: 'g1' }, { id: 'g2' }];
    expect(resolveOfferedPostTypes(KNOWN, groups, ['g1', 'g2'])).toEqual([...KNOWN]);
  });

  it('offers everything while group data has not loaded yet (undefined groups / unknown ids)', () => {
    expect(resolveOfferedPostTypes(KNOWN, undefined, ['g1'])).toEqual([...KNOWN]);
    expect(resolveOfferedPostTypes(KNOWN, [], ['g1'])).toEqual([...KNOWN]);
  });

  it('never offers a type this app build does not know, even if a group allows it', () => {
    const groups = [{ id: 'g1', allowedPostTypes: ['UPDATE', 'RSVP_FUTURE_TYPE'] }];
    expect(resolveOfferedPostTypes(KNOWN, groups, ['g1'])).toEqual(['UPDATE']);
  });
});

describe('reconcilePostTypeSelection', () => {
  it('keeps the current type when it is still offered', () => {
    expect(reconcilePostTypeSelection('POLL', ['UPDATE', 'POLL'])).toBe('POLL');
  });

  it('falls back to the first offered type when the current one dropped out', () => {
    expect(reconcilePostTypeSelection('POLL', ['UPDATE', 'MILESTONE'])).toBe('UPDATE');
  });

  it('returns null when nothing is offered (empty intersection)', () => {
    expect(reconcilePostTypeSelection('UPDATE', [])).toBeNull();
  });
});
