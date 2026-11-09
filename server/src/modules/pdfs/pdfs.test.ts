// Needs LocalStack with the bucket and the compress-pdf Lambda (lambdas/compress-pdf/deploy.sh), and MongoDB.
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test, type TestContext } from 'node:test';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Collection } from 'mongodb';
import { app } from '../../app.ts';
import { closeDb, connectDb } from '../../config/db.ts';
import { bucket, s3 } from '../s3/s3.client.ts';
import { pdfs } from './pdfs.repository.ts';

let server: Server;
let api: string;

before(async () => {
  await connectDb();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  api = `http://localhost:${(server.address() as AddressInfo).port}/api/pdfs`;
});

after(async () => {
  server.close();
  await closeDb();
});

// A valid, uncompressed PDF with one text page per entry, built by hand.
function makePdf(pageCount: number) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = objects.length + 1;
    const text = `BT /F1 24 Tf 72 720 Td (Page ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`);
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(`${page} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

function upload(body: string, contentType = 'application/pdf', name = 'upload.pdf') {
  const form = new FormData();
  form.append('pdf', new Blob([body], { type: contentType }), name);
  return fetch(api, { method: 'POST', body: form });
}

interface ListedPdf {
  id: string;
  name: string;
  size: number;
  url: string;
  downloadUrl: string;
}

async function list(): Promise<ListedPdf[]> {
  return (await fetch(api)).json();
}

async function uploadPdf(t: TestContext, name?: string): Promise<string> {
  const { id } = await (await upload(makePdf(3), 'application/pdf', name)).json();
  t.after(async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `pdfs/${id}` }));
    await pdfs.deleteOne({ _id: id });
  });
  return id;
}

async function listPdfKeys() {
  const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'pdfs/' }));
  return Contents.map((object) => object.Key);
}

test('upload compresses the PDF with the Lambda, stores it in S3 and saves the record', async (t) => {
  const original = makePdf(30);

  const res = await upload(original);
  assert.equal(res.status, 201);
  const { id, size, originalSize } = await res.json();
  t.after(async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `pdfs/${id}` }));
    await pdfs.deleteOne({ _id: id });
  });

  assert.equal(originalSize, original.length);
  assert.ok(size < originalSize, `expected ${size} < ${originalSize}`);

  const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `pdfs/${id}` }));
  const bytes = await stored.Body!.transformToByteArray();
  assert.equal(bytes.length, size);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');

  const record = await pdfs.findOne({ _id: id });
  assert.equal(record?.key, `pdfs/${id}`);
  assert.equal(record?.size, size);
  assert.equal(record?.originalSize, originalSize);
  assert.ok(!(await listPdfKeys()).includes(`pdfs/raw/${id}`), 'original upload is removed');
});

test('rejects files that are not PDFs', async () => {
  assert.equal((await upload('hello', 'text/plain')).status, 415);
  assert.equal((await upload('hello', 'application/pdf')).status, 415);
});

test('a damaged PDF gets 422 and leaves nothing behind', async () => {
  const keysBefore = await listPdfKeys();
  const countBefore = await pdfs.countDocuments();

  const res = await upload('%PDF-1.4 this is not really a pdf');

  assert.equal(res.status, 422);
  assert.deepEqual(await listPdfKeys(), keysBefore);
  assert.equal(await pdfs.countDocuments(), countBefore);
});

test('a failed Mongo insert removes both files from S3', async (t) => {
  const keysBefore = await listPdfKeys();
  t.mock.method(Collection.prototype, 'insertOne', async () => {
    throw new Error('simulated Mongo failure');
  });
  t.mock.method(console, 'error', () => {});

  const res = await upload(makePdf(3));

  assert.equal(res.status, 500);
  assert.deepEqual(await listPdfKeys(), keysBefore);
});

test('list returns PDFs newest first, with signed links to view and download', async (t) => {
  const first = await uploadPdf(t);
  await new Promise((resolve) => setTimeout(resolve, 5)); // distinct createdAt, so the order is stable
  const second = await uploadPdf(t, 'résumé "final".pdf');

  const items = await list();
  const ids = items.map((item) => item.id);
  assert.ok(ids.indexOf(first) >= 0);
  assert.ok(ids.indexOf(second) < ids.indexOf(first));

  const pdf = items.find((item) => item.id === second)!;
  assert.deepEqual(Object.keys(pdf).sort(), ['createdAt', 'downloadUrl', 'id', 'name', 'originalSize', 'size', 'url']);
  assert.equal(pdf.name, 'résumé "final".pdf');

  const view = await fetch(pdf.url);
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('content-type'), 'application/pdf');
  assert.equal(view.headers.get('content-disposition'), null);
  assert.equal((await view.arrayBuffer()).byteLength, pdf.size);

  const download = await fetch(pdf.downloadUrl);
  assert.equal(
    download.headers.get('content-disposition'),
    `attachment; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf`
  );
});

test('delete removes the PDF from S3 and Mongo', async (t) => {
  const id = await uploadPdf(t);
  const pdf = (await list()).find((item) => item.id === id)!;

  assert.equal((await fetch(`${api}/${id}`, { method: 'DELETE' })).status, 204);

  assert.equal(await pdfs.findOne({ _id: id }), null);
  assert.ok(!(await listPdfKeys()).includes(`pdfs/${id}`));
  assert.ok(!(await list()).some((item) => item.id === id));
  assert.equal((await fetch(pdf.url)).status, 404);
});

test('delete returns 404 for unknown ids', async () => {
  const missing = '00000000-0000-0000-0000-000000000000.pdf';
  assert.equal((await fetch(`${api}/${missing}`, { method: 'DELETE' })).status, 404);
});
