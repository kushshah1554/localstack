import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { readPage } from '../../pagination.ts';
import { deletePdf, listPdfs, savePdf } from './pdfs.service.ts';

export async function uploadPdf(req: Request, res: Response) {
  const { file } = req;
  if (!file) {
    res.status(400).json({ error: 'Send the PDF as multipart/form-data in the "pdf" field' });
    return;
  }
  // Every PDF starts with "%PDF-", so this catches other files renamed to .pdf.
  if (file.mimetype !== 'application/pdf' || file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    res.status(415).json({ error: 'Send a PDF file' });
    return;
  }

  const id = `${randomUUID()}.pdf`;
  // The name comes from the user, so it is only shown and used as the download name, never as an S3 key.
  const name = file.originalname.slice(0, 200) || id;
  await savePdf(id, name, file.buffer);
  // 202 Accepted: stored, but compression is still running in the background.
  res.status(202).json({ id, status: 'processing' });
}

export async function getPdfs(req: Request, res: Response) {
  res.json(await listPdfs(readPage(req.query)));
}

export async function removePdf(req: Request<{ id: string }>, res: Response) {
  if (!(await deletePdf(req.params.id))) {
    res.status(404).json({ error: 'PDF not found' });
    return;
  }
  res.status(204).end();
}
