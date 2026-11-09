import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { invokeLambda } from '../lambda/lambda.client.ts';
import { bucket, s3 } from '../s3/s3.client.ts';
import { signUrl } from '../s3/s3.signer.ts';
import { deletePdfRecord, findPdfRecord, insertPdfRecord, listPdfRecords } from './pdfs.repository.ts';

const COMPRESS_FUNCTION = 'compress-pdf';

type CompressResult = { size: number; originalSize: number } | { error: 'INVALID_PDF' };

function deleteFromS3(key: string) {
  return s3
    .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    .catch((err) => console.error('Could not delete', key, err));
}

// 1. Upload the original to S3.  2. The Lambda compresses it into its final key.
// 3. Save the Mongo record.  The original is always removed at the end.
// The Lambda gets S3 keys, not the file, because a Lambda call can carry at most 6 MB.
export async function savePdf(id: string, name: string, body: Buffer) {
  const rawKey = `pdfs/raw/${id}`;
  const key = `pdfs/${id}`;

  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: rawKey, Body: body, ContentType: 'application/pdf' })
  );

  try {
    const result = await invokeLambda<CompressResult>(COMPRESS_FUNCTION, {
      bucket,
      sourceKey: rawKey,
      targetKey: key,
    });
    if ('error' in result) {
      throw Object.assign(new Error('Could not read this PDF. It may be damaged or password-protected.'), {
        status: 422,
      });
    }

    try {
      await insertPdfRecord({ _id: id, name, bucket, key, ...result, createdAt: new Date() });
    } catch (err) {
      // Without a record nobody can find the file, so don't leave it in S3.
      await deleteFromS3(key);
      throw err;
    }
    return result;
  } finally {
    await deleteFromS3(rawKey);
  }
}

// Links are only signed for PDFs that have a Mongo record. Bucket and key stay internal.
export async function listPdfs() {
  const records = await listPdfRecords();
  return Promise.all(
    records.map(async (record) => {
      // PDFs uploaded before names were stored have none, so fall back to the id.
      const name = record.name ?? record._id;
      return {
        id: record._id,
        name,
        size: record.size,
        originalSize: record.originalSize,
        createdAt: record.createdAt,
        url: await signUrl(record),
        downloadUrl: await signUrl(record, name),
      };
    })
  );
}

// S3 goes first: if the Mongo delete then fails, deleting again still works, and no hidden file is left behind.
export async function deletePdf(id: string) {
  const record = await findPdfRecord(id);
  if (!record) return false;

  await s3.send(new DeleteObjectCommand({ Bucket: record.bucket, Key: record.key }));
  await deletePdfRecord(id);
  return true;
}
