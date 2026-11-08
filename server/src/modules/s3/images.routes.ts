import express from 'express';
import { getImages, removeImage, uploadImage } from './images.controller.ts';
import { imageUpload } from './images.middleware.ts';

export const imagesRouter = express.Router();

imagesRouter.get('/', getImages);
imagesRouter.post('/', imageUpload, uploadImage);
imagesRouter.delete('/:id', removeImage);
