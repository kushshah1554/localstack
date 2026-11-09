import { db } from '../../config/db.ts';

export interface PdfRecord {
  _id: string;
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
