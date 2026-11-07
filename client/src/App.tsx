import { useEffect, useState } from 'react';
import { listImages, type Image } from './api/images';
import { ImageList } from './components/ImageList';
import { UploadForm } from './components/UploadForm';

function App() {
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState('');

  // State is only set inside the promise callbacks, after the request finishes.
  function loadImages() {
    listImages().then(
      (list) => {
        setImages(list);
        setError('');
      },
      (err) => setError(err instanceof Error ? err.message : 'Could not load images')
    );
  }

  useEffect(() => {
    loadImages();
  }, []);

  return (
    <main>
      <h1>Image storage</h1>
      <UploadForm onUploaded={loadImages} />
      {error && <p role="alert" className="error">{error}</p>}
      <ImageList
        images={images}
        onDeleted={(id) => setImages((current) => current.filter((image) => image.id !== id))}
      />
    </main>
  );
}

export default App;
