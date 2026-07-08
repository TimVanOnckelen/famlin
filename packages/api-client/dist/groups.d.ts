import { Group } from './types';
export interface GroupMember {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    joinedAt: string;
}
export declare function fetchGroups(): Promise<Group[]>;
export declare function fetchGroupMembers(groupId: string): Promise<GroupMember[]>;
