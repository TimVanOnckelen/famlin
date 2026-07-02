// Shared response shape for a post — used everywhere a post (list, detail,
// create, update, favorites) is returned to a member, so the
// commentCount/likeCount/likedByMe/favoritedByMe mapping isn't repeated at
// every call site.
export function shapePost<
  T extends {
    _count: { comments: number; likes: number };
    likes: { id: string }[];
    favorites: { id: string }[];
  }
>(post: T) {
  const { _count, likes, favorites, ...rest } = post;
  return {
    ...rest,
    commentCount: _count.comments,
    likeCount: _count.likes,
    likedByMe: likes.length > 0,
    favoritedByMe: favorites.length > 0,
  };
}
