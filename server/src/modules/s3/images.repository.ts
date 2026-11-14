import { db } from '../../config/db.ts';

export interface ImageRecord {
  _id: string;
  bucket: string;
  key: string;
  contentType: string;
  size: number;
  createdAt: Date;
}

const images = db.collection<ImageRecord>('images');

export async function insertImageRecord(record: ImageRecord) {
  await images.insertOne(record);
}

export function findImageRecord(id: string) {
  return images.findOne({ _id: id });
}

// Newest first; _id breaks ties so uploads made in the same millisecond keep a stable order across pages.
export async function listImageRecords(skip: number, limit: number) {
  const [records, total] = await Promise.all([
    images.find().sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
    images.countDocuments(),
  ]);
  return { records, total };
}

export async function deleteImageRecord(id: string) {
  await images.deleteOne({ _id: id });
}
