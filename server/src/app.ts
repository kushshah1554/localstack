import express, { type Request, type Response } from 'express';
import { errorHandler } from './middleware/errorHandler.ts';
import { imagesRouter } from './modules/s3/images.routes.ts';

export const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/api/s3/images', imagesRouter);

app.use(errorHandler);
