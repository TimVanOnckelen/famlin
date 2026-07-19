import { useQueries } from '@tanstack/react-query';

import { fetchGroupMembers, GroupMember } from '@famlin/api-client';

// Members belonging to EVERY one of the given groups — the set of valid trip
// co-travelers for a (possibly cross-posted) trip, since the server requires
// each travelerUserId to be a member of every target group
// (errors.tripTravelerNotMember). One query per group, sharing the same
// ['groupMembers', groupId] cache key the rest of the app uses; the
// intersection keeps the first group's member order.
export function useGroupMembersIntersection(groupIds: string[], enabled: boolean = true) {
  const results = useQueries({
    queries: groupIds.map((groupId) => ({
      queryKey: ['groupMembers', groupId],
      queryFn: () => fetchGroupMembers(groupId),
      enabled: enabled && !!groupId,
    })),
  });

  const isError = results.some((result) => result.isError);
  // "Loaded" = every group's list is available; callers must not reconcile
  // selections against a half-loaded intersection (it would wrongly drop
  // everyone while a list is still in flight).
  const loaded = groupIds.length > 0 && results.every((result) => !!result.data);
  const isLoading = enabled && !loaded && !isError;

  let members: GroupMember[] = [];
  if (loaded) {
    const [first, ...rest] = results;
    members = (first.data as GroupMember[]).filter((member) =>
      rest.every((result) => (result.data as GroupMember[]).some((other) => other.id === member.id))
    );
  }

  return { members, loaded, isLoading, isError };
}
