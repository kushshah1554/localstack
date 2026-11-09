import express from 'express';
import { fileUpload } from '../../middleware/fileUpload.ts';
import { getPdfs, removePdf, uploadPdf } from './pdfs.controller.ts';

export const pdfsRouter = express.Router();

pdfsRouter.get('/', getPdfs);
pdfsRouter.post('/', fileUpload('pdf'), uploadPdf);
pdfsRouter.delete('/:id', removePdf);
