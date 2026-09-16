import { Circle, CircleMember } from './types';
export declare function fetchMyCircles(groupId: string): Promise<Circle[]>;
export declare function fetchCircleMembers(circleId: string): Promise<CircleMember[]>;
export declare function leaveCircle(circleId: string): Promise<void>;
