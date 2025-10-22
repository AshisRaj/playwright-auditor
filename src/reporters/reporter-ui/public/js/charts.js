/* eslint-disable no-undef */
'use strict';
import { byId } from './helpers.js';

const donutMeta = { slices: [], cx: 0, cy: 0, r: 0 };

export function drawDonut(RESULT) {
  const canvas = byId('donut');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cats = RESULT.categories || [];
  const total = cats.reduce((s, c) => s + Math.max(1, c.score || 0), 0) || 1;
  const colors = [
    '#22d3ee',
    '#a78bfa',
    '#34d399',
    '#fbbf24',
    '#f87171',
    '#60a5fa',
    '#f472b6',
    '#84cc16',
  ];
  let start = -Math.PI / 2;
  const cx = canvas.width / 2,
    cy = canvas.height / 2,
    r = Math.min(cx, cy) - 10;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  donutMeta.slices = [];
  donutMeta.cx = cx;
  donutMeta.cy = cy;
  donutMeta.r = r;
  cats.forEach((c, i) => {
    const frac = Math.max(1, c.score || 0) / total;
    const end = start + frac * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    donutMeta.slices.push({ start, end, title: c.title, score: c.score || 0 });
    start = end;
  });
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#111';
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px system-ui';
  ctx.fillText(String(RESULT.overallScore || 0) + '/100', cx, cy + 8);
}

export function drawBars(RESULT) {
  const canvas = byId('bars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const isLight = document.body.classList.contains('light');
  const colors = isLight
    ? { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#0284c7', info: '#2563eb' }
    : { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#22d3ee', info: '#3b82f6' };
  const map = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  (RESULT.categories || []).forEach((c) =>
    (c.findings || []).forEach((f) => (map[f.severity] = (map[f.severity] || 0) + 1)),
  );
  const keys = ['critical', 'high', 'medium', 'low', 'info'];
  const values = keys.map((k) => map[k] || 0);
  const max = Math.max(1, ...values);
  const w = canvas.width,
    h = canvas.height,
    pad = 24,
    bw = ((w - pad * 2) / keys.length) * 0.6;
  ctx.clearRect(0, 0, w, h);
  keys.forEach((k, i) => {
    const x = pad + i * ((w - pad * 2) / keys.length) + ((w - pad * 2) / keys.length - bw) / 2;
    const bh = (h - pad * 2) * (values[i] / max);
    const y = h - pad - bh;
    ctx.fillStyle = colors[k];
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle =
      getComputedStyle(document.body).getPropertyValue('--ink').trim() ||
      (isLight ? '#0f172a' : '#e5e7eb');
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(k, x + bw / 2, h - 6);
    ctx.fillText(String(values[i]), x + bw / 2, y - 4);
  });
}

export function wireDonutTooltip() {
  const canvas = byId('donut');
  if (!canvas) return;
  const tip = byId('donutTip');
  if (!tip) return;
  function showTip(x, y, text) {
    tip.textContent = text;
    tip.style.left = x + 12 + 'px';
    tip.style.top = y + 12 + 'px';
    tip.classList.remove('hidden');
    tip.setAttribute('aria-hidden', 'false');
  }
  function hideTip() {
    tip.classList.add('hidden');
    tip.setAttribute('aria-hidden', 'true');
  }
  canvas.addEventListener('mouseleave', hideTip);
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - donutMeta.cx;
    const dy = y - donutMeta.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < donutMeta.r * 0.6 || dist > donutMeta.r) {
      hideTip();
      return;
    }
    let ang = Math.atan2(dy, dx);
    if (ang < -Math.PI / 2) ang += 2 * Math.PI;
    const hit = donutMeta.slices.find((s) => ang >= s.start && ang <= s.end);
    if (hit) {
      showTip(e.clientX, e.clientY, `${hit.title} (${hit.score})`);
    } else {
      hideTip();
    }
  });
}
