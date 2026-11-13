import { useState, type SubmitEvent } from 'react';
import { uploadPdf } from '../api/pdfs';

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
      await uploadPdf(file);
      setMessage(`Uploaded ${file.name}. It is being compressed and will show as ready in the list.`);
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
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
