"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCalendarFeed = fetchCalendarFeed;
exports.createCalendarFeed = createCalendarFeed;
exports.revokeCalendarFeed = revokeCalendarFeed;
const client_1 = require("./client");
async function fetchCalendarFeed() {
    const res = await client_1.api.get('/auth/me/calendar-feed');
    return res.data;
}
// Creates the feed, or regenerates it: the previous URL stops working.
async function createCalendarFeed() {
    const res = await client_1.api.post('/auth/me/calendar-feed');
    return res.data;
}
async function revokeCalendarFeed() {
    await client_1.api.delete('/auth/me/calendar-feed');
}
