// Shared cursor-pagination helpers so every list endpoint (feed, favorites,
// admin users/content) fetches/shapes pages the same way.

export function paginationArgs(query: { cursor?: string; take: number }) {
  return {
    take: query.take + 1, // fetch one extra row to know whether there's a next page
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };
}

export function paginate<T extends { id: string }>(rows: T[], take: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
