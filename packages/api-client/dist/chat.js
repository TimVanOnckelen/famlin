"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatUnreadConversationsQueryKey = exports.chatMessagesQueryKey = exports.chatPeopleQueryKey = exports.chatConversationsQueryKey = void 0;
exports.isChatEncryptionSupported = isChatEncryptionSupported;
exports.fetchChatPeople = fetchChatPeople;
exports.fetchChatConversations = fetchChatConversations;
exports.createChatConversation = createChatConversation;
exports.fetchChatMessages = fetchChatMessages;
exports.fetchChatConversationMessages = fetchChatConversationMessages;
exports.sendChatConversationMessage = sendChatConversationMessage;
exports.sendChatMessage = sendChatMessage;
exports.deleteChatMessage = deleteChatMessage;
exports.markChatRead = markChatRead;
exports.markChatConversationRead = markChatConversationRead;
exports.fetchChatConversationUnreadCounts = fetchChatConversationUnreadCounts;
exports.fetchChatUnreadCounts = fetchChatUnreadCounts;
const client_1 = require("./client");
const chatConversationsQueryKey = () => ['chat-conversations'];
exports.chatConversationsQueryKey = chatConversationsQueryKey;
const chatPeopleQueryKey = () => ['chat-people'];
exports.chatPeopleQueryKey = chatPeopleQueryKey;
const chatMessagesQueryKey = (conversationId) => ['chat-messages', conversationId];
exports.chatMessagesQueryKey = chatMessagesQueryKey;
const chatUnreadConversationsQueryKey = () => ['chat-unread-conversations'];
exports.chatUnreadConversationsQueryKey = chatUnreadConversationsQueryKey;
function isChatEncryptionSupported(encryption) {
    return encryption === 'none';
}
async function fetchChatPeople() {
    // requires-feature: directMessages
    const response = await client_1.api.get('/chat/people');
    return response.data;
}
async function fetchChatConversations() {
    // requires-feature: directMessages
    const response = await client_1.api.get('/chat/conversations');
    return response.data;
}
async function createChatConversation(data) {
    // requires-feature: directMessages
    const response = await client_1.api.post('/chat/conversations', data);
    return response.data;
}
/** @deprecated Use fetchChatConversationMessages(conversationId, params). This function may be removed in the next breaking release. */
async function fetchChatMessages(groupId, cursor) {
    const response = await client_1.api.get(`/chat/groups/${groupId}/messages`, {
        params: cursor ? { cursor } : undefined,
    });
    return response.data;
}
async function fetchChatConversationMessages(conversationId, { cursor, take } = {}) {
    // requires-feature: directMessages
    const response = await client_1.api.get(`/chat/conversations/${conversationId}/messages`, {
        params: {
            ...(cursor ? { cursor } : {}),
            ...(take !== undefined ? { take } : {}),
        },
    });
    return response.data;
}
async function sendChatConversationMessage(conversationId, data) {
    // requires-feature: directMessages
    const response = await client_1.api.post(`/chat/conversations/${conversationId}/messages`, data);
    return response.data;
}
/** @deprecated Use sendChatConversationMessage(conversationId, body). This function may be removed in the next breaking release. */
async function sendChatMessage(groupId, data) {
    const response = await client_1.api.post(`/chat/groups/${groupId}/messages`, data);
    return response.data;
}
async function deleteChatMessage(messageId) {
    await client_1.api.delete(`/chat/messages/${messageId}`);
}
/** @deprecated Use markChatConversationRead(conversationId). This function may be removed in the next breaking release. */
async function markChatRead(groupId) {
    await client_1.api.post(`/chat/groups/${groupId}/read`);
}
async function markChatConversationRead(conversationId) {
    // requires-feature: directMessages
    await client_1.api.post(`/chat/conversations/${conversationId}/read`);
}
async function fetchChatConversationUnreadCounts() {
    // requires-feature: directMessages
    const response = await client_1.api.get('/chat/conversations/unread');
    return response.data;
}
/** @deprecated Use fetchChatConversationUnreadCounts(). This function may be removed in the next breaking release. */
async function fetchChatUnreadCounts() {
    const response = await client_1.api.get('/chat/unread-counts');
    return response.data;
}
