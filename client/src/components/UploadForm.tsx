import { useState, type SubmitEvent } from 'react';
import { uploadImage } from '../api/images';

interface Props {
  onUploaded: () => void;
}

export function UploadForm({ onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    const form = event.currentTarget;
    setUploading(true);
    setError('');
    try {
      await uploadImage(file);
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
      <h2>Upload an image</h2>
      <form onSubmit={handleSubmit}>
        <label htmlFor="image">JPEG, PNG, WebP or GIF, up to 10 MB</label>
        <input
          id="image"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={!file || uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
