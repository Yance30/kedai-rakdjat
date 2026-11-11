import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="h-full grid place-items-center text-primary">Memuat halaman…</div>}><App /></Suspense>
  </StrictMode>,
);
