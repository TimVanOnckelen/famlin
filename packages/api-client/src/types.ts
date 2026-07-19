export const REACTION_TYPES = ['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'CARE'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

// One reactor's identity plus which reaction they left — the full list a
// post's reactions can be broken down into, as opposed to Post.recentReactors
// (top 3, no type) below.
export interface PostReactor {
  id: string;
  name: string;
  avatarUrl?: string | null;
  type: ReactionType;
}

export interface PostPerson {
  id: string;
  provider: string;
  label: string;
  userId: string | null;
  userName: string | null;
  userAvatarUrl: string | null;
}

// An open string discriminator — 'UPDATE'/'MILESTONE'/'POLL'/'TRIP' are the
// types the server ships today, but the `(string & {})` branch keeps this
// widen-able (custom types added server-side) without TS narrowing string
// literals away.
export type PostType = 'UPDATE' | 'MILESTONE' | 'POLL' | 'TRIP' | (string & {});

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

// The shape a client sends as `typeData` when creating a TRIP post. Dates are
// plain 'YYYY-MM-DD' strings (no time component) — see `dayNumber`/
// `durationDays` on TripEnrichment for the derived-day-count view of them.
export interface TripTypeData {
  title: string;
  destination?: string;
  startDate: string;
  endDate?: string;
  coverPhotoUrl?: string;
  // Co-travelers: group members (max 20) who may also check in on this trip.
  // The author is implicitly a traveler and must NOT be included here.
  travelerUserIds?: string[];
}

// A co-traveler on a trip, as enriched into TripEnrichment.travelers.
export interface TripTraveler {
  id: string;
  name: string;
  avatarUrl: string | null;
}

// The most recent check-in on an active trip, surfaced on the feed card
// ("Last stop: Bologna · 14:20") without fetching the whole comment list.
export interface TripLatestCheckin {
  commentId: string;
  place: string;
  createdAt: string;
}

// Present only when type === 'TRIP' — the read-time-enriched, per-post view
// computed from the trip's typeData plus its check-in comments (see
// Comment.metadata below for how a check-in is represented as a comment).
export interface TripEnrichment {
  title: string;
  destination: string | null;
  startDate: string;
  endDate: string | null;
  coverPhotoUrl: string | null;
  closed: boolean;
  closedAt: string | null;
  // Set only while the trip is active (1-based, derived from startDate).
  dayNumber: number | null;
  // Set only once the trip is closed.
  durationDays: number | null;
  stopCount: number;
  photoCount: number;
  latestCheckin: TripLatestCheckin | null;
  // Up to 3 photo URLs, newest first — the closed-trip feed card's collage.
  collagePhotoUrls: string[];
  // Co-travelers the author designated (author excluded) — they may check in
  // too; check-in permission is author OR listed here. See setTripTravelers.
  travelers: TripTraveler[];
}

// A trip check-in is a Comment whose `metadata.kind` is 'trip_checkin' (see
// Comment.metadata below) — this is the shape of that metadata, not a
// standalone entity with its own fetch/create endpoints.
export interface TripCheckinMetadata {
  kind: 'trip_checkin';
  place: string;
  photoUrls: string[];
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
  // Present only when type === 'TRIP' — see TripEnrichment.
  trip?: TripEnrichment;
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
  // Set when this comment is really a TRIP check-in (kind 'trip_checkin')
  // rather than a regular comment — null/absent for every ordinary comment.
  // See TripCheckinMetadata; clients split a post's comment list on this
  // field to build the trip timeline vs. the "reacties op de reis" section.
  metadata?: TripCheckinMetadata | null;
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
