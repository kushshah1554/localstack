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
