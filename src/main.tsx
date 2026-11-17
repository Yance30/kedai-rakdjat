import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DialogHost } from './components/Dialog';
import ErrorBoundary from './components/ErrorBoundary';
import UpdateBanner from './components/UpdateBanner';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div className="h-full grid place-items-center text-primary"><span className="kr-breathe">Memuat halaman…</span></div>}><App /></Suspense>
    </ErrorBoundary>
    <UpdateBanner />
    <DialogHost />
  </StrictMode>,
);
