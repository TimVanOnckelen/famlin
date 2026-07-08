import { LoginResponse } from './auth';
export interface InvitePreview {
    status: 'valid' | 'expired' | 'used' | 'not_found';
    groupName?: string;
    groupDescription?: string | null;
    inviterName?: string | null;
    email?: string | null;
}
export declare function fetchInvitePreview(token: string): Promise<InvitePreview>;
export declare function registerViaInvite(token: string, data: {
    name: string;
    email?: string;
    password: string;
}): Promise<LoginResponse>;
export declare function acceptInvite(token: string): Promise<{
    success: boolean;
    groupId: string;
}>;
