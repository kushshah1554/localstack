// Needs LocalStack with the bucket created, and MongoDB at MONGO_URI.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test, type TestContext } from 'node:test';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Collection } from 'mongodb';
import { app } from '../../app.ts';
import { closeDb, connectDb, db } from '../../config/db.ts';
import type { ImageRecord } from './images.repository.ts';
import { bucket, s3 } from './s3.client.ts';

interface ListedImage {
  id: string;
  size: number;
  url: string;
  downloadUrl: string;
}

const records = db.collection<ImageRecord>('images');
let server: Server;
let api: string;

before(async () => {
  await connectDb();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  api = `http://localhost:${(server.address() as AddressInfo).port}/api/s3/images`;
});

after(async () => {
  server.close();
  await closeDb();
});

function upload(body: Uint8Array<ArrayBuffer> | string, contentType: string, field = 'image') {
  const form = new FormData();
  form.append(field, new Blob([body], { type: contentType }), 'upload');
  return fetch(api, { method: 'POST', body: form });
}

async function uploadPng(t: TestContext, bytes = new Uint8Array([1, 2, 3])): Promise<string> {
  const { id } = await (await upload(bytes, 'image/png')).json();
  removeAfterTest(t, id);
  return id;
}

function removeAfterTest(t: TestContext, id: string) {
  t.after(async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `images/${id}` }));
    await records.deleteOne({ _id: id });
  });
}

// Newest first, so the images a test just uploaded are on the first page.
async function list(): Promise<ListedImage[]> {
  return (await (await fetch(`${api}?limit=100`)).json()).items;
}

test('list is paged newest first, and bad page values fall back to defaults', async (t) => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await uploadPng(t));
    await new Promise((resolve) => setTimeout(resolve, 5)); // distinct createdAt
  }
  const [oldest, middle, newest] = ids;

  const page1 = await (await fetch(`${api}?page=1&limit=2`)).json();
  assert.deepEqual(page1.items.map((image: ListedImage) => image.id), [newest, middle]);
  assert.equal(page1.page, 1);
  assert.equal(page1.limit, 2);
  assert.ok(page1.total >= 3);

  const page2 = await (await fetch(`${api}?page=2&limit=2`)).json();
  assert.equal(page2.items[0].id, oldest);

  const fallback = await (await fetch(`${api}?page=abc&limit=-5`)).json();
  assert.equal(fallback.page, 1);
  assert.equal(fallback.limit, 20);
  assert.equal((await (await fetch(`${api}?limit=5000`)).json()).limit, 100);
});

async function listImageKeys() {
  const { Contents = [] } = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: 'images/' })
  );
  return Contents.map((object) => object.Key);
}

test('upload stores the file in S3 and its record in Mongo', async (t) => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  const created = await upload(bytes, 'image/png');
  assert.equal(created.status, 201);
  const { id } = await created.json();
  removeAfterTest(t, id);

  const record = await records.findOne({ _id: id });
  assert.equal(record?.bucket, bucket);
  assert.equal(record?.key, `images/${id}`);
  assert.equal(record?.contentType, 'image/png');
  assert.equal(record?.size, bytes.length);
  assert.ok(record?.createdAt instanceof Date);
  assert.ok((await listImageKeys()).includes(`images/${id}`));
});

test('the signed url shows the image straight from S3, and the browser may cache it', async (t) => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);
  const id = await uploadPng(t, bytes);
  const image = (await list()).find((item) => item.id === id);

  const res = await fetch(image!.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(res.headers.get('content-disposition'), null);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
});

test('the signed download url makes S3 send the file as a download', async (t) => {
  const id = await uploadPng(t);
  const image = (await list()).find((item) => item.id === id);

  const res = await fetch(image!.downloadUrl);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get('content-disposition'),
    `attachment; filename="${id}"; filename*=UTF-8''${id}`
  );
});

test('links stay the same within the hour and last 2 hours', async (t) => {
  const id = await uploadPng(t);
  const first = (await list()).find((item) => item.id === id)!;
  const second = (await list()).find((item) => item.id === id)!;

  // Same link means the browser reuses its cached copy instead of downloading again.
  assert.equal(first.url, second.url);
  assert.equal(first.downloadUrl, second.downloadUrl);
  assert.equal(new URL(first.url).searchParams.get('X-Amz-Expires'), '7200');
  assert.notEqual(first.url, first.downloadUrl);
});

test('list returns images newest first, without internal S3 details', async (t) => {
  const first = await uploadPng(t, new Uint8Array([1]));
  await new Promise((resolve) => setTimeout(resolve, 5)); // distinct createdAt, so the order is stable
  const second = await uploadPng(t, new Uint8Array([2, 2]));

  const images = await list();
  const ids = images.map((image) => image.id);
  assert.ok(ids.indexOf(first) >= 0);
  assert.ok(ids.indexOf(second) < ids.indexOf(first));

  const image = images.find((item) => item.id === second);
  assert.deepEqual(Object.keys(image ?? {}).sort(), [
    'contentType',
    'createdAt',
    'downloadUrl',
    'id',
    'size',
    'url',
  ]);
  assert.equal(image?.size, 2);
});

test('a file in S3 without a Mongo record is never listed', async (t) => {
  const id = `${randomUUID()}.png`;
  removeAfterTest(t, id);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `images/${id}`, Body: 'orphan' }));

  assert.ok(!(await list()).some((image) => image.id === id));
});

test('delete removes the file from S3 and the record from Mongo', async (t) => {
  const id = await uploadPng(t);
  const image = (await list()).find((item) => item.id === id)!;

  const res = await fetch(`${api}/${id}`, { method: 'DELETE' });
  assert.equal(res.status, 204);

  assert.equal(await records.findOne({ _id: id }), null);
  assert.ok(!(await listImageKeys()).includes(`images/${id}`));
  assert.ok(!(await list()).some((item) => item.id === id));
  assert.equal((await fetch(image.url)).status, 404);
});

test('delete returns 404 for unknown ids and files outside images/', async () => {
  const missing = '00000000-0000-0000-0000-000000000000.png';
  assert.equal((await fetch(`${api}/${missing}`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${api}/hello.txt`, { method: 'DELETE' })).status, 404);
});

test('a failed Mongo insert removes the file from S3', async (t) => {
  const keysBefore = await listImageKeys();
  t.mock.method(Collection.prototype, 'insertOne', async () => {
    throw new Error('simulated Mongo failure');
  });
  t.mock.method(console, 'error', () => {});

  const res = await upload(new Uint8Array([1, 2, 3]), 'image/png');

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Internal server error' });
  assert.deepEqual(await listImageKeys(), keysBefore);
});

test('rejects files that are not allowed images', async () => {
  assert.equal((await upload('<svg></svg>', 'image/svg+xml')).status, 415);
  assert.equal((await upload('hello', 'text/plain')).status, 415);
});

test('rejects empty and oversized images', async () => {
  assert.equal((await upload(new Uint8Array(), 'image/png')).status, 400);

  const tooBig = await upload(new Uint8Array(10 * 1024 * 1024 + 1), 'image/png');
  assert.equal(tooBig.status, 413);
  assert.deepEqual(Object.keys(await tooBig.json()), ['error']);
});

test('rejects requests that are not a valid image form', async () => {
  const png = new Uint8Array([1, 2, 3]);
  const multipart = { 'Content-Type': 'multipart/form-data; boundary=x' };

  // Wrong field name
  assert.equal((await upload(png, 'image/png', 'photo')).status, 400);
  // Raw body instead of a form
  const raw = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
  assert.equal(raw.status, 400);
  // Form with no file
  const empty = await fetch(api, { method: 'POST', body: new FormData() });
  assert.equal(empty.status, 400);
  // Truncated multipart body
  const truncated = await fetch(api, { method: 'POST', headers: multipart, body: '--x\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc' });
  assert.equal(truncated.status, 400);
});
