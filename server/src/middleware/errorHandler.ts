import type { NextFunction, Request, Response } from 'express';

// `status` is set by Express middleware errors, such as 413 for an oversized body.
type HttpError = Error & { status?: number };

// Express only treats this as an error handler if it declares all four parameters.
export function errorHandler(err: HttpError, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  // Server errors stay generic so AWS and stack details never reach the client.
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
}
