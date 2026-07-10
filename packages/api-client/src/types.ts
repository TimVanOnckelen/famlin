export const REACTION_TYPES = ['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'CARE'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  isAdmin: boolean;
  // False for SSO-only accounts (no local password to change).
  hasPassword: boolean;
  emailOnNewPost: boolean;
  emailOnNewComment: boolean;
  emailOnNewLike: boolean;
  pushOnNewPost: boolean;
  pushOnNewComment: boolean;
  pushOnNewLike: boolean;
}

export interface Group {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
  joinedAt?: string;
}

export interface Post {
  id: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  groupId: string;
  group?: {
    id: string;
    name: string;
  } | null;
  content?: string | null;
  type: 'UPDATE' | 'MILESTONE';
  milestoneTag?: string | null;
  uploadedAssetUrls: string[];
  createdAt: string;
  editedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationName?: string | null;
  commentCount: number;
  likeCount: number;
  likedByMe: boolean;
  myReaction: ReactionType | null;
  reactions: Partial<Record<ReactionType, number>>;
  // The three most recent reactors (newest first) so clients can show who
  // reacted, not just a count. Optional: older servers don't send it.
  recentReactors?: { id: string; name: string; avatarUrl?: string | null }[];
  favoritedByMe: boolean;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  content: string;
  createdAt: string;
  editedAt?: string | null;
  parentId?: string | null;
  // Set when the comment is pinned to one photo/video in the post rather
  // than the post as a whole — matches an entry in Post.uploadedAssetUrls.
  assetUrl?: string | null;
  likeCount: number;
  likedByMe: boolean;
  myReaction: ReactionType | null;
  reactions: Partial<Record<ReactionType, number>>;
}

export interface Notification {
  id: string;
  type: string;
  relatedPostId?: string | null;
  message: string;
  readAt?: string | null;
  createdAt: string;
  post?: {
    id: string;
    groupId: string;
  } | null;
}
