import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadConfig } from './config';
import './styles.css';

loadConfig()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch(() => {
    document.getElementById('root')!.innerHTML = '<p style="padding:24px;color:#fff">Could not load /config.json</p>';
  });
