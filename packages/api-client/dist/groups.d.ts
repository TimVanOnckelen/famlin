import { Group } from './types';
export interface GroupMember {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    joinedAt: string;
    isAdmin?: boolean;
}
export declare function fetchGroups(): Promise<Group[]>;
export declare function fetchGroupMembers(groupId: string): Promise<GroupMember[]>;
