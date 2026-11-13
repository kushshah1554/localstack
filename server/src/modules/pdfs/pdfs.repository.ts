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
}

export const pdfs = db.collection<PdfRecord>('pdfs');

export async function insertPdfRecord(record: PdfRecord) {
  await pdfs.insertOne(record);
}

export function findPdfRecord(id: string) {
  return pdfs.findOne({ _id: id });
}

// shortcut: returns every record, add pagination once there are thousands of PDFs.
export function listPdfRecords() {
  return pdfs.find().sort({ createdAt: -1 }).toArray();
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
