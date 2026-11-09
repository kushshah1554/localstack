import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from './s3.client.ts';

const HOUR_IN_SECONDS = 60 * 60;

// Header that makes the browser save the file. The plain name is for old browsers;
// filename* keeps non-English names intact.
function attachment(name: string) {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

// A temporary link straight to the S3 file. With downloadName, S3 sends it as a download.
// Signing from the start of the hour keeps a link identical for that whole hour, so the
// browser can reuse its cached copy. Lasting 2 hours means every link has at least 1 hour left.
export function signUrl(file: { bucket: string; key: string }, downloadName?: string) {
  const signingDate = new Date();
  signingDate.setUTCMinutes(0, 0, 0);

  const command = new GetObjectCommand({
    Bucket: file.bucket,
    Key: file.key,
    // Files never change under the same id, so the browser may keep them.
    ResponseCacheControl: 'private, max-age=31536000, immutable',
    ResponseContentDisposition: downloadName ? attachment(downloadName) : undefined,
  });
  return getSignedUrl(s3, command, { signingDate, expiresIn: 2 * HOUR_IN_SECONDS });
}
