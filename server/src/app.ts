import express from 'express';
import { errorHandler } from './middleware/errorHandler.ts';
import { pdfsRouter } from './modules/pdfs/pdfs.routes.ts';
import { imagesRouter } from './modules/s3/images.routes.ts';

export const app = express();

app.use('/api/s3/images', imagesRouter);
app.use('/api/pdfs', pdfsRouter);

app.use(errorHandler);
