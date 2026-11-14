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
      setMessage(`Uploaded ${file.name}. It's compressing now and shows its new size below when done.`);
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
    <>
      <form className="upload" onSubmit={handleSubmit}>
        <label htmlFor="pdf">Choose a PDF up to 10 MB</label>
        <input
          id="pdf"
          type="file"
          accept="application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={!file || uploading}>
          {uploading ? 'Uploading…' : 'Upload PDF'}
        </button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status" className="note">{message}</p>}
    </>
  );
}
