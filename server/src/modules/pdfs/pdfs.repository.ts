import { db } from '../../config/db.ts';

// processing: waiting in the queue or being compressed. ready: compressed file is in S3.
// failed: the PDF could not be compressed (damaged, password-protected, or the job kept failing).
export type PdfStatus = 'processing' | 'ready' | 'failed';

export interface PdfRecord {
  _id: string;
  // File name from the user's computer, shown in the list and used for downloads.
  name: string;
  bucket: string;
  key: string;
  status: PdfStatus;
  // Bytes before compression, and after (set once ready).
  originalSize: number;
  size?: number;
  createdAt: Date;
  // Set once the compression job is on the queue. Missing on a processing record means the server
  // stopped before sending it, and the worker sends it again at startup.
  queued?: boolean;
}

export const pdfs = db.collection<PdfRecord>('pdfs');

export async function insertPdfRecord(record: PdfRecord) {
  await pdfs.insertOne(record);
}

export async function markPdfQueued(id: string) {
  await pdfs.updateOne({ _id: id }, { $set: { queued: true } });
}

export function findUnqueuedPdfRecords() {
  return pdfs.find({ status: 'processing', queued: { $ne: true } }).toArray();
}

export function findPdfRecord(id: string) {
  return pdfs.findOne({ _id: id });
}

// Newest first; _id breaks ties so uploads made in the same millisecond keep a stable order across pages.
export async function listPdfRecords(skip: number, limit: number) {
  const [records, total] = await Promise.all([
    pdfs.find().sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
    pdfs.countDocuments(),
  ]);
  return { records, total };
}

// Only a PDF that is still processing changes, so a late or repeated message can't undo a finished one.
// Returns false when no such record exists (for example, it was deleted while processing).
export async function finishPdfRecord(id: string, update: { status: 'ready'; size: number } | { status: 'failed' }) {
  const result = await pdfs.updateOne({ _id: id, status: 'processing' }, { $set: update });
  return result.matchedCount === 1;
}

export async function deletePdfRecord(id: string) {
  await pdfs.deleteOne({ _id: id });
}
