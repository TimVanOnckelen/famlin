"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportDevice = reportDevice;
exports.unregisterDevice = unregisterDevice;
exports.fetchMyDevices = fetchMyDevices;
const client_1 = require("./client");
async function reportDevice(installId, payload) {
    await client_1.api.put(`/devices/${encodeURIComponent(installId)}`, payload);
}
async function unregisterDevice(installId) {
    await client_1.api.delete(`/devices/${encodeURIComponent(installId)}`);
}
async function fetchMyDevices() {
    const { data } = await client_1.api.get('/devices/me');
    return data;
}
