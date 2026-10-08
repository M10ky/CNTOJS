'use strict';
// ═══ THEME — mode clair / mode sombre ═══
const THEME_KEY = 'theme';

function getStoredTheme() {
  try { const t = localStorage.getItem(THEME_KEY); return (t === 'light' || t === 'dark') ? t : null; }
  catch (e) { return null; }
}

function applyTheme(theme) {
  const d = document.documentElement;
  d.setAttribute('data-theme', theme);
  d.style.colorScheme = theme;
  document.querySelectorAll('[data-theme-icon]').forEach(ic => {
    ic.className = 'ti ' + (theme === 'dark' ? 'ti-sun' : 'ti-moon');
  });
}

function initTheme() { applyTheme(getStoredTheme() || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); }

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme(next);
  const app = document.getElementById('app');
  if (typeof render === 'function' && app && app.style.display !== 'none') render(); // redessine les charts si l'app est ouverte
}
window.toggleTheme = toggleTheme;
window.initTheme   = initTheme;

initTheme();
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!getStoredTheme()) applyTheme(e.matches ? 'dark' : 'light');
  });
}
