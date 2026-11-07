import { app } from './app.ts';
import { connectDb } from './config/db.ts';

const port = process.env.PORT || 3000;

await connectDb();
console.log('Connected to MongoDB');

app.listen(port, (err?: Error) => {
  if (err) throw err;
  console.log(`Listening on http://localhost:${port}`);
});
