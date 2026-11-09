import { useState, type SubmitEvent } from 'react';
import { uploadPdf, type UploadedPdf } from '../api/pdfs';

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function PdfUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<UploadedPdf | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    const form = event.currentTarget;
    setUploading(true);
    setError('');
    setResult(null);
    try {
      setResult(await uploadPdf(file));
      form.reset();
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const saved = result ? Math.round((1 - result.size / result.originalSize) * 100) : 0;

  return (
    <section className="card">
      <h2>Upload a PDF</h2>
      <form onSubmit={handleSubmit}>
        <label htmlFor="pdf">PDF up to 10 MB. It is compressed before it is stored.</label>
        <input
          id="pdf"
          type="file"
          accept="application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={!file || uploading}>
          {uploading ? 'Uploading and compressing…' : 'Upload'}
        </button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <p role="status">
          Uploaded. {formatSize(result.originalSize)} → {formatSize(result.size)} ({saved}% smaller).
        </p>
      )}
    </section>
  );
}
