import './style.css';
import { startRouter } from './router';
import { shell } from './pages';

import { mountCalculate } from './calculate/view';

const app = document.getElementById('app')!;
let dispose: (() => void) | undefined;
startRouter((route) => {
  dispose?.(); dispose = undefined;
  app.innerHTML = shell(route);
  const calc = document.getElementById('calculate-root');
  if (calc) dispose = mountCalculate(calc);
  document.title = route === '/' ? 'ISAT - Insulin Sensitivity Analysis Tool' : `ISAT - ${route.slice(1)}`;
  window.scrollTo(0, 0);
});
