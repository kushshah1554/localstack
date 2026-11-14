import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { PageQuery } from '../../pagination.ts';
import {
  deleteImageRecord,
  findImageRecord,
  insertImageRecord,
  listImageRecords,
} from './images.repository.ts';
import { bucket, s3 } from './s3.client.ts';
import { signUrl } from './s3.signer.ts';

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

// Links are only signed for images that have a Mongo record, and only for the requested page. Bucket and key stay internal.
export async function listImages({ page, limit, skip }: PageQuery) {
  const { records, total } = await listImageRecords(skip, limit);
  const items = await Promise.all(
    records.map(async (record) => ({
      id: record._id,
      contentType: record.contentType,
      size: record.size,
      createdAt: record.createdAt,
      url: await signUrl(record),
      downloadUrl: await signUrl(record, record._id),
    }))
  );
  return { items, total, page, limit };
}

// S3 goes first: if the Mongo delete then fails, deleting again still works, and no hidden file is left behind.
export async function deleteImage(id: string) {
  const record = await findImageRecord(id);
  if (!record) return false;

  await s3.send(new DeleteObjectCommand({ Bucket: record.bucket, Key: record.key }));
  await deleteImageRecord(id);
  return true;
}
