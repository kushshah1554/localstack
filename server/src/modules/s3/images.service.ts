import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  deleteImageRecord,
  findImageRecord,
  insertImageRecord,
  listImageRecords,
  type ImageRecord,
} from './images.repository.ts';
import { bucket, s3 } from './s3.client.ts';

// Keeps images apart from anything else stored in the bucket.
const prefix = 'images/';

const HOUR_IN_SECONDS = 60 * 60;

// S3 goes first so a Mongo record never points at a file that was not stored.
export async function saveImage(id: string, body: Buffer, contentType: string) {
  const key = prefix + id;
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
  );

  try {
    await insertImageRecord({
      _id: id,
      bucket,
      key,
      contentType,
      size: body.length,
      createdAt: new Date(),
    });
  } catch (err) {
    // Without a record the file could never be downloaded, so don't leave it in S3.
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch((cleanupErr) => console.error('Could not delete orphaned image', key, cleanupErr));
    throw err;
  }
}

// Signing from the start of the hour keeps a link identical for that whole hour, so the
// browser can reuse its cached image. Lasting 2 hours means every link has at least 1 hour left.
function signUrl(record: ImageRecord, asDownload: boolean) {
  const signingDate = new Date();
  signingDate.setUTCMinutes(0, 0, 0);

  const command = new GetObjectCommand({
    Bucket: record.bucket,
    Key: record.key,
    // Files never change under the same id, so the browser may keep them.
    ResponseCacheControl: 'private, max-age=31536000, immutable',
    ResponseContentDisposition: asDownload ? `attachment; filename="${record._id}"` : undefined,
  });
  return getSignedUrl(s3, command, { signingDate, expiresIn: 2 * HOUR_IN_SECONDS });
}

// Links are only signed for images that have a Mongo record. Bucket and key stay internal.
export async function listImages() {
  const records = await listImageRecords();
  return Promise.all(
    records.map(async (record) => ({
      id: record._id,
      contentType: record.contentType,
      size: record.size,
      createdAt: record.createdAt,
      url: await signUrl(record, false),
      downloadUrl: await signUrl(record, true),
    }))
  );
}

// S3 goes first: if the Mongo delete then fails, deleting again still works, and no hidden file is left behind.
export async function deleteImage(id: string) {
  const record = await findImageRecord(id);
  if (!record) return false;

  await s3.send(new DeleteObjectCommand({ Bucket: record.bucket, Key: record.key }));
  await deleteImageRecord(id);
  return true;
}
