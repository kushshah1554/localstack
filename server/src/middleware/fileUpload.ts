import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';

const MAX_MB = 10;

// Reads one file from the multipart form `field` into memory (req.file).
// Errors from parsing come from the client's request, so they are 4xx and not 500.
export function fileUpload(field: string) {
  const parse = multer({
    storage: multer.memoryStorage(),
    // Browsers send file names as UTF-8; the latin1 default garbles non-English names.
    defParamCharset: 'utf8',
    limits: { fileSize: MAX_MB * 1024 * 1024 },
  }).single(field);

  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (err: unknown) => {
      if (!err) {
        next();
      } else if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: `File is larger than ${MAX_MB} MB` });
      } else {
        res.status(400).json({ error: `Send the file as multipart/form-data in the "${field}" field` });
      }
    });
  };
}
