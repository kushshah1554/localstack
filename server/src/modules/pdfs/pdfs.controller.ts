import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { savePdf } from './pdfs.service.ts';

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
  const { size, originalSize } = await savePdf(id, file.buffer);
  res.status(201).json({ id, size, originalSize });
}
