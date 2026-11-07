import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is not set');

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

// Uses the database named in MONGO_URI.
export const db = client.db();

export async function connectDb() {
  await client.connect();
}

export async function closeDb() {
  await client.close();
}
