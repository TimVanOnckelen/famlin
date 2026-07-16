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

// An open string discriminator — 'UPDATE'/'MILESTONE'/'POLL' are the types
// the server ships today, but the `(string & {})` branch keeps this widen-able
// (custom types added server-side) without TS narrowing string literals away.
export type PostType = 'UPDATE' | 'MILESTONE' | 'POLL' | (string & {});

export interface PollOptionResult {
  id: string;
  text: string;
  voteCount: number;
  voters: { id: string; name: string; avatarUrl?: string | null }[];
}

export interface PostPoll {
  options: PollOptionResult[];
  totalVotes: number;
  myVoteOptionId: string | null;
  closesAt: string | null;
  closed: boolean;
}

// The shape a client sends as `typeData` when creating a POLL post.
export interface PollCreateData {
  options: { text: string }[];
  closesAt?: string;
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
  // Effective list of post type ids members may create in this group,
  // already resolved by the server (never an "empty means all" sentinel).
  // Missing = older server that predates the setting → all types allowed.
  allowedPostTypes?: string[];
  // Whether chat is enabled for this group.
  chitchatEnabled: boolean;
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
  type: PostType;
  // Handler-owned config for custom post types (e.g. poll options); null/absent
  // for UPDATE/MILESTONE. Raw stored form — see `poll` below for the enriched
  // per-viewer view of it.
  typeData?: unknown;
  // Present only when type === 'POLL' (or another future poll-like type the
  // server enriches this way); the aggregated, per-viewer poll view.
  poll?: PostPoll;
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
