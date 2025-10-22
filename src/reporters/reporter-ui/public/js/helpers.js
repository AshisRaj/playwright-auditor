/* eslint-disable no-undef */
'use strict';

export function getResult() {
  const node = document.getElementById('audit-data');
  if (!node) throw new Error('Missing #audit-data');
  try {
    return JSON.parse(node.textContent || '{}');
  } catch (e) {
    throw new Error('Invalid audit JSON: ' + e.message);
  }
}

export const $ = (s) => document.querySelector(s);
export const byId = (id) => document.getElementById(id);
export const fmt = (n) => new Intl.NumberFormat().format(n);
export const sevClass = (s) => 'sev-' + s;
export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] || c,
  );
}
export const severityRank = (s) => ({ critical: 5, high: 4, medium: 3, low: 2, info: 1 })[s] || 0;
export const statusOf = (f) =>
  f && (f.status === 'pass' || f.status === 'fail') ? f.status : 'fail';
export const isUrl = (x) => {
  try {
    new URL(x);
    return true;
  } catch {
    return false;
  }
};
