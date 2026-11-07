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

// shortcut: returns every record, add pagination once there are thousands of images.
export function listImageRecords() {
  return images.find().sort({ createdAt: -1 }).toArray();
}

export async function deleteImageRecord(id: string) {
  await images.deleteOne({ _id: id });
}
