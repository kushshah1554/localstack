// Reliability checks against the real stack (LocalStack + MongoDB).
// Starts its own server on PORT so it can crash it with SIGKILL. Stop any other backend first:
// a second server's worker reads the same queue and would finish jobs while this one is "down".
//
//   node loadtest/reliability.mjs        (JOBS=50 by default)
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { makePdf } from './makePdf.mjs';

const PORT = 3000;
const API = `http://localhost:${PORT}/api/pdfs`;
const SERVER_DIR = new URL('../server/', import.meta.url).pathname;
const RESULTS_DIR = new URL('./results/', import.meta.url).pathname;
const JOBS = Number(process.env.JOBS ?? 50);
const PREFIX = `rel-${Date.now()}-`;
const DOWN_MS = 15_000;
const FINISH_TIMEOUT_MS = 180_000;

mkdirSync(RESULTS_DIR, { recursive: true });
const serverLog = openSync(`${RESULTS_DIR}server.log`, 'a');
const checks = [];
let server;

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

async function startServer() {
  server = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', serverLog, serverLog],
  });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (server.exitCode !== null) throw new Error(`Server exited (${server.exitCode}); see loadtest/results/server.log`);
    try {
      if ((await fetch(API)).ok) return Date.now() - started;
    } catch {}
    await sleep(250);
  }
  throw new Error('Server did not start within 30 s');
}

function crashServer() {
  server.kill('SIGKILL');
  return new Promise((resolve) => server.once('exit', resolve));
}

function upload(name, body, type = 'application/pdf', field = 'pdf') {
  const form = new FormData();
  form.append(field, new Blob([body], { type }), name);
  return fetch(API, { method: 'POST', body: form });
}

async function listOurs() {
  const all = [];
  for (let page = 1; ; page++) {
    const { items, total } = await (await fetch(`${API}?page=${page}&limit=100`)).json();
    all.push(...items);
    if (page * 100 >= total) break;
  }
  return all.filter((pdf) => pdf.name.startsWith(PREFIX));
}

// Waits until none of our PDFs whose names start with `group` is still processing.
async function waitUntilDone(group) {
  const started = Date.now();
  while (Date.now() - started < FINISH_TIMEOUT_MS) {
    const ours = (await listOurs()).filter((pdf) => pdf.name.startsWith(group));
    if (ours.every((pdf) => pdf.status !== 'processing')) return { ours, ms: Date.now() - started };
    await sleep(1000);
  }
  return { ours: (await listOurs()).filter((pdf) => pdf.name.startsWith(group)), ms: FINISH_TIMEOUT_MS };
}

const count = (list, status) => list.filter((pdf) => pdf.status === status).length;

async function crashAfterAccept() {
  const group = `${PREFIX}accepted-`;
  const pdf = makePdf(25);
  const responses = await Promise.all(
    Array.from({ length: JOBS }, (_, i) => upload(`${group}${i}.pdf`, pdf))
  );
  const accepted = responses.filter((res) => res.status === 202).length;

  // Kill right away: most jobs are still compressing, so their results land in the queue while no server is up.
  await crashServer();
  await sleep(DOWN_MS);
  const bootMs = await startServer();
  const { ours, ms } = await waitUntilDone(group);

  record(
    `Server killed (SIGKILL) right after ${JOBS} uploads, down ${DOWN_MS / 1000} s`,
    accepted === JOBS && count(ours, 'ready') === JOBS,
    `${accepted}/${JOBS} accepted, ${count(ours, 'ready')}/${JOBS} ready after restart ` +
      `(restart ${(bootMs / 1000).toFixed(1)} s, all done ${(ms / 1000).toFixed(1)} s later), ` +
      `${count(ours, 'processing')} stuck, ${count(ours, 'failed')} failed`
  );
}

async function crashMidUpload() {
  const group = `${PREFIX}inflight-`;
  const n = Math.max(10, Math.round(JOBS / 2));
  const pdf = makePdf(25);
  const pending = Array.from({ length: n }, (_, i) =>
    upload(`${group}${i}.pdf`, pdf).then((res) => res.status, () => 'connection lost')
  );
  await sleep(150);
  await crashServer();
  const statuses = await Promise.all(pending);
  const accepted = statuses.filter((s) => s === 202).length;

  await startServer();
  const { ours } = await waitUntilDone(group);

  // An upload that never got its 202 may or may not have been saved; what must not happen is a record stuck forever.
  const stuck = count(ours, 'processing');
  const acceptedButMissing = Math.max(0, accepted - count(ours, 'ready'));
  record(
    `Server killed in the middle of ${n} uploads`,
    stuck === 0 && acceptedButMissing === 0,
    `${accepted} got 202 before the crash, ${n - accepted} lost their connection; ` +
      `${count(ours, 'ready')} ready, ${stuck} stuck in processing, ${acceptedButMissing} accepted but lost`
  );
}

async function brokenPdf() {
  const group = `${PREFIX}broken-`;
  const res = await upload(`${group}0.pdf`, '%PDF-1.4\nthis is not really a pdf\n');
  const { ours, ms } = await waitUntilDone(group);
  record(
    'Damaged PDF (valid header, garbage body)',
    res.status === 202 && ours[0]?.status === 'failed',
    `upload ${res.status}, ended as "${ours[0]?.status}" after ${(ms / 1000).toFixed(1)} s, other jobs unaffected`
  );
}

async function badRequests() {
  const big = await upload(`${PREFIX}big.pdf`, new Uint8Array(11 * 1024 * 1024));
  record('11 MB file (limit is 10 MB)', big.status === 413, `rejected with ${big.status}`);

  const fake = await upload(`${PREFIX}fake.pdf`, 'just text renamed to .pdf');
  record('Text file renamed to .pdf', fake.status === 415, `rejected with ${fake.status}`);

  const wrongField = await upload(`${PREFIX}field.pdf`, makePdf(1), 'application/pdf', 'file');
  record('File sent in the wrong form field', wrongField.status === 400, `rejected with ${wrongField.status}`);
}

async function cleanup() {
  const ours = await listOurs();
  await Promise.all(ours.map((pdf) => fetch(`${API}/${encodeURIComponent(pdf.id)}`, { method: 'DELETE' })));
  console.log(`Cleaned up ${ours.length} test PDFs`);
}

try {
  await startServer();
  await crashAfterAccept();
  await crashMidUpload();
  await brokenPdf();
  await badRequests();
  await cleanup();
} finally {
  if (server?.exitCode === null) await crashServer();
}

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
writeFileSync(`${RESULTS_DIR}reliability.json`, JSON.stringify({ date: new Date().toISOString(), jobs: JOBS, checks }, null, 2));
process.exitCode = passed === checks.length ? 0 : 1;
