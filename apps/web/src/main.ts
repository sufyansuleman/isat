import './style.css';
import { startRouter } from './router';
import { shell } from './pages';

import { mountCalculatePage } from './calculate/page';

const app = document.getElementById('app')!;
let dispose: (() => void) | undefined;
startRouter((route, mode) => {
  dispose?.(); dispose = undefined;
  app.innerHTML = shell(route);
  const calc = document.getElementById('calculate-root');
  if (calc) dispose = mountCalculatePage(calc, mode);
  document.title = route === '/' ? 'ISAT - Insulin Sensitivity Analysis Tool' : `ISAT - ${route.slice(1)}`;
  window.scrollTo(0, 0);
});
