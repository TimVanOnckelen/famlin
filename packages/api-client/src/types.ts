export const REACTION_TYPES = ['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'CARE'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export interface PostPerson {
  id: string;
  provider: string;
  label: string;
  userId: string | null;
  userName: string | null;
  userAvatarUrl: string | null;
}

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
  people?: PostPerson[];
  // Only present when the viewer is the post's author and the post was
  // cross-posted to several groups: every group it was shared with (including
  // this one). Other members never learn a post was cross-posted.
  sharedWithGroups?: { id: string; name: string }[];
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
  // A photo/video the commenter uploaded as part of this comment itself —
  // distinct from assetUrl above, which instead points at an existing asset
  // on the post.
  attachmentUrl?: string | null;
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
