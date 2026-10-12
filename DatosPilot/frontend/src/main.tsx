import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ui';
import { applyDocumentLang } from './i18n';
import { initDatabase, initSession } from './store/db';
import './store/theme';
import './styles/app.css';
import './styles/datospilot.css';

// Load (or seed on first visit) the demo database before the first render.
initDatabase();
initSession();
applyDocumentLang();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
