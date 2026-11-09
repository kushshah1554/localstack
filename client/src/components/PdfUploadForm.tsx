import { useState, type SubmitEvent } from 'react';
import { uploadPdf } from '../api/pdfs';
import { formatSize } from '../formatSize';

interface Props {
  onUploaded: () => void;
}

export function PdfUploadForm({ onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    const form = event.currentTarget;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const { size, originalSize } = await uploadPdf(file);
      const saved = Math.round((1 - size / originalSize) * 100);
      setMessage(`Uploaded. ${formatSize(originalSize)} → ${formatSize(size)} (${saved}% smaller).`);
      onUploaded();
      form.reset();
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

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
      {message && <p role="status">{message}</p>}
    </section>
  );
}
