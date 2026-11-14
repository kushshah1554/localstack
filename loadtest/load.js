// k6 load test: people browsing their files while others upload PDFs at a steady rate.
// Needs the backend on :3000 and loadtest/sample.pdf (node loadtest/makePdf.mjs).
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API || 'http://localhost:3000/api';
const PREFIX = 'k6-';
const pdf = open('./sample.pdf', 'b');

export const options = {
  scenarios: {
    // Ramp up people who open the page and look at their lists, to find where latency starts to climb.
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
    // Steady uploads alongside the browsing. Kept modest: every upload starts a Lambda on this laptop.
    upload: {
      executor: 'constant-arrival-rate',
      exec: 'upload',
      rate: Number(__ENV.UPLOADS_PER_SEC || 2),
      timeUnit: '1s',
      duration: '2m',
      startTime: '30s',
      preAllocatedVUs: 20,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:browse}': ['p(95)<500'],
    'http_req_duration{scenario:upload}': ['p(95)<1000'],
  },
};

export function browse() {
  const res = http.batch([
    ['GET', `${API}/pdfs?page=1&limit=5`, null, { tags: { name: 'list pdfs' } }],
    ['GET', `${API}/s3/images?page=1&limit=5`, null, { tags: { name: 'list images' } }],
  ]);
  check(res[0], { 'pdf list 200': (r) => r.status === 200 });
  check(res[1], { 'image list 200': (r) => r.status === 200 });
  sleep(1);
}

export function upload() {
  const res = http.post(
    `${API}/pdfs`,
    { pdf: http.file(pdf, `${PREFIX}${__VU}-${__ITER}.pdf`, 'application/pdf') },
    { tags: { name: 'upload pdf' } }
  );
  check(res, { 'upload 202': (r) => r.status === 202 });
}

// Count how many uploads finished compressing, then remove them so the test leaves nothing behind.
export function teardown() {
  const listAll = () => {
    const all = [];
    for (let page = 1; ; page++) {
      const { items, total } = http.get(`${API}/pdfs?page=${page}&limit=100`).json();
      all.push(...items);
      if (page * 100 >= total) return all;
    }
  };
  let ours = [];
  for (let i = 0; i < 60; i++) {
    ours = listAll().filter((p) => p.name.startsWith(PREFIX));
    if (ours.every((p) => p.status !== 'processing')) break;
    sleep(2);
  }
  const ready = ours.filter((p) => p.status === 'ready').length;
  console.log(`Uploads after test: ${ours.length} total, ${ready} ready, ${ours.length - ready} not ready`);
  for (const p of ours) http.del(`${API}/pdfs/${encodeURIComponent(p.id)}`);
}
