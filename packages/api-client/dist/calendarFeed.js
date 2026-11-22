"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCalendarFeed = fetchCalendarFeed;
exports.createCalendarFeed = createCalendarFeed;
exports.revokeCalendarFeed = revokeCalendarFeed;
const client_1 = require("./client");
async function fetchCalendarFeed() {
    // requires-feature: calendarFeed
    const res = await client_1.api.get('/auth/me/calendar-feed');
    return res.data;
}
// Creates the feed, or regenerates it: the previous URL stops working.
async function createCalendarFeed() {
    // requires-feature: calendarFeed
    const res = await client_1.api.post('/auth/me/calendar-feed');
    return res.data;
}
async function revokeCalendarFeed() {
    // requires-feature: calendarFeed
    await client_1.api.delete('/auth/me/calendar-feed');
}
