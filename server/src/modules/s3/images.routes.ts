import express from 'express';
import { fileUpload } from '../../middleware/fileUpload.ts';
import { getImages, removeImage, uploadImage } from './images.controller.ts';

export const imagesRouter = express.Router();

imagesRouter.get('/', getImages);
imagesRouter.post('/', fileUpload('image'), uploadImage);
imagesRouter.delete('/:id', removeImage);
