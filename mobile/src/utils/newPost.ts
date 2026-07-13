// Pure helper for turning the composer's multi-select group state into the
// createPost payload shape the backend expects: groupId is always the first
// selected group (for older servers that don't know groupIds, and as the
// "primary" group the composer/media picker are scoped to), groupIds is only
// sent when more than one group is selected (a genuine cross-post).
export function buildGroupSelectionPayload(selectedGroupIds: string[]): {
  groupId: string;
  groupIds?: string[];
} {
  if (selectedGroupIds.length === 0) {
    throw new Error('At least one group must be selected');
  }

  return {
    groupId: selectedGroupIds[0],
    groupIds: selectedGroupIds.length > 1 ? selectedGroupIds : undefined,
  };
}

// Toggles a group in/out of the current multi-select, refusing to drop the
// last remaining selection — the composer always requires at least one group.
export function toggleGroupSelection(current: string[], groupId: string): string[] {
  if (current.includes(groupId)) {
    if (current.length === 1) return current;
    return current.filter((id) => id !== groupId);
  }
  return [...current, groupId];
}
