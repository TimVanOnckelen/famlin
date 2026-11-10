import type { UploadProcessing } from './uploads';
export declare const REACTION_TYPES: readonly ['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'CARE'];
export type ReactionType = (typeof REACTION_TYPES)[number];
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
export type PostType = 'UPDATE' | 'MILESTONE' | 'POLL' | 'TRIP' | 'ALBUM' | 'GIFT_LIST' | 'EVENT' | (string & {});
export interface PollOptionResult {
    id: string;
    text: string;
    voteCount: number;
    voters: {
        id: string;
        name: string;
        avatarUrl?: string | null;
    }[];
}
export interface PostPoll {
    options: PollOptionResult[];
    totalVotes: number;
    myVoteOptionId: string | null;
    closesAt: string | null;
    closed: boolean;
}
export interface PollCreateData {
    options: {
        text: string;
    }[];
    closesAt?: string;
}
export declare const RSVP_RESPONSES: readonly ['yes', 'maybe', 'no'];
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];
export interface EventCreateData {
    startsAt: string;
    endsAt?: string;
    location?: string;
    rsvpDeadline?: string;
}
export interface PostEvent {
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    rsvpDeadline: string | null;
    closed: boolean;
    myRsvp: RsvpResponse | null;
    counts: Record<RsvpResponse, number>;
    responses: Record<RsvpResponse, {
        id: string;
        name: string;
        avatarUrl: string | null;
    }[]>;
}
export interface TripTypeData {
    title: string;
    destination?: string;
    startDate: string;
    endDate?: string;
    coverPhotoUrl?: string;
    travelerUserIds?: string[];
}
export interface TripTraveler {
    id: string;
    name: string;
    avatarUrl: string | null;
}
export interface TripLatestCheckin {
    commentId: string;
    place: string;
    createdAt: string;
}
export interface TripEnrichment {
    title: string;
    destination: string | null;
    startDate: string;
    endDate: string | null;
    coverPhotoUrl: string | null;
    closed: boolean;
    closedAt: string | null;
    dayNumber: number | null;
    durationDays: number | null;
    stopCount: number;
    photoCount: number;
    latestCheckin: TripLatestCheckin | null;
    collagePhotoUrls: string[];
    travelers: TripTraveler[];
}
export interface TripCheckinMetadata {
    kind: 'trip_checkin';
    place: string;
    photoUrls: string[];
    checkinId: string;
}
export interface AlbumTypeData {
    title: string;
    coverPhotoUrl?: string;
}
export interface AlbumContributor {
    id: string;
    name: string;
    avatarUrl: string | null;
}
export interface AlbumLatestContribution {
    commentId: string;
    contributorName: string;
    createdAt: string;
}
export interface AlbumEnrichment {
    title: string;
    coverPhotoUrl: string | null;
    closed: boolean;
    closedAt: string | null;
    photoCount: number;
    contributorCount: number;
    contributors: AlbumContributor[];
    collagePhotoUrls: string[];
    latestContribution: AlbumLatestContribution | null;
}
export interface AlbumPhotoMetadata {
    kind: 'album_photo';
    photoUrls: string[];
    contributionId: string;
}
export interface GiftListTypeData {
    title: string;
    occasionDate?: string | null;
    participantUserIds?: string[];
    drawEnabled?: boolean;
    budget?: string | null;
    exclusions?: Array<[string, string]>;
}
export interface GiftListParticipant {
    id: string;
    name: string;
    avatarUrl: string | null;
    itemCount: number;
}
export interface GiftListEnrichment {
    title: string;
    occasionDate: string | null;
    drawEnabled: boolean;
    budget: string | null;
    drawn: boolean;
    drawnAt: string | null;
    managerId: string;
    isManager: boolean;
    participants: GiftListParticipant[];
    itemCount: number;
    exclusions: Array<[string, string]> | null;
    myRecipient: {
        id: string;
        name: string;
        avatarUrl: string | null;
    } | null;
}
export interface GiftListItem {
    id: string;
    postId: string;
    ownerId: string;
    title: string;
    note: string | null;
    url: string | null;
    photoUrl: string | null;
    position: number;
    createdAt: string;
    updatedAt: string;
}
export interface User {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    isAdmin: boolean;
    hasPassword: boolean;
    emailOnNewPost: boolean;
    emailOnNewComment: boolean;
    emailOnNewLike: boolean;
    pushOnNewPost: boolean;
    pushOnNewComment: boolean;
    pushOnNewLike: boolean;
    pushOnStory?: boolean;
    pushOnGiftList?: boolean;
}
export interface Group {
    id: string;
    name: string;
    description?: string | null;
    createdAt: string;
    joinedAt?: string;
    allowedPostTypes?: string[];
    chitchatEnabled: boolean;
    storiesEnabled?: boolean;
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
    typeData?: unknown;
    poll?: PostPoll;
    trip?: TripEnrichment;
    event?: PostEvent;
    album?: AlbumEnrichment;
    giftList?: GiftListEnrichment;
    circleId?: string | null;
    circle?: {
        id: string;
        name: string;
    } | null;
    milestoneTag?: string | null;
    uploadedAssetUrls: string[];
    createdAt: string;
    uploadProcessing?: Record<string, UploadProcessing>;
    editedAt?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    locationName?: string | null;
    commentCount: number;
    likeCount: number;
    likedByMe: boolean;
    myReaction: ReactionType | null;
    reactions: Partial<Record<ReactionType, number>>;
    recentReactors?: {
        id: string;
        name: string;
        avatarUrl?: string | null;
    }[];
    favoritedByMe: boolean;
    people?: PostPerson[];
    sharedWithGroups?: {
        id: string;
        name: string;
    }[];
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
    assetUrl?: string | null;
    attachmentUrl?: string | null;
    attachmentUrls?: string[] | null;
    metadata?: TripCheckinMetadata | AlbumPhotoMetadata | null;
    likeCount: number;
    likedByMe: boolean;
    myReaction: ReactionType | null;
    reactions: Partial<Record<ReactionType, number>>;
}
export interface Notification {
    id: string;
    type: string;
    relatedPostId?: string | null;
    relatedStoryId?: string | null;
    message: string;
    readAt?: string | null;
    createdAt: string;
    post?: {
        id: string;
        groupId: string;
    } | null;
    story?: {
        id: string;
        groupId: string;
    } | null;
}
export interface Circle {
    id: string;
    groupId: string;
    name: string;
    description?: string | null;
    avatarUrl?: string | null;
    memberCount: number;
    createdAt: string;
}
export interface CircleMember {
    id: string;
    name: string;
    avatarUrl?: string | null;
    joinedAt: string;
}
