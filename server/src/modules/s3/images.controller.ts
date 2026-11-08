import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { deleteImage, listImages, saveImage } from './images.service.ts';

// SVG is left out on purpose: it can carry scripts that run when opened in a browser.
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// shortcut: trusts the declared image type instead of checking file bytes, add a byte check before accepting uploads from the public.
export async function uploadImage(req: Request, res: Response) {
  const { file } = req;
  if (!file) {
    res.status(400).json({ error: 'Send the image as multipart/form-data in the "image" field' });
    return;
  }
  const extension = extensions[file.mimetype];
  if (!extension) {
    res.status(415).json({ error: 'Send a JPEG, PNG, WebP or GIF image' });
    return;
  }
  if (file.size === 0) {
    res.status(400).json({ error: 'Image is empty' });
    return;
  }

  const id = `${randomUUID()}.${extension}`;
  await saveImage(id, file.buffer, file.mimetype);
  res.status(201).json({ id });
}

export async function getImages(_req: Request, res: Response) {
  res.json(await listImages());
}

export async function removeImage(req: Request<{ id: string }>, res: Response) {
  if (!(await deleteImage(req.params.id))) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  res.status(204).end();
}
