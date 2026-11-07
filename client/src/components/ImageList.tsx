import { useState } from 'react';
import { deleteImage, imageUrl, type Image } from '../api/images';

interface Props {
  images: Image[];
  onDeleted: (id: string) => void;
}

export function ImageList({ images, onDeleted }: Props) {
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this image? This cannot be undone.')) return;

    setDeletingId(id);
    setError('');
    try {
      await deleteImage(id);
      onDeleted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <section className="card">
      <h2>Images</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {images.length === 0 ? (
        <p>No images yet.</p>
      ) : (
        <ul className="gallery">
          {images.map((image) => (
            <li key={image.id}>
              <img
                src={imageUrl(image.id)}
                alt={`Uploaded ${new Date(image.createdAt).toLocaleString()}`}
                loading="lazy"
              />
              <div className="actions">
                <a href={imageUrl(image.id)} download={image.id}>
                  Download
                </a>
                <button
                  type="button"
                  className="danger"
                  onClick={() => handleDelete(image.id)}
                  disabled={deletingId === image.id}
                >
                  {deletingId === image.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
