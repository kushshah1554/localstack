import { useState } from 'react';
import { deletePdf, type Pdf } from '../api/pdfs';
import { formatSize } from '../formatSize';

interface Props {
  pdfs: Pdf[];
  onDeleted: (id: string) => void;
}

export function PdfList({ pdfs, onDeleted }: Props) {
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');

  async function handleDelete(pdf: Pdf) {
    if (!window.confirm(`Delete "${pdf.name}"? This cannot be undone.`)) return;

    setDeletingId(pdf.id);
    setError('');
    try {
      await deletePdf(pdf.id);
      onDeleted(pdf.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <section className="card">
      <h2>PDFs</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {pdfs.length === 0 ? (
        <p>No PDFs yet.</p>
      ) : (
        <ul className="file-list">
          {pdfs.map((pdf) => (
            <li key={pdf.id}>
              <div>
                <strong>{pdf.name}</strong>
                <small>
                  {formatSize(pdf.size)} (was {formatSize(pdf.originalSize)}) ·{' '}
                  {new Date(pdf.createdAt).toLocaleString()}
                </small>
              </div>
              <div className="actions">
                <a href={pdf.url} target="_blank" rel="noreferrer">Open</a>
                {/* S3 sends this link as a download, so no `download` attribute is needed. */}
                <a href={pdf.downloadUrl}>Download</a>
                <button
                  type="button"
                  className="danger"
                  onClick={() => handleDelete(pdf)}
                  disabled={deletingId === pdf.id}
                >
                  {deletingId === pdf.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
