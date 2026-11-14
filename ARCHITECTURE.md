# Architecture

Diagrams use Mermaid. GitHub shows them as pictures; in VS Code install the "Markdown Preview Mermaid Support" extension.

## 1. The big picture

```mermaid
flowchart LR
    Browser["Browser<br/>React app (Vite, :5173)"]

    subgraph Server["Express server (:3000)"]
        Routes["Routes<br/>/api/s3/images<br/>/api/pdfs"]
        Services["Services<br/>images.service<br/>pdfs.service"]
        Routes --> Services
    end

    subgraph LocalStack["LocalStack (:4566), pretends to be AWS"]
        S3[("S3 bucket<br/>my-first-bucket<br/>images/  pdfs/  pdfs/raw/")]
        Jobs[["SQS pdf-compress<br/>(DLQ: pdf-compress-dlq)"]]
        Lambda["Lambda<br/>compress-pdf"]
        Results[["SQS pdf-results"]]
    end

    Mongo[("MongoDB (:27017)<br/>localstack<br/>images, pdfs")]
    Worker["PDF worker<br/>(inside Express)"]

    Browser -- "/api/... (Vite proxy)<br/>list, upload, delete" --> Routes
    Services -- "store / delete files" --> S3
    Services -- "send job" --> Jobs
    Jobs -- "triggers" --> Lambda
    Lambda -- "read original,<br/>write compressed" --> S3
    Lambda -- "send result" --> Results
    Results --> Worker
    Worker -- "status ready / failed" --> Mongo
    Services -- "records" --> Mongo
    Browser -- "signed links:<br/>view and download files directly" --> S3
```

Rules the whole project follows:

- **Files live in S3, information about them lives in MongoDB.** The `_id` of a record is also the file name in S3.
- **Every file is written to S3 before its Mongo record**, and removed from S3 if the record can't be saved. So a record never points at a missing file.
- **File bytes never pass back through Express.** The list API returns signed S3 links, and the browser loads files straight from S3.

## 2. Image upload

```mermaid
sequenceDiagram
    participant B as Browser
    participant E as Express
    participant S as S3
    participant M as MongoDB

    B->>E: POST /api/s3/images (form field "image")
    E->>E: multer reads file, check type and size
    E->>S: put images/<id>
    E->>M: insert record
    alt Mongo insert fails
        E->>S: delete images/<id>
    end
    E-->>B: 201 { id }
```

## 3. PDF upload (SQS + Lambda compression in the background)

```mermaid
sequenceDiagram
    participant B as Browser
    participant E as Express
    participant S as S3
    participant Q as SQS pdf-compress
    participant L as Lambda compress-pdf
    participant R as SQS pdf-results
    participant W as Worker (in Express)
    participant M as MongoDB

    B->>E: POST /api/pdfs (form field "pdf")
    E->>E: multer reads file, check it starts with %PDF-
    E->>S: put original at pdfs/raw/<id>
    E->>M: insert record, status "processing"
    E->>Q: send job { id, bucket, sourceKey, targetKey }
    E->>M: mark record queued
    E-->>B: 202 { id, status: "processing" }

    Q->>L: triggers the Lambda (1 job at a time)
    L->>S: read original, compress, put pdfs/<id>
    L->>R: { id, size }  or  { id, error: INVALID_PDF }
    L->>S: delete pdfs/raw/<id>
    R->>W: worker long-polls the queue
    W->>M: status "ready" + size, or "failed"
    B->>E: page checks GET /api/pdfs every 3 s until nothing is processing

    Note over E,Q: If the server crashed before "mark record queued"
    E->>M: at startup: find "processing" records not marked queued
    E->>Q: send their jobs again
```

- **Server crashes mid-upload:** a record saved as "processing" whose job never reached the queue would wait forever. At startup the worker sends those jobs again. Sending a job twice is safe: the Lambda skips a job whose original is already gone, and a record only finishes once.

- **Lambda crashes:** SQS retries the job. After 3 failures it moves to `pdf-compress-dlq`, and the worker marks the PDF failed and deletes the original.
- **Delete while processing:** when the result arrives there is no record, so the worker deletes the compressed file.
- The Lambda receives S3 keys instead of the file, because an SQS message can carry at most 256 KB.
- `lambdas/compress-pdf/deploy.sh` creates the queues, the DLQs, the Lambda and the SQS → Lambda trigger.

## 4. Listing, viewing and downloading

```mermaid
sequenceDiagram
    participant B as Browser
    participant E as Express
    participant M as MongoDB
    participant S as S3

    B->>E: GET /api/pdfs?page=1&limit=5 (or /api/s3/images)
    E->>M: find one page of records, newest first, and count all
    E->>E: sign 2 links per file on this page (no S3 call needed)
    E-->>B: { items: [{ id, name, size, ..., url, downloadUrl }], total, page, limit }
    B->>S: <img src=url> / Open / Download
    S-->>B: file (downloadUrl adds "save as" header)
```

- Lists are paged: the UI shows 5 at a time with Previous / Next. Missing or bad `page`/`limit` fall back to page 1 and 20; at most 100 per page. Paging cut p95 page load under load from 2.7 s to 17 ms (see `TESTING.md`).
- Links last 2 hours and stay identical for each clock hour, so the browser can cache files.
- The page reloads the lists every 30 minutes to get fresh links before they expire.

## 5. Deleting

`DELETE /api/pdfs/:id` or `/api/s3/images/:id`: find the record, delete the file from S3, then delete the record. Unknown id gives 404.

## 6. Folder structure

```
localstack/
├── client/                      React + Vite
│   └── src/
│       ├── api/                 fetch calls: images.ts, pdfs.ts, page.ts, errorMessage.ts
│       ├── components/          UploadForm, ImageList, PdfUploadForm, PdfList, Pager
│       ├── App.tsx              loads one page of each list, refreshes links every 30 min
│       └── formatSize.ts
├── server/                      Express + TypeScript (run directly by Node 24)
│   └── src/
│       ├── index.ts             connect Mongo, start PDF worker, start server
│       ├── app.ts               mounts routers and error handler
│       ├── pagination.ts        reads ?page= and ?limit= safely
│       ├── config/              aws.ts (shared AWS settings), db.ts (Mongo)
│       ├── middleware/          fileUpload.ts (multer), errorHandler.ts
│       └── modules/
│           ├── s3/              s3.client, s3.signer, images.* (routes → controller → service → repository)
│           ├── sqs/             sqs.client (sendMessage, pollQueue)
│           └── pdfs/            pdfs.* (routes → controller → service → repository) + pdfs.worker
├── lambdas/
│   └── compress-pdf/            index.mjs (the Lambda), deploy.sh (queues + Lambda + trigger)
└── loadtest/                    reliability.mjs (crash tests), load.js (k6), results (see TESTING.md)
```

Each feature module has the same layers:

| Layer | Job |
|-------|-----|
| `*.routes.ts` | URL and HTTP method → controller |
| `*.controller.ts` | Read the request, validate it, send the response |
| `*.service.ts` | The steps: S3, Lambda, Mongo, and cleanup on failure |
| `*.repository.ts` | MongoDB queries only |
| `*.test.ts` | End-to-end tests against LocalStack and MongoDB |
