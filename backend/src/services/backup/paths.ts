import path from 'path'
import { backupsDir } from '../../config.js'

// Layout of the backups volume (issue #461):
//   <backupsDir>/famlin-backup-<timestamp>.zip  — Famlin backups (export.ts
//                                                format, data only; their
//                                                media live in the mirror)
//   <backupsDir>/uploads/                       — one incremental media mirror
//   <backupsDir>/db/famlin-<timestamp>.dump      — legacy pg_dump safety net
// Its own module so import.ts can find the mirror without importing the
// backup job (which imports export.ts).
export const BACKUP_ARCHIVE_DIR = backupsDir
export const BACKUP_DB_DIR = path.join(backupsDir, 'db')
export const BACKUP_UPLOADS_DIR = path.join(backupsDir, 'uploads')
