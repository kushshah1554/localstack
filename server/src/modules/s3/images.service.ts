import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { findImageRecord, insertImageRecord } from './images.repository.ts';
import { bucket, s3 } from './s3.client.ts';

// Keeps images apart from anything else stored in the bucket.
const prefix = 'images/';

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

// Returns null when Mongo has no record, so only uploaded images can be read from the bucket.
export async function getImage(id: string) {
  const record = await findImageRecord(id);
  if (!record) return null;

  const file = await s3.send(new GetObjectCommand({ Bucket: record.bucket, Key: record.key }));
  return { record, file };
}
