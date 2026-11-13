import { app } from './app.ts';
import { connectDb } from './config/db.ts';
import { startPdfWorker } from './modules/pdfs/pdfs.worker.ts';

const port = process.env.PORT || 3000;

await connectDb();
console.log('Connected to MongoDB');

startPdfWorker();

app.listen(port, (err?: Error) => {
  if (err) throw err;
  console.log(`Listening on http://localhost:${port}`);
});
