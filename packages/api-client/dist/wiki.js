"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWikiPages = fetchWikiPages;
exports.fetchWikiCategories = fetchWikiCategories;
exports.fetchWikiPage = fetchWikiPage;
exports.createWikiPage = createWikiPage;
exports.updateWikiPage = updateWikiPage;
exports.deleteWikiPage = deleteWikiPage;
exports.wikiConflictPage = wikiConflictPage;
const client_1 = require("./client");
// Newest edit first — the overview's "recently updated" list, search results
// and a category's pages are all this one call.
async function fetchWikiPages(params) {
    const response = await client_1.api.get('/wiki/pages', { params });
    return response.data;
}
async function fetchWikiCategories(groupId) {
    const response = await client_1.api.get('/wiki/categories', { params: { groupId } });
    return response.data.items;
}
async function fetchWikiPage(pageId) {
    const response = await client_1.api.get(`/wiki/pages/${pageId}`);
    return response.data;
}
async function createWikiPage(body) {
    const response = await client_1.api.post('/wiki/pages', body);
    return response.data;
}
async function updateWikiPage(pageId, body) {
    const response = await client_1.api.patch(`/wiki/pages/${pageId}`, body);
    return response.data;
}
async function deleteWikiPage(pageId) {
    await client_1.api.delete(`/wiki/pages/${pageId}`);
}
// The current version of the page when a save was refused because someone
// else saved in between (409), else null.
function wikiConflictPage(err) {
    const response = err?.response;
    return response?.status === 409 && response.data?.page ? response.data.page : null;
}
