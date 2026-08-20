import { animate, stagger } from 'https://cdn.jsdelivr.net/npm/motion@13.1.0/+esm';

const STORAGE_KEY = 'ficoCcoReducedMotion';

export function createCcoMotion({ toggle }) {
  const reducedBySystem = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let reduced = localStorage.getItem(STORAGE_KEY) === '1' || (localStorage.getItem(STORAGE_KEY) === null && reducedBySystem);
  let appRevealed = false;
  let lastKpiSignature = '';
  const knownRecords = new Set();

  const enabled = () => !reduced;
  const run = (target, keyframes, options) => enabled() && animate(target, keyframes, options);
  const setReduced = (value) => {
    reduced = value;
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    if (toggle) toggle.checked = reduced;
    localStorage.setItem(STORAGE_KEY, reduced ? '1' : '0');
  };

  setReduced(reduced);
  toggle?.addEventListener('change', () => setReduced(toggle.checked));

  return {
    revealApp() {
      if (appRevealed || !enabled()) return;
      appRevealed = true;
      run('.actions, .kpis article, .workspace > *, .lists > *, .history-card',
        { opacity: [0, 1], y: [18, 0], filter: ['blur(5px)', 'blur(0px)'] },
        { duration: 0.48, delay: stagger(0.045), ease: [0.22, 1, 0.36, 1] });
    },
    records() {
      if (!enabled()) return;
      const fresh = [...document.querySelectorAll('.record')].filter((node) => {
        const key = node.querySelector('.code')?.textContent;
        if (!key || knownRecords.has(key)) return false;
        knownRecords.add(key);
        return true;
      });
      if (fresh.length) run(fresh, { opacity: [0, 1], x: [-18, 0], scale: [0.985, 1] }, { duration: 0.32, delay: stagger(0.045), ease: [0.22, 1, 0.36, 1] });
    },
    kpis() {
      const signature = [...document.querySelectorAll('.kpis strong')].map((node) => node.textContent).join('|');
      if (signature === lastKpiSignature) return;
      lastKpiSignature = signature;
      run('.kpis article', { y: [0, -4, 0], scale: [1, 1.018, 1] }, { duration: 0.26, delay: stagger(0.025), ease: 'ease-out' });
    },
    added(node) {
      run(node, { opacity: [0, 1], y: [-12, 0], scale: [0.98, 1] }, { duration: 0.28, ease: [0.22, 1, 0.36, 1] });
    },
    dialog(dialog) {
      if (!dialog.open) dialog.showModal();
      const panel = dialog.querySelector('form, > div') || dialog;
      run(panel, { opacity: [0, 1], y: [22, 0], scale: [0.975, 1] }, { duration: 0.34, ease: [0.22, 1, 0.36, 1] });
    },
    notice(element, success) {
      if (!element || element.hidden) return;
      run(element, { opacity: [0, 1], y: [-8, 0], scale: [0.985, 1] }, { duration: 0.26, ease: 'ease-out' });
      if (success) run(element, { scale: [1, 1.012, 1] }, { duration: 0.34, ease: 'ease-out' });
    },
    mapFocus() {
      run('.map-card', { scale: [1, 1.008, 1] }, { duration: 0.52, ease: [0.22, 1, 0.36, 1] });
    }
  };
}
