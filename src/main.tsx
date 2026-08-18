import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './AppV2';
import './styles.css';
import './customization.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
