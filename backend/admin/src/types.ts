export interface GroupRef {
  id: string;
  name: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  emailOnNewPost: boolean;
  emailOnNewComment: boolean;
  emailOnNewLike: boolean;
  pushOnNewPost: boolean;
  pushOnNewComment: boolean;
  pushOnNewLike: boolean;
  createdAt: string;
  groups?: GroupRef[];
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  memberCount?: number;
}

// A user as returned by the group-members endpoint, carrying the join date.
export interface GroupMember extends User {
  joinedAt: string;
}

export interface GroupWithMembers extends Group {
  members: User[];
}

export interface ServerSettings {
  defaultLanguage: string;
  appStoreUrl: string;
  playStoreUrl: string;
  allowedEmails: string[];
  oidcName: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcScopes: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  immichServerUrl: string;
  immichApiKey: string;
}

export interface ImmichAlbumSummary {
  id: string;
  albumName: string;
  assetCount: number;
}

export interface ImmichAlbumLink {
  id: string;
  groupId: string;
  immichAlbumId: string;
  albumName: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  token: string;
  link: string;
  groupId: string;
  email: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  usedBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface OidcConfig {
  enabled: boolean;
  name: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes: string;
  // True when the provider requires a client secret (e.g. Google) — the
  // browser hands the authorization code to POST /oidc/exchange instead of
  // exchanging it itself.
  usesClientSecret: boolean;
}

export interface ModerationPost {
  id: string;
  content: string | null;
  type: 'UPDATE' | 'MILESTONE';
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string };
  group: { id: string; name: string };
  commentCount: number;
  likeCount: number;
}

export interface ModerationComment {
  id: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string };
  post: { id: string; content: string | null; group: { id: string; name: string } };
}

export interface DashboardStats {
  counts: {
    users: number;
    admins: number;
    groups: number;
    posts: number;
    comments: number;
    likes: number;
  };
  postsByDay: { date: string; count: number }[];
  recentPosts: {
    id: string;
    type: 'UPDATE' | 'MILESTONE';
    createdAt: string;
    authorName: string;
    groupName: string;
    commentCount: number;
    likeCount: number;
  }[];
  topGroups: { id: string; name: string; postCount: number }[];
}
