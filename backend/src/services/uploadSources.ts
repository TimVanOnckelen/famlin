import path from 'path';
import { uploadsDir } from '../config.js';

// New originals retain their name under originals/<upload-id>/<name>.
// Existing originals/<upload-id>.<ext> remain readable through the same field.
export function uploadSourcePath(sourceFilename: string): string {
  const root = path.join(uploadsDir, 'originals');
  const resolved = path.resolve(root, sourceFilename);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid upload source path');
  }
  return resolved;
}
