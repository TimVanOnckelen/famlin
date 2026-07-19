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

// Which post types the composer may offer for the current group selection:
// the INTERSECTION of every selected group's server-resolved
// `allowedPostTypes` list, filtered to (and ordered by) the types this app
// build actually knows how to compose (`knownTypes`). A group with the field
// missing — an older server, or group data not loaded yet — counts as
// allowing everything (backward compat: absence means the server predates the
// setting, so nothing is restricted). Cross-posting therefore only offers
// types every target group accepts, matching the server's per-target-group
// enforcement of POST /api/posts.
export function resolveOfferedPostTypes(
  knownTypes: readonly string[],
  groups: ReadonlyArray<{ id: string; allowedPostTypes?: string[] }> | undefined,
  selectedGroupIds: readonly string[]
): string[] {
  const constraints = selectedGroupIds
    .map((groupId) => groups?.find((group) => group.id === groupId)?.allowedPostTypes)
    .filter((allowed): allowed is string[] => Array.isArray(allowed));

  return knownTypes.filter((type) => constraints.every((allowed) => allowed.includes(type)));
}

// Keeps the composer's selected type valid after the offered set changes
// (e.g. the user added a target group that doesn't allow polls): the current
// type is kept if still offered, otherwise falls back to the first offered
// type, or null when the intersection is empty (composer must disable submit
// and show a notice in that state).
export function reconcilePostTypeSelection(current: string, offered: readonly string[]): string | null {
  if (offered.includes(current)) return current;
  return offered[0] ?? null;
}

// The server rejects cross-posting (groupIds with more than one entry) for
// TRIP posts — the composer must not offer multi-group selection for it.
export function isMultiGroupAllowedForType(type: string): boolean {
  return type !== 'TRIP';
}

// Keeps the group selection valid after the type changes: switching to a
// type that doesn't allow multi-group (TRIP) collapses the selection down to
// just the first-selected (primary) group; any other type leaves it as-is.
export function reconcileGroupSelectionForType(selectedGroupIds: string[], type: string): string[] {
  if (isMultiGroupAllowedForType(type) || selectedGroupIds.length <= 1) return selectedGroupIds;
  return [selectedGroupIds[0]];
}
