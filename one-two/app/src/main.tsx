import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { trackViewport } from './viewport.ts';

// Inside another page's frame (e.g. a shared demo) the phone's notch and home bar belong to the host page.
let embedded = false;
try { embedded = window.top !== window.self; } catch { embedded = true; }
if (embedded) document.documentElement.classList.add('embedded');
trackViewport();

createRoot(document.getElementById('root')!).render(<App />);
