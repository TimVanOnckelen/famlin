"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDiagnosticReport = sendDiagnosticReport;
const client_1 = require("./client");
async function sendDiagnosticReport(report) {
    // requires-feature: diagnosticReports
    await client_1.api.post('/diagnostics/reports', report);
}
