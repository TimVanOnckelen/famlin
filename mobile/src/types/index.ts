export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  isAdmin: boolean;
  emailNotificationsEnabled: boolean;
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
  content?: string | null;
  type: 'UPDATE' | 'MILESTONE';
  milestoneTag?: string | null;
  immichAlbumId?: string | null;
  immichAssetIds: string[];
  uploadedAssetUrls: string[];
  createdAt: string;
  commentCount: number;
  likeCount: number;
  likedByMe: boolean;
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
