/* eslint-disable no-undef */
'use strict';
import { $, byId } from './helpers.js';

export function applyFilters() {
  const q = (byId('search')?.value || '').trim().toLowerCase();
  const sev = byId('sevFilter')?.value || '';
  const onlyFails = !!byId('onlyFails')?.checked;

  const visiblePanel = $('#panels [role="tabpanel"]:not(.hidden)');
  if (!visiblePanel) return;

  visiblePanel.querySelectorAll('.items-wrap .item').forEach((item) => {
    const ds = item.dataset || {};
    const okText = !q || (ds.text || '').includes(q);
    const okSev = !sev || ds.sev === sev;
    const okStatus = !onlyFails || ds.status === 'fail';
    item.style.display = okText && okSev && okStatus ? '' : 'none';
  });

  const wrap = visiblePanel.querySelector('.items-wrap');
  if (wrap) {
    const anyVisible = Array.from(wrap.querySelectorAll('.item')).some(
      (it) => it.style.display !== 'none',
    );
    wrap.style.display = anyVisible ? '' : 'none';
  }
}

export function wireControls(expandCollapseProvider, csvExporter, drawBars) {
  const exp = byId('expandAll');
  if (exp) exp.onclick = () => expandCollapseProvider(true);

  const col = byId('collapseAll');
  if (col) col.onclick = () => expandCollapseProvider(false);

  byId('search')?.addEventListener('input', applyFilters);
  byId('sevFilter')?.addEventListener('change', applyFilters);
  byId('onlyFails')?.addEventListener('change', applyFilters);

  byId('exportCsv')?.addEventListener('click', csvExporter);

  const tt = byId('toggleTheme');
  if (tt)
    tt.addEventListener('click', () => {
      document.body.classList.toggle('light');
      drawBars();
    });
}
