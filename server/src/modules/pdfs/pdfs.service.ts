import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { PageQuery } from '../../pagination.ts';
import { bucket, s3 } from '../s3/s3.client.ts';
import { signUrl } from '../s3/s3.signer.ts';
import { sendMessage } from '../sqs/sqs.client.ts';
import {
  deletePdfRecord,
  findPdfRecord,
  findUnqueuedPdfRecords,
  finishPdfRecord,
  insertPdfRecord,
  listPdfRecords,
  markPdfQueued,
} from './pdfs.repository.ts';

// Created by lambdas/compress-pdf/deploy.sh.
export const COMPRESS_QUEUE = 'pdf-compress';
export const RESULTS_QUEUE = 'pdf-results';
export const COMPRESS_DLQ = 'pdf-compress-dlq';

// Sent to the job queue; the Lambda reads it.
export interface CompressJob {
  id: string;
  bucket: string;
  sourceKey: string;
  targetKey: string;
}

// Sent by the Lambda to the results queue.
export type CompressResult = { id: string; size: number } | { id: string; error: 'INVALID_PDF' };

function deleteFromS3(key: string) {
  return s3
    .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    .catch((err) => console.error('Could not delete', key, err));
}

// 1. Upload the original to S3.  2. Save the record as "processing".  3. Queue the compression job.
// The user gets an answer now; the Lambda compresses in the background (see handleCompressResult).
export async function savePdf(id: string, name: string, body: Buffer) {
  const job: CompressJob = { id, bucket, sourceKey: `pdfs/raw/${id}`, targetKey: `pdfs/${id}` };

  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: job.sourceKey, Body: body, ContentType: 'application/pdf' })
  );

  try {
    await insertPdfRecord({
      _id: id,
      name,
      bucket,
      key: job.targetKey,
      status: 'processing',
      originalSize: body.length,
      createdAt: new Date(),
    });
  } catch (err) {
    await deleteFromS3(job.sourceKey);
    throw err;
  }

  try {
    await sendMessage(COMPRESS_QUEUE, job);
  } catch (err) {
    // Without a job the record would say "processing" forever, so undo both.
    await deletePdfRecord(id);
    await deleteFromS3(job.sourceKey);
    throw err;
  }

  // The job is already sent, so a failure here only means it is sent once more at the next startup (harmless).
  await markPdfQueued(id).catch((err) => console.error('Could not mark PDF queued', id, err));
}

// A server that dies between saving the record and sending the job leaves the PDF "processing" forever.
// Sending a job twice is safe: the Lambda skips a job whose original is already gone, and a record only finishes once.
export async function requeueUnsentJobs() {
  for (const record of await findUnqueuedPdfRecords()) {
    const job: CompressJob = { id: record._id, bucket: record.bucket, sourceKey: `pdfs/raw/${record._id}`, targetKey: record.key };
    await sendMessage(COMPRESS_QUEUE, job);
    await markPdfQueued(record._id);
    console.log('Re-sent compression job left unsent by a crash', record._id);
  }
}

// From the results queue. The Lambda has already removed the original.
export async function handleCompressResult(result: CompressResult) {
  const found =
    'error' in result
      ? await finishPdfRecord(result.id, { status: 'failed' })
      : await finishPdfRecord(result.id, { status: 'ready', size: result.size });

  // Deleted while it was processing: the compressed file has no record, so remove it.
  if (!found && !(await findPdfRecord(result.id))) await deleteFromS3(`pdfs/${result.id}`);
}

// From the dead-letter queue: the Lambda crashed on this job every time it was tried.
export async function handleFailedJob(job: CompressJob) {
  console.error('PDF compression kept failing, marking it failed', job.id);
  await finishPdfRecord(job.id, { status: 'failed' });
  await deleteFromS3(job.sourceKey);
}

// Links are only signed for PDFs that are ready, and only for the requested page. Bucket and key stay internal.
export async function listPdfs({ page, limit, skip }: PageQuery) {
  const { records, total } = await listPdfRecords(skip, limit);
  const items = await Promise.all(
    records.map(async (record) => {
      // PDFs uploaded before names were stored have none, so fall back to the id.
      const name = record.name ?? record._id;
      // PDFs uploaded before the queue existed have no status but are compressed.
      const status = record.status ?? 'ready';
      const ready = status === 'ready';
      return {
        id: record._id,
        name,
        status,
        size: record.size,
        originalSize: record.originalSize,
        createdAt: record.createdAt,
        url: ready ? await signUrl(record) : undefined,
        downloadUrl: ready ? await signUrl(record, name) : undefined,
      };
    })
  );
  return { items, total, page, limit };
}

// S3 goes first: if the Mongo delete then fails, deleting again still works, and no hidden file is left behind.
export async function deletePdf(id: string) {
  const record = await findPdfRecord(id);
  if (!record) return false;

  await s3.send(new DeleteObjectCommand({ Bucket: record.bucket, Key: record.key }));
  await deletePdfRecord(id);
  return true;
}
