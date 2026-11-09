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
        Lambda["Lambda<br/>compress-pdf"]
    end

    Mongo[("MongoDB (:27017)<br/>e_shop<br/>images, pdfs")]

    Browser -- "/api/... (Vite proxy)<br/>list, upload, delete" --> Routes
    Services -- "store / delete files" --> S3
    Services -- "invoke and wait" --> Lambda
    Lambda -- "read original,<br/>write compressed" --> S3
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

## 3. PDF upload (with Lambda compression)

```mermaid
sequenceDiagram
    participant B as Browser
    participant E as Express
    participant S as S3
    participant L as Lambda compress-pdf
    participant M as MongoDB

    B->>E: POST /api/pdfs (form field "pdf")
    E->>E: multer reads file, check it starts with %PDF-
    E->>S: 1. put original at pdfs/raw/<id>
    E->>L: 2. invoke { bucket, sourceKey, targetKey }
    L->>S: read pdfs/raw/<id>
    L->>L: compress with pdf-lib (keeps the smaller file)
    L->>S: 3. put compressed at pdfs/<id>
    L-->>E: { size, originalSize }  or  { error: INVALID_PDF }
    E->>M: 4. insert record (name, size, originalSize)
    alt Mongo insert fails
        E->>S: delete pdfs/<id>
    end
    E->>S: 5. always delete pdfs/raw/<id>
    E-->>B: 201 { id, size, originalSize }  (422 for a damaged PDF)
```

The Lambda receives S3 keys instead of the file, because a Lambda call can carry at most 6 MB.

## 4. Listing, viewing and downloading

```mermaid
sequenceDiagram
    participant B as Browser
    participant E as Express
    participant M as MongoDB
    participant S as S3

    B->>E: GET /api/pdfs (or /api/s3/images)
    E->>M: find records, newest first
    E->>E: sign 2 links per file (no S3 call needed)
    E-->>B: [{ id, name, size, ..., url, downloadUrl }]
    B->>S: <img src=url> / Open / Download
    S-->>B: file (downloadUrl adds "save as" header)
```

- Links last 2 hours and stay identical for each clock hour, so the browser can cache files.
- The page reloads the lists every 30 minutes to get fresh links before they expire.

## 5. Deleting

`DELETE /api/pdfs/:id` or `/api/s3/images/:id`: find the record, delete the file from S3, then delete the record. Unknown id gives 404.

## 6. Folder structure

```
localstack/
├── client/                      React + Vite
│   └── src/
│       ├── api/                 fetch calls: images.ts, pdfs.ts, errorMessage.ts
│       ├── components/          UploadForm, ImageList, PdfUploadForm, PdfList
│       ├── App.tsx              loads lists, refreshes links every 30 min
│       └── formatSize.ts
├── server/                      Express + TypeScript (run directly by Node 24)
│   └── src/
│       ├── index.ts             connect Mongo, start server
│       ├── app.ts               mounts routers and error handler
│       ├── config/              aws.ts (shared AWS settings), db.ts (Mongo)
│       ├── middleware/          fileUpload.ts (multer), errorHandler.ts
│       └── modules/
│           ├── s3/              s3.client, s3.signer, images.* (routes → controller → service → repository)
│           ├── lambda/          lambda.client (invokeLambda)
│           └── pdfs/            pdfs.* (routes → controller → service → repository)
└── lambdas/
    └── compress-pdf/            index.mjs (the Lambda), deploy.sh
```

Each feature module has the same layers:

| Layer | Job |
|-------|-----|
| `*.routes.ts` | URL and HTTP method → controller |
| `*.controller.ts` | Read the request, validate it, send the response |
| `*.service.ts` | The steps: S3, Lambda, Mongo, and cleanup on failure |
| `*.repository.ts` | MongoDB queries only |
| `*.test.ts` | End-to-end tests against LocalStack and MongoDB |
