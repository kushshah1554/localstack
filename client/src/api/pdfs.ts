import { errorMessage } from './errorMessage';

const BASE_URL = '/api/pdfs';

export interface Pdf {
  id: string;
  name: string;
  // processing: being compressed in the background. Links and size only exist once ready.
  status: 'processing' | 'ready' | 'failed';
  originalSize: number;
  size?: number;
  createdAt: string;
  // Signed S3 links, valid for at least 1 hour after the list is loaded.
  url?: string;
  downloadUrl?: string;
}

export async function listPdfs(): Promise<Pdf[]> {
  const res = await fetch(BASE_URL);
  if (!res.ok) throw new Error(await errorMessage(res, 'Could not load PDFs'));
  return res.json();
}

export async function uploadPdf(file: File) {
  const form = new FormData();
  form.append('pdf', file);

  const res = await fetch(BASE_URL, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await errorMessage(res, 'Upload failed'));
}

export async function deletePdf(id: string) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorMessage(res, 'Delete failed'));
}
