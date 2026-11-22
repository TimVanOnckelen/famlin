export interface CalendarFeedStatus {
    /** Whether the member currently has a feed URL (an active token). */
    enabled: boolean;
    createdAt: string | null;
    /** Last time a calendar app fetched the feed; throttled server-side. */
    lastUsedAt: string | null;
}
export interface CreatedCalendarFeed {
    /** `https://…/api/calendar/<token>/famlin.ics` — shown once. */
    url: string;
    /** The same URL with the `webcal://` scheme, for one-tap subscribe. */
    webcalUrl: string;
    createdAt: string;
}
export declare function fetchCalendarFeed(): Promise<CalendarFeedStatus>;
export declare function createCalendarFeed(): Promise<CreatedCalendarFeed>;
export declare function revokeCalendarFeed(): Promise<void>;
