import './style.css';
import { startRouter } from './router';
import { shell } from './pages';

const app = document.getElementById('app')!;
startRouter((route) => {
  app.innerHTML = shell(route);
  document.title = route === '/' ? 'ISAT - Insulin Sensitivity Analysis Tool' : `ISAT - ${route.slice(1)}`;
  window.scrollTo(0, 0);
});
