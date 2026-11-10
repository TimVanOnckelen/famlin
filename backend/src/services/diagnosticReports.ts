import { prisma } from '../db.js'

// Diagnostic reports (issue #357) are a short-lived support tool, not an
// archive: the pruneDiagnosticReports job deletes anything older than this.
export const DIAGNOSTIC_REPORT_RETENTION_DAYS = 30

/** Deletes reports older than the retention window; returns how many went. */
export async function pruneDiagnosticReports(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DIAGNOSTIC_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.diagnosticReport.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return count
}
