/** Manage page shell: presets, all tabs, settings, agent setup. Phase 2 builds it. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <main className="p-6">
      <h1 className="text-xl font-semibold">Lanehead</h1>
    </main>
  </StrictMode>,
);
