/* eslint-disable no-undef */
'use strict';
import { byId } from './helpers.js';

export function wireTabs(RESULT, buildPanel, applyFilters) {
  const tabsHost = byId('catTabs');
  const panelsHost = byId('panels');
  tabsHost.innerHTML = '';
  panelsHost.innerHTML = '';

  (RESULT.categories || []).forEach((c, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.id = 'tab-' + c.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', 'panel-' + c.id);
    btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
    btn.innerText = `${c.title} (${c.score ?? 0})`;
    tabsHost.appendChild(btn);

    const panel = buildPanel(c);
    if (idx !== 0) panel.classList.add('hidden');
    panelsHost.appendChild(panel);
  });

  tabsHost.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activate(btn.id.replace('tab-', ''), applyFilters);
  });

  tabsHost.addEventListener('keydown', (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const buttons = Array.from(tabsHost.querySelectorAll('.tab'));
    let current = buttons.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    if (current === -1) current = 0;
    if (e.key === 'ArrowRight') current = (current + 1) % buttons.length;
    if (e.key === 'ArrowLeft') current = (current - 1 + buttons.length) % buttons.length;
    if (e.key === 'Home') current = 0;
    if (e.key === 'End') current = buttons.length - 1;
    const next = buttons[current];
    if (next) {
      activate(next.id.replace('tab-', ''), applyFilters);
      next.focus();
    }
  });
}

export function activate(catId, applyFilters) {
  const tabsHost = byId('catTabs');
  const panelsHost = byId('panels');
  tabsHost.querySelectorAll('.tab').forEach((b) => {
    const isActive = b.id === 'tab-' + catId;
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  panelsHost.querySelectorAll('[role="tabpanel"]').forEach((p) => {
    if (p.id === 'panel-' + catId) p.classList.remove('hidden');
    else p.classList.add('hidden');
  });
  applyFilters();
}
