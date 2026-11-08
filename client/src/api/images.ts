const BASE_URL = '/api/s3/images';

export interface Image {
  id: string;
  contentType: string;
  size: number;
  createdAt: string;
  // Signed S3 links, valid for at least 1 hour after the list is loaded.
  url: string;
  downloadUrl: string;
}

async function errorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error ?? `${fallback} (status ${res.status})`;
}

export async function listImages(): Promise<Image[]> {
  const res = await fetch(BASE_URL);
  if (!res.ok) throw new Error(await errorMessage(res, 'Could not load images'));
  return res.json();
}

export async function uploadImage(file: File) {
  const form = new FormData();
  form.append('image', file);

  const res = await fetch(BASE_URL, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await errorMessage(res, 'Upload failed'));
}

export async function deleteImage(id: string) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorMessage(res, 'Delete failed'));
}
