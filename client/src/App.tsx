import { useEffect, useRef, useState } from 'react';
import { listImages, type Image } from './api/images';
import { listPdfs, type Pdf } from './api/pdfs';
import { ImageList } from './components/ImageList';
import { PdfList } from './components/PdfList';
import { PdfUploadForm } from './components/PdfUploadForm';
import { UploadForm } from './components/UploadForm';

// Links last at least 1 hour after loading, so refreshing every 30 minutes keeps them valid.
const REFRESH_EVERY_MS = 30 * 60 * 1000;
// Stops a broken image from reloading the list over and over.
const MIN_RETRY_GAP_MS = 60 * 1000;

function App() {
  const [images, setImages] = useState<Image[]>([]);
  const [pdfs, setPdfs] = useState<Pdf[]>([]);
  const [error, setError] = useState('');
  const lastLoadedAt = useRef(0);

  function showError(err: unknown) {
    setError(err instanceof Error ? err.message : 'Could not load files');
  }

  // State is only set inside the promise callbacks, after the request finishes.
  function loadImages() {
    lastLoadedAt.current = Date.now();
    listImages().then((list) => {
      setImages(list);
      setError('');
    }, showError);
  }

  function loadPdfs() {
    listPdfs().then(setPdfs, showError);
  }

  // An image that fails to load most likely has an expired link, so fetch fresh ones.
  function handleImageError() {
    if (Date.now() - lastLoadedAt.current > MIN_RETRY_GAP_MS) loadImages();
  }

  function loadAll() {
    loadImages();
    loadPdfs();
  }

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
    // Run once on mount: the loaders only use state setters and a ref, which never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main>
      <h1>File storage</h1>
      <PdfUploadForm onUploaded={loadPdfs} />
      {error && <p role="alert" className="error">{error}</p>}
      <PdfList
        pdfs={pdfs}
        onDeleted={(id) => setPdfs((current) => current.filter((pdf) => pdf.id !== id))}
      />
      <UploadForm onUploaded={loadImages} />
      <ImageList
        images={images}
        onDeleted={(id) => setImages((current) => current.filter((image) => image.id !== id))}
        onImageError={handleImageError}
      />
    </main>
  );
}

export default App;
