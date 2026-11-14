import { useState } from 'react';
import { deletePdf, type Pdf } from '../api/pdfs';
import { formatSize } from '../formatSize';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// The bar's full width is the original file; the hatched part is what compression removed.
function SizeStatus({ pdf }: { pdf: Pdf }) {
  if (pdf.status === 'processing') {
    return (
      <>
        <div className="size-bar processing" aria-hidden="true"><span /></div>
        <small>Compressing {formatSize(pdf.originalSize)}…</small>
      </>
    );
  }
  if (pdf.status === 'failed') {
    return (
      <small className="error">
        Couldn't compress this file. It may be damaged or password-protected. Delete it and try another copy.
      </small>
    );
  }

  const size = pdf.size ?? pdf.originalSize;
  const ratio = pdf.originalSize > 0 ? Math.min(1, size / pdf.originalSize) : 1;
  const saved = Math.round((1 - ratio) * 100);
  return (
    <>
      <div className="size-bar" aria-hidden="true">
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <small>
        {saved >= 1
          ? `${formatSize(size)}, down from ${formatSize(pdf.originalSize)} (${saved}% smaller)`
          : `${formatSize(size)}, already as small as it gets`}
      </small>
    </>
  );
}

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
    <>
      {error && <p role="alert" className="error">{error}</p>}
      {pdfs.length === 0 ? (
        <p className="empty">No PDFs yet. Choose one above and it's compressed as it uploads.</p>
      ) : (
        <ul className="file-list">
          {pdfs.map((pdf) => (
            <li key={pdf.id}>
              <div className="file-info">
                <strong>{pdf.name}</strong>
                <SizeStatus pdf={pdf} />
                <small className="date">{dateFormat.format(new Date(pdf.createdAt))}</small>
              </div>
              <div className="actions">
                {pdf.status === 'ready' && (
                  <>
                    <a href={pdf.url} target="_blank" rel="noreferrer">Open</a>
                    {/* S3 sends this link as a download, so no `download` attribute is needed. */}
                    <a href={pdf.downloadUrl}>Download</a>
                  </>
                )}
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
    </>
  );
}
