import express from 'express';
import { downloadImage, getImages, removeImage, uploadImage } from './images.controller.ts';
import { imageUpload } from './images.middleware.ts';

export const imagesRouter = express.Router();

imagesRouter.get('/', getImages);
imagesRouter.post('/', imageUpload, uploadImage);
imagesRouter.get('/:id', downloadImage);
imagesRouter.delete('/:id', removeImage);
