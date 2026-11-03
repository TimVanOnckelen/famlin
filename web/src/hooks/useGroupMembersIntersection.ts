import { useQueries } from '@tanstack/react-query'
import { fetchGroupMembers } from '@famlin/api-client'

// A cross-posted trip can only invite companions who belong to every family.
export function useGroupMembersIntersection(groupIds: string[], enabled: boolean) {
  const queries = useQueries({
    queries: groupIds.map((id) => ({
      queryKey: ['group-members', id],
      queryFn: () => fetchGroupMembers(id),
      enabled: enabled && !!id,
    })),
  })
  const loaded = groupIds.length > 0 && queries.every((query) => !!query.data)
  const isError = queries.some((query) => query.isError)
  const members = loaded
    ? (queries[0].data ?? []).filter((member) =>
        queries.every((query) => query.data?.some((other) => other.id === member.id))
      )
    : []
  return {
    members,
    loaded,
    isError,
    retry: () =>
      queries.forEach((query) => {
        if (query.isError) void query.refetch()
      }),
  }
}
