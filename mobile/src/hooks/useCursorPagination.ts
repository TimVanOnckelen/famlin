import { useMemo } from 'react';
import { QueryKey, useInfiniteQuery } from '@tanstack/react-query';

// The shape every cursor-paginated backend list endpoint returns
// (services/pagination.ts server-side).
interface CursorPage<TItem> {
  items: TItem[];
  nextCursor: string | null;
}

/**
 * Wraps useInfiniteQuery with the cursor-pagination conventions every list
 * screen repeats: `initialPageParam: undefined`, `getNextPageParam` from
 * `nextCursor`, pages flattened into one memoized `items` array, and the
 * standard FlatList/SectionList `onEndReached` guard. The raw query result
 * is returned as `query` (not spread) so React Query's tracked-property
 * render optimization keeps working at the call sites.
 */
export function useCursorPagination<TItem>({
  queryKey,
  queryFn,
  enabled = true,
}: {
  queryKey: QueryKey;
  queryFn: (cursor: string | undefined) => Promise<CursorPage<TItem>>;
  enabled?: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam?: string }) => queryFn(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  function onEndReached() {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }

  return { query, items, onEndReached };
}
