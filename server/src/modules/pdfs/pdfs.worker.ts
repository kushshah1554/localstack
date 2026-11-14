import { pollQueue } from '../sqs/sqs.client.ts';
import {
  COMPRESS_DLQ,
  RESULTS_QUEUE,
  handleCompressResult,
  handleFailedJob,
  requeueUnsentJobs,
  type CompressJob,
  type CompressResult,
} from './pdfs.service.ts';

// Runs inside the Express process. Returns a function that stops it.
export function startPdfWorker() {
  const controller = new AbortController();
  requeueUnsentJobs().catch((err) => console.error('Could not re-send unsent compression jobs', err));
  const running = Promise.all([
    pollQueue(RESULTS_QUEUE, (body) => handleCompressResult(body as CompressResult), controller.signal),
    pollQueue(COMPRESS_DLQ, (body) => handleFailedJob(body as CompressJob), controller.signal),
  ]);

  return async () => {
    controller.abort();
    await running;
  };
}
