import { useEffect, useRef, useState } from 'react';
import { listImages, type Image } from './api/images';
import { ImageList } from './components/ImageList';
import { UploadForm } from './components/UploadForm';

// Links last at least 1 hour after loading, so refreshing every 30 minutes keeps them valid.
const REFRESH_EVERY_MS = 30 * 60 * 1000;
// Stops a broken image from reloading the list over and over.
const MIN_RETRY_GAP_MS = 60 * 1000;

function App() {
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState('');
  const lastLoadedAt = useRef(0);

  // State is only set inside the promise callbacks, after the request finishes.
  function loadImages() {
    lastLoadedAt.current = Date.now();
    listImages().then(
      (list) => {
        setImages(list);
        setError('');
      },
      (err) => setError(err instanceof Error ? err.message : 'Could not load images')
    );
  }

  // An image that fails to load most likely has an expired link, so fetch fresh ones.
  function handleImageError() {
    if (Date.now() - lastLoadedAt.current > MIN_RETRY_GAP_MS) loadImages();
  }

  useEffect(() => {
    loadImages();
    const timer = setInterval(loadImages, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <main>
      <h1>Image storage</h1>
      <UploadForm onUploaded={loadImages} />
      {error && <p role="alert" className="error">{error}</p>}
      <ImageList
        images={images}
        onDeleted={(id) => setImages((current) => current.filter((image) => image.id !== id))}
        onImageError={handleImageError}
      />
    </main>
  );
}

export default App;
