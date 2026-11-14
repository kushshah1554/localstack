# Load and reliability testing

How the PDF pipeline (Express → S3 → SQS → Lambda → SQS → worker → MongoDB) behaves under load and when things crash.
Everything ran on one laptop (20 CPU threads, 7.4 GB RAM, about 2 GB free) with AWS emulated by LocalStack,
so the numbers show the code's behaviour and this machine's limits, not real AWS capacity.

Run date: 2026-11-14.

## Reliability: what happens when things break

`node loadtest/reliability.mjs` starts its own server, then crashes it with `SIGKILL` (no clean shutdown).

| Scenario | Result |
|---|---|
| Server killed right after 50 uploads, down 15 s | 50/50 accepted, **50/50 compressed after restart**, none lost or stuck. Restart 0.3 s, all done 16.6 s later |
| Server killed in the middle of 25 uploads | **0 stuck**, 0 lost. 2 got their answer before the crash, 23 lost the connection, all 25 compressed after restart |
| Damaged PDF (valid header, garbage body) | Marked failed after 4.2 s; other jobs unaffected |
| 11 MB file (limit 10 MB) | Rejected, 413 |
| Text file renamed to `.pdf` | Rejected, 415 |
| File in the wrong form field | Rejected, 400 |

A second run with 30 uploads also passed 6/6 (30/30 compressed after the crash, 0 stuck), and a third run after
adding pagination passed 6/6 again (50/50 compressed, all done 15.6 s after restart).

### Bug found and fixed

The first run failed the mid-upload crash: **15 of 25 PDFs stayed "processing" forever.**
The upload saved the database record and *then* queued the compression job; a crash between the two left a record
waiting for a job that was never sent.

Fix: each record now notes when its job is queued, and the server re-sends any unqueued jobs at startup.
Sending a job twice is safe because the Lambda skips a job whose original is already gone, and a record can only
finish once. A regression test (`a job left unsent by a server crash is sent again…` in `pdfs.test.ts`) covers it.
After the fix: 0 stuck.

## Load: k6, before and after pagination

`loadtest/load.js` (run in Docker with `grafana/k6:1.3.0`): browsing ramps 20 → 50 → 100 virtual users over 3 minutes, each
loading the PDF and image lists every second, while PDFs upload at 2 per second for 2 minutes. Same settings both runs.

| Metric | Before | After pagination |
|---|---|---|
| Requests in 3 min | 8,953 (49/s) | **17,115 (94/s)** |
| Failed requests | 0.11% (10 uploads) | **0%** |
| Uploads compressed | 231/231 | 240/240 |
| Browse latency p95 (target 500 ms) | 2.7 s, missed | **17 ms**, met |
| Upload latency p95 (target 1 s) | 24 s, missed | **42 ms**, met |
| Data downloaded | 567 MB | 52 MB |

Reports with graphs: `loadtest/results/before-pagination/k6-report.html` and `loadtest/results/k6-report.html`.

### What was limiting it

The list endpoints returned **every** file and signed two S3 links for each one. As uploads piled up during the test,
each response grew (about 125 KB per page load by the end), and that work competed with uploads on the same Node
process, so upload latency climbed too.

Fix: both lists are paginated (`?page=1&limit=5`, at most 100 per page), so the server reads and signs only one page.
The UI shows 5 at a time with Previous / Next.

Fair-comparison notes: the "before" run asked for the whole list (the only option then); the "after" run asks for page 1
with 5 items, which is what the UI now does. LocalStack was also restarted between the runs (see below), which may
account for a small part of the difference.

## Other findings

- After many hard crashes and thousands of Lambda runs, LocalStack itself started delaying the first job of a new test
  run by more than 30 s. Restarting LocalStack fixed it. Real AWS would not behave like this, but it is worth knowing
  when testing locally.
- If the backend is down when the page first loads, the page shows an error and does not retry until it is reloaded.

## Run it yourself

```bash
lstk start && bash lambdas/compress-pdf/deploy.sh     # LocalStack, bucket, queues, Lambda
node loadtest/reliability.mjs                          # stop any other backend on :3000 first
node loadtest/makePdf.mjs                              # writes loadtest/sample.pdf
(cd server && npm start) &                             # backend for the load test
docker run --rm --network host --user "$(id -u):$(id -g)" -v "$PWD/loadtest:/scripts" -w /scripts \
  -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_EXPORT=results/k6-report.html \
  grafana/k6:1.3.0 run load.js
```

Both scripts delete the files they upload.
