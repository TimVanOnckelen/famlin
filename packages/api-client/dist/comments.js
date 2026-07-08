"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchComments = fetchComments;
exports.createComment = createComment;
exports.updateComment = updateComment;
exports.deleteComment = deleteComment;
exports.reactToComment = reactToComment;
const client_1 = require("./client");
async function fetchComments(postId, assetUrl) {
    const response = await client_1.api.get(`/posts/${postId}/comments`, {
        params: assetUrl ? { assetUrl } : undefined,
    });
    return response.data;
}
async function createComment(postId, data) {
    const response = await client_1.api.post(`/posts/${postId}/comments`, data);
    return response.data;
}
async function updateComment(commentId, content) {
    const response = await client_1.api.patch(`/comments/${commentId}`, { content });
    return response.data;
}
async function deleteComment(commentId) {
    await client_1.api.delete(`/comments/${commentId}`);
}
async function reactToComment(commentId, type) {
    const response = await client_1.api.post(`/comments/${commentId}/like`, { type });
    return response.data;
}
