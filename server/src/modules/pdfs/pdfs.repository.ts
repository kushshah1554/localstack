import { db } from '../../config/db.ts';

export interface PdfRecord {
  _id: string;
  // File name from the user's computer, shown in the list and used for downloads.
  name: string;
  bucket: string;
  key: string;
  // Bytes after compression, and before.
  size: number;
  originalSize: number;
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

export async function deletePdfRecord(id: string) {
  await pdfs.deleteOne({ _id: id });
}
