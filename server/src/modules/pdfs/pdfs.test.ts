// Needs LocalStack with the bucket, queues and Lambda (lambdas/compress-pdf/deploy.sh), and MongoDB.
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test, type TestContext } from 'node:test';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Collection } from 'mongodb';
import { app } from '../../app.ts';
import { closeDb, connectDb } from '../../config/db.ts';
import { bucket, s3 } from '../s3/s3.client.ts';
import { pdfs } from './pdfs.repository.ts';
import { handleCompressResult, handleFailedJob, requeueUnsentJobs } from './pdfs.service.ts';
import { startPdfWorker } from './pdfs.worker.ts';

let server: Server;
let api: string;
let stopWorker: () => Promise<void>;

before(async () => {
  await connectDb();
  stopWorker = startPdfWorker();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  api = `http://localhost:${(server.address() as AddressInfo).port}/api/pdfs`;
});

after(async () => {
  server.close();
  await stopWorker();
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

interface ListedPdf {
  id: string;
  name: string;
  status: 'processing' | 'ready' | 'failed';
  size?: number;
  originalSize: number;
  url?: string;
  downloadUrl?: string;
}

function upload(body: string, contentType = 'application/pdf', name = 'upload.pdf') {
  const form = new FormData();
  form.append('pdf', new Blob([body], { type: contentType }), name);
  return fetch(api, { method: 'POST', body: form });
}

function cleanUpAfter(t: TestContext, id: string) {
  t.after(async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `pdfs/${id}` }));
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `pdfs/raw/${id}` }));
    await pdfs.deleteOne({ _id: id });
  });
}

async function uploadPdf(t: TestContext, body = makePdf(3), name?: string): Promise<string> {
  const res = await upload(body, 'application/pdf', name);
  assert.equal(res.status, 202);
  const { id, status } = await res.json();
  assert.equal(status, 'processing');
  cleanUpAfter(t, id);
  return id;
}

// Newest first, so the PDFs a test just uploaded are on the first page.
async function list(): Promise<ListedPdf[]> {
  return (await (await fetch(`${api}?limit=100`)).json()).items;
}

// Compression runs in the background (SQS → Lambda → SQS → worker), so wait for it to finish.
async function waitUntilDone(id: string): Promise<ListedPdf> {
  for (let i = 0; i < 120; i++) {
    const pdf = (await list()).find((item) => item.id === id);
    if (pdf && pdf.status !== 'processing') return pdf;
    await sleep(250);
  }
  throw new Error(`PDF ${id} was still processing after 30 s`);
}

async function listPdfKeys() {
  const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'pdfs/' }));
  return Contents.map((object) => object.Key);
}

test('upload answers at once, then the queue and Lambda compress the PDF in the background', async (t) => {
  const original = makePdf(30);
  const id = await uploadPdf(t, original);

  const processing = (await list()).find((item) => item.id === id)!;
  assert.equal(processing.status, 'processing');
  assert.equal(processing.originalSize, original.length);
  assert.equal(processing.url, undefined);

  const pdf = await waitUntilDone(id);
  assert.equal(pdf.status, 'ready');
  assert.ok(pdf.size! < original.length, `expected ${pdf.size} < ${original.length}`);

  const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `pdfs/${id}` }));
  const bytes = await stored.Body!.transformToByteArray();
  assert.equal(bytes.length, pdf.size);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  assert.ok(!(await listPdfKeys()).includes(`pdfs/raw/${id}`), 'original upload is removed');
});

test('a damaged PDF ends up failed and leaves no files behind', async (t) => {
  const id = await uploadPdf(t, '%PDF-1.4 this is not really a pdf');

  const pdf = await waitUntilDone(id);
  assert.equal(pdf.status, 'failed');
  assert.equal(pdf.url, undefined);
  const keys = await listPdfKeys();
  assert.ok(!keys.includes(`pdfs/${id}`));
  assert.ok(!keys.includes(`pdfs/raw/${id}`));
});

test('rejects files that are not PDFs', async () => {
  assert.equal((await upload('hello', 'text/plain')).status, 415);
  assert.equal((await upload('hello', 'application/pdf')).status, 415);
});

test('a job left unsent by a server crash is sent again and the PDF still finishes', async (t) => {
  // The state a crash between saving the record and queueing the job leaves behind.
  const id = `crash-${Date.now()}.pdf`;
  cleanUpAfter(t, id);
  const original = makePdf(3);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `pdfs/raw/${id}`, Body: original }));
  await pdfs.insertOne({
    _id: id, name: 'crash.pdf', bucket, key: `pdfs/${id}`,
    status: 'processing', originalSize: original.length, createdAt: new Date(),
  });
  t.mock.method(console, 'log', () => {});

  await requeueUnsentJobs();

  assert.equal((await waitUntilDone(id)).status, 'ready');
  assert.equal((await pdfs.findOne({ _id: id }))?.queued, true);
});

test('a failed Mongo insert removes the original from S3', async (t) => {
  const keysBefore = await listPdfKeys();
  t.mock.method(Collection.prototype, 'insertOne', async () => {
    throw new Error('simulated Mongo failure');
  });
  t.mock.method(console, 'error', () => {});

  const res = await upload(makePdf(3));

  assert.equal(res.status, 500);
  assert.deepEqual(await listPdfKeys(), keysBefore);
});

test('list gives ready PDFs signed links to view and download', async (t) => {
  const id = await uploadPdf(t, makePdf(3), 'résumé "final".pdf');
  const pdf = await waitUntilDone(id);

  assert.deepEqual(Object.keys(pdf).sort(), [
    'createdAt',
    'downloadUrl',
    'id',
    'name',
    'originalSize',
    'size',
    'status',
    'url',
  ]);
  assert.equal(pdf.name, 'résumé "final".pdf');

  const view = await fetch(pdf.url!);
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('content-type'), 'application/pdf');
  assert.equal(view.headers.get('content-disposition'), null);
  assert.equal((await view.arrayBuffer()).byteLength, pdf.size);

  const download = await fetch(pdf.downloadUrl!);
  assert.equal(
    download.headers.get('content-disposition'),
    `attachment; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf`
  );
});

test('delete removes the PDF from S3 and Mongo', async (t) => {
  const id = await uploadPdf(t);
  const pdf = await waitUntilDone(id);

  assert.equal((await fetch(`${api}/${id}`, { method: 'DELETE' })).status, 204);

  assert.equal(await pdfs.findOne({ _id: id }), null);
  assert.ok(!(await listPdfKeys()).includes(`pdfs/${id}`));
  assert.equal((await fetch(pdf.url!)).status, 404);
});

test('delete returns 404 for unknown ids', async () => {
  const missing = '00000000-0000-0000-0000-000000000000.pdf';
  assert.equal((await fetch(`${api}/${missing}`, { method: 'DELETE' })).status, 404);
});

// The message handlers are tested directly, since these cases are hard to cause through SQS.
test('a result for a PDF deleted while processing removes the orphan file', async (t) => {
  const id = 'deleted-while-processing.pdf';
  cleanUpAfter(t, id);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `pdfs/${id}`, Body: 'x' }));

  await handleCompressResult({ id, size: 1 });

  assert.ok(!(await listPdfKeys()).includes(`pdfs/${id}`));
});

test('a late failure or repeated result never changes a finished PDF', async (t) => {
  const id = await uploadPdf(t);
  const ready = await waitUntilDone(id);
  t.mock.method(console, 'error', () => {});

  await handleFailedJob({ id, bucket, sourceKey: `pdfs/raw/${id}`, targetKey: `pdfs/${id}` });
  await handleCompressResult({ id, error: 'INVALID_PDF' });

  const record = await pdfs.findOne({ _id: id });
  assert.equal(record?.status, 'ready');
  assert.equal(record?.size, ready.size);
});
