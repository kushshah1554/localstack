import { errorMessage } from './errorMessage';

export interface UploadedPdf {
  id: string;
  // Bytes after compression, and before.
  size: number;
  originalSize: number;
}

export async function uploadPdf(file: File): Promise<UploadedPdf> {
  const form = new FormData();
  form.append('pdf', file);

  const res = await fetch('/api/pdfs', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await errorMessage(res, 'Upload failed'));
  return res.json();
}
