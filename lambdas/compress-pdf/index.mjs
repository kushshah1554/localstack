import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PDFDocument } from 'pdf-lib';

// The Lambda runtime provides the AWS SDK. LocalStack sets AWS_ENDPOINT_URL, so this also works locally.
const s3 = new S3Client({ forcePathStyle: true });
const sqs = new SQSClient({});

// Started by SQS with jobs from the pdf-compress queue: { id, bucket, sourceKey, targetKey }.
// Throwing makes SQS retry the job; after 3 tries it goes to the dead-letter queue.
export async function handler(event) {
  for (const record of event.Records) {
    const job = JSON.parse(record.body);
    const result = await compress(job);
    if (!result) continue;

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.RESULTS_QUEUE_URL,
        MessageBody: JSON.stringify({ id: job.id, ...result }),
      })
    );
    // Deleted last, so a crash before this point leaves the original for the retry.
    await s3.send(new DeleteObjectCommand({ Bucket: job.bucket, Key: job.sourceKey }));
  }
}

// Reads the PDF, compresses it, writes it to targetKey.
// shortcut: pdf-lib only repacks the file structure (lossless) and does not shrink images inside it;
// use a Ghostscript Lambda layer if scanned or image-heavy PDFs must get much smaller.
async function compress({ bucket, sourceKey, targetKey }) {
  let original;
  try {
    const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
    original = await Body.transformToByteArray();
  } catch (err) {
    // SQS can deliver a job twice. No original means it was already done, so skip it.
    if (err instanceof NoSuchKey) return null;
    throw err;
  }

  let compressed;
  try {
    // pdf-lib reads damaged files loosely and often only fails while saving, so both are inside the try.
    const pdf = await PDFDocument.load(original);
    compressed = await pdf.save({ useObjectStreams: true });
  } catch {
    // Damaged or password-protected file: the user's fault, so report it instead of retrying.
    return { error: 'INVALID_PDF' };
  }

  // Some PDFs are already optimised, so never store a bigger file.
  const body = compressed.length < original.length ? compressed : original;
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: targetKey, Body: body, ContentType: 'application/pdf' })
  );
  return { size: body.length };
}
