import express from 'express';
import { fileUpload } from '../../middleware/fileUpload.ts';
import { uploadPdf } from './pdfs.controller.ts';

export const pdfsRouter = express.Router();

pdfsRouter.post('/', fileUpload('pdf'), uploadPdf);
