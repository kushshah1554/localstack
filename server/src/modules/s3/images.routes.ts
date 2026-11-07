import express from 'express';
import { downloadImage, uploadImage } from './images.controller.ts';
import { imageUpload } from './images.middleware.ts';

export const imagesRouter = express.Router();

imagesRouter.post('/', imageUpload, uploadImage);
imagesRouter.get('/:id', downloadImage);
