"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchChatMessages = fetchChatMessages;
exports.sendChatMessage = sendChatMessage;
exports.deleteChatMessage = deleteChatMessage;
exports.markChatRead = markChatRead;
exports.fetchChatUnreadCounts = fetchChatUnreadCounts;
const client_1 = require("./client");
async function fetchChatMessages(groupId, cursor) {
    const response = await client_1.api.get(`/chat/groups/${groupId}/messages`, {
        params: cursor ? { cursor } : undefined,
    });
    return response.data;
}
async function sendChatMessage(groupId, data) {
    const response = await client_1.api.post(`/chat/groups/${groupId}/messages`, data);
    return response.data;
}
async function deleteChatMessage(messageId) {
    await client_1.api.delete(`/chat/messages/${messageId}`);
}
async function markChatRead(groupId) {
    await client_1.api.post(`/chat/groups/${groupId}/read`);
}
async function fetchChatUnreadCounts() {
    const response = await client_1.api.get('/chat/unread-counts');
    return response.data;
}
