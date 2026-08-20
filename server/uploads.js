import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const uploadsRoot = path.resolve(process.env.SITE_UPLOAD_DIR || './data/uploads');

const ALLOWED_LOGOS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

export async function saveWebsiteLogo({ websiteId, contentType, buffer }) {
  const extension = ALLOWED_LOGOS.get(String(contentType || '').toLowerCase());
  if (!extension) {
    const error = new Error('Logo must be a PNG, JPEG, or WebP image.');
    error.status = 400;
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    const error = new Error('The uploaded logo file is empty or invalid.');
    error.status = 400;
    throw error;
  }
  if (buffer.length > 2 * 1024 * 1024) {
    const error = new Error('Logo must be 2 MB or smaller.');
    error.status = 413;
    throw error;
  }

  const folder = path.join(uploadsRoot, 'logos', String(websiteId));
  await fs.mkdir(folder, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
  const absolutePath = path.join(folder, filename);
  await fs.writeFile(absolutePath, buffer, { flag: 'wx', mode: 0o640 });

  const relativePath = `logos/${websiteId}/${filename}`;
  const base = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  return base ? new URL(`/uploads/${relativePath}`, base).toString() : `/uploads/${relativePath}`;
}
