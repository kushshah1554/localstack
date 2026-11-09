import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PDFDocument } from 'pdf-lib';

// The Lambda runtime provides the AWS SDK. LocalStack sets AWS_ENDPOINT_URL, so this also works locally.
const s3 = new S3Client({ forcePathStyle: true });

// Input: { bucket, sourceKey, targetKey }. Reads the PDF, compresses it, writes it to targetKey.
// shortcut: pdf-lib only repacks the file structure (lossless) and does not shrink images inside it;
// use a Ghostscript Lambda layer if scanned or image-heavy PDFs must get much smaller.
export async function handler({ bucket, sourceKey, targetKey }) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
  const original = await Body.transformToByteArray();

  let compressed;
  try {
    // pdf-lib reads damaged files loosely and often only fails while saving, so both are inside the try.
    const pdf = await PDFDocument.load(original);
    compressed = await pdf.save({ useObjectStreams: true });
  } catch {
    // Damaged or password-protected file: the caller's fault, not a Lambda failure.
    return { error: 'INVALID_PDF' };
  }

  // Some PDFs are already optimised, so never store a bigger file.
  const body = compressed.length < original.length ? compressed : original;

  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: targetKey, Body: body, ContentType: 'application/pdf' })
  );
  return { size: body.length, originalSize: original.length };
}
