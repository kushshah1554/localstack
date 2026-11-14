import { useEffect, useRef, useState } from 'react';
import { listImages, type Image } from './api/images';
import type { Page } from './api/page';
import { listPdfs, type Pdf } from './api/pdfs';
import { ImageList } from './components/ImageList';
import { Pager } from './components/Pager';
import { PdfList } from './components/PdfList';
import { PdfUploadForm } from './components/PdfUploadForm';
import { UploadForm } from './components/UploadForm';

// Links last at least 1 hour after loading, so refreshing every 30 minutes keeps them valid.
const REFRESH_EVERY_MS = 30 * 60 * 1000;
// Stops a broken image from reloading the list over and over.
const MIN_RETRY_GAP_MS = 60 * 1000;
// How often to check on PDFs that are still being compressed.
const PROCESSING_CHECK_MS = 3000;

const PAGE_SIZE = 5;

function App() {
  const [images, setImages] = useState<Page<Image>>({ items: [], total: 0, page: 1, limit: PAGE_SIZE });
  const [pdfs, setPdfs] = useState<Page<Pdf>>({ items: [], total: 0, page: 1, limit: PAGE_SIZE });
  const [error, setError] = useState('');
  const lastLoadedAt = useRef(0);
  // The page each list is on. Refs, because the timers only see the first render's state.
  const imagePage = useRef(1);
  const pdfPage = useRef(1);

  function showError(err: unknown) {
    setError(err instanceof Error ? err.message : 'Could not load files');
  }

  // State is only set inside the promise callbacks, after the request finishes.
  // A response for a page the user has already left is ignored.
  function loadImages(page = imagePage.current) {
    imagePage.current = page;
    lastLoadedAt.current = Date.now();
    listImages(page, PAGE_SIZE).then((result) => {
      if (page !== imagePage.current) return;
      // The last image on the last page was deleted, so step back a page.
      if (result.items.length === 0 && page > 1) return loadImages(page - 1);
      setImages(result);
      setError('');
    }, showError);
  }

  function loadPdfs(page = pdfPage.current) {
    pdfPage.current = page;
    listPdfs(page, PAGE_SIZE).then((result) => {
      if (page !== pdfPage.current) return;
      if (result.items.length === 0 && page > 1) return loadPdfs(page - 1);
      setPdfs(result);
    }, showError);
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

  // Compression runs in the background, so keep checking until no PDF is processing.
  const anyProcessing = pdfs.items.some((pdf) => pdf.status === 'processing');
  useEffect(() => {
    if (!anyProcessing) return;
    const timer = setInterval(loadPdfs, PROCESSING_CHECK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyProcessing]);

  return (
    <main>
      <header>
        <h1>Your files</h1>
        <p>PDFs are compressed as they upload, so they take up less space.</p>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      <section aria-labelledby="pdfs-heading">
        <h2 id="pdfs-heading">PDFs</h2>
        {/* New uploads are newest, so they appear on page 1. A delete reloads the page so it refills. */}
        <PdfUploadForm onUploaded={() => loadPdfs(1)} />
        <PdfList pdfs={pdfs.items} onDeleted={() => loadPdfs()} />
        <Pager {...pdfs} onChange={loadPdfs} label="PDF pages" />
      </section>
      <section aria-labelledby="images-heading">
        <h2 id="images-heading">Images</h2>
        <UploadForm onUploaded={() => loadImages(1)} />
        <ImageList images={images.items} onDeleted={() => loadImages()} onImageError={handleImageError} />
        <Pager {...images} onChange={loadImages} label="Image pages" />
      </section>
    </main>
  );
}

export default App;
