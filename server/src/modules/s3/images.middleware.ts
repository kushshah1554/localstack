import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';

const parseImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('image');

// Errors from parsing come from the client's request, so they are 4xx and not 500.
export function imageUpload(req: Request, res: Response, next: NextFunction) {
  parseImage(req, res, (err: unknown) => {
    if (!err) {
      next();
    } else if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'Image is larger than 10 MB' });
    } else {
      res.status(400).json({ error: 'Send the image as multipart/form-data in the "image" field' });
    }
  });
}
