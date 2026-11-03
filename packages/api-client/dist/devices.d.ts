export type DevicePlatform = 'ios' | 'android';
export type PushPermission = 'granted' | 'denied' | 'undetermined';
export interface DevicePayload {
    platform: DevicePlatform;
    osVersion: string;
    appVersion: string;
    appBuild: string;
    pushPermission: PushPermission;
}
export interface MemberDevice extends DevicePayload {
    installId: string;
}
export declare function reportDevice(installId: string, payload: DevicePayload): Promise<void>;
export declare function unregisterDevice(installId: string): Promise<void>;
export declare function fetchMyDevices(): Promise<MemberDevice[]>;
