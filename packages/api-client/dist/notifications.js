"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNotifications = fetchNotifications;
exports.fetchUnreadNotificationCount = fetchUnreadNotificationCount;
exports.markNotificationRead = markNotificationRead;
exports.markAllNotificationsRead = markAllNotificationsRead;
const client_1 = require("./client");
async function fetchNotifications() {
    const response = await client_1.api.get('/notifications');
    return response.data;
}
async function fetchUnreadNotificationCount() {
    const response = await client_1.api.get('/notifications/unread-count');
    return response.data.count;
}
async function markNotificationRead(id) {
    await client_1.api.patch(`/notifications/${id}`, { read: true });
}
async function markAllNotificationsRead() {
    await client_1.api.post('/notifications/mark-all-read');
}
