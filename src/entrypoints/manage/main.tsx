import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Manage } from './Manage';
import '@/styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <Manage />
  </StrictMode>,
);
