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
  deletedAt: string | null;
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
  oidcScopes: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
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
}

export interface ModerationPost {
  id: string;
  content: string | null;
  type: 'UPDATE' | 'MILESTONE';
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: { id: string; name: string };
  group: { id: string; name: string };
  deletedBy: { id: string; name: string } | null;
  commentCount: number;
  likeCount: number;
}

export interface ModerationComment {
  id: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: { id: string; name: string };
  deletedBy: { id: string; name: string } | null;
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
