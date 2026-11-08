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

function removeAfterTest(t: TestContext, id: string) {
  t.after(async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `images/${id}` }));
    await records.deleteOne({ _id: id });
  });
}

async function listImageKeys() {
  const { Contents = [] } = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: 'images/' })
  );
  return Contents.map((object) => object.Key);
}

test('upload stores the file in S3 and its record in Mongo, then downloads unchanged', async (t) => {
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

  const downloaded = await fetch(`${api}/${id}`);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.match(downloaded.headers.get('content-disposition') ?? '', /^attachment/);
  assert.equal(downloaded.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
});

test('list returns images newest first, without internal S3 details', async (t) => {
  const first = (await (await upload(new Uint8Array([1]), 'image/png')).json()).id;
  removeAfterTest(t, first);
  await new Promise((resolve) => setTimeout(resolve, 5)); // distinct createdAt, so the order is stable
  const second = (await (await upload(new Uint8Array([2, 2]), 'image/gif')).json()).id;
  removeAfterTest(t, second);

  const res = await fetch(api);
  assert.equal(res.status, 200);
  const list: { id: string; size: number }[] = await res.json();
  const ids = list.map((image) => image.id);
  assert.ok(ids.indexOf(second) < ids.indexOf(first));
  assert.ok(ids.indexOf(first) >= 0);

  const image = list.find((item) => item.id === second);
  assert.deepEqual(Object.keys(image ?? {}).sort(), ['contentType', 'createdAt', 'id', 'size']);
  assert.equal(image?.size, 2);
});

test('delete removes the file from S3 and the record from Mongo', async (t) => {
  const { id } = await (await upload(new Uint8Array([1, 2, 3]), 'image/png')).json();
  removeAfterTest(t, id);

  const res = await fetch(`${api}/${id}`, { method: 'DELETE' });
  assert.equal(res.status, 204);

  assert.equal(await records.findOne({ _id: id }), null);
  assert.ok(!(await listImageKeys()).includes(`images/${id}`));
  assert.equal((await fetch(`${api}/${id}`)).status, 404);
  assert.ok(!(await (await fetch(api)).json()).some((image: { id: string }) => image.id === id));
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

test('a file in S3 without a Mongo record cannot be downloaded', async (t) => {
  const id = `${randomUUID()}.png`;
  removeAfterTest(t, id);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `images/${id}`, Body: 'orphan' }));

  assert.equal((await fetch(`${api}/${id}`)).status, 404);
});

test('a Mongo record whose S3 file is gone returns 404', async (t) => {
  const id = `${randomUUID()}.png`;
  removeAfterTest(t, id);
  await records.insertOne({
    _id: id,
    bucket,
    key: `images/${id}`,
    contentType: 'image/png',
    size: 1,
    createdAt: new Date(),
  });

  assert.equal((await fetch(`${api}/${id}`)).status, 404);
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
  // Raw body, the format this API used before multer
  const raw = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
  assert.equal(raw.status, 400);
  // Form with no file
  const empty = await fetch(api, { method: 'POST', body: new FormData() });
  assert.equal(empty.status, 400);
  // Truncated multipart body
  const truncated = await fetch(api, { method: 'POST', headers: multipart, body: '--x\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc' });
  assert.equal(truncated.status, 400);
});

test('download returns 404 for unknown ids and files outside images/', async () => {
  const missing = '00000000-0000-0000-0000-000000000000.png';
  const notFound = await fetch(`${api}/${missing}`);
  assert.equal(notFound.status, 404);
  // A 404 must not be cached, or an image could look missing after it exists.
  assert.equal(notFound.headers.get('cache-control'), null);
  assert.equal((await fetch(`${api}/hello.txt`)).status, 404);
  assert.equal((await fetch(`${api}/..%2Fhello.txt`)).status, 404);
});
