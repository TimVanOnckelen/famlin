"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_URL_KEY = exports.TOKEN_KEY = void 0;
exports.setStorageAdapter = setStorageAdapter;
exports.getStorageAdapter = getStorageAdapter;
let adapter = null;
function setStorageAdapter(a) {
    adapter = a;
}
function getStorageAdapter() {
    if (!adapter) {
        throw new Error('@famlin/api-client: setStorageAdapter() must be called before use');
    }
    return adapter;
}
exports.TOKEN_KEY = 'famlin_token';
exports.SERVER_URL_KEY = 'famlin_server_url';
