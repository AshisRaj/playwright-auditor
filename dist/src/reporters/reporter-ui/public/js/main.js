/* eslint-disable no-undef */
'use strict';
import { drawBars, drawDonut, wireDonutTooltip } from './charts.js';
import { applyFilters, wireControls } from './filters.js';
import {
  $,
  byId,
  escapeHtml,
  fmt,
  getResult,
  isUrl,
  sevClass,
  severityRank,
  statusOf,
} from './helpers.js';
import { wireTabs } from './tabs.js';

document.addEventListener('DOMContentLoaded', () => {
  try {
    const RESULT = getResult();

    function summarizePassFail() {
      let pass = 0,
        fail = 0;
      (RESULT.categories || []).forEach((c) =>
        (c.findings || []).forEach((f) => {
          if (statusOf(f) === 'pass') pass++;
          else fail++;
        }),
      );
      return { pass, fail };
    }
    function summarizePerCategory() {
      return (RESULT.categories || []).map((c) => {
        let pass = 0,
          fail = 0;
        (c.findings || []).forEach((f) => {
          if (statusOf(f) === 'pass') pass++;
          else fail++;
        });
        return {
          id: c.id,
          title: c.title,
          pass,
          fail,
          score: c.score,
          total: (c.findings || []).length,
        };
      });
    }

    // Header setup (was renderHeader)
    (function renderHeader() {
      $('#proj').textContent = RESULT.targetDir || '';
      $('#ts').textContent = RESULT.timestamp ? new Date(RESULT.timestamp).toLocaleString() : '';
      $('#overall').textContent = (RESULT.overallScore != null ? RESULT.overallScore : 0) + '/100';

      const b = $('#badges');
      b.innerHTML = '';
      const countFindings = (RESULT.categories || []).reduce(
        (s, c) => s + (c.findings || []).length,
        0,
      );
      [
        ['Categories', RESULT.categories ? RESULT.categories.length : 0],
        ['Validations', countFindings],
      ].forEach(([label, value]) => {
        const span = document.createElement('span');
        span.className = 'chip';
        span.innerHTML = `<b>${label}:</b> ${fmt(value)}`;
        b.appendChild(span);
      });

      const pf = summarizePassFail();
      const sc = byId('summaryChips');
      sc.innerHTML = '';
      const passChip = document.createElement('span');
      passChip.className = 'chip';
      passChip.style.color = 'var(--pass)';
      passChip.innerHTML = '✅ (' + fmt(pf.pass) + ')';
      const failChip = document.createElement('span');
      failChip.className = 'chip';
      failChip.style.color = 'var(--fail)';
      failChip.innerHTML = '❌ (' + fmt(pf.fail) + ')';
      sc.appendChild(passChip);
      sc.appendChild(failChip);

      const list = byId('sumList');
      list.innerHTML = '';
      summarizePerCategory().forEach((row) => {
        const line = document.createElement('div');
        line.style.display = 'flex';
        line.style.gap = '8px';
        line.style.alignItems = 'center';
        line.innerHTML =
          `<span class="chip">${escapeHtml(row.title)} (${fmt(row.score || 0)})</span>` +
          `<span class="chip" style="color:var(--pass)">✅ (${fmt(row.pass)})</span>` +
          `<span class="chip" style="color:var(--fail)">❌ (${fmt(row.fail)})</span>`;
        list.appendChild(line);
      });
    })();

    function statusIconHTML(st) {
      if (st === 'pass') {
        return (
          '<span class="status status-pass" title="Passed">' +
          '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M7.6 13.2 4.4 10l-1.4 1.4 4.6 4.6L17 6.6 15.6 5.2z"/></svg> Pass</span>'
        );
      }
      return (
        '<span class="status status-fail" title="Failed">' +
        '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M11.4 10l4.3-4.3-1.4-1.4L10 8.6 5.7 4.3 4.3 5.7 8.6 10l-4.3 4.3 1.4 1.4L10 11.4l4.3 4.3 1.4-1.4z"/></svg> Fail</span>'
      );
    }
    function artifactsHTML(arts) {
      if (!arts || !arts.length) return '';
      const items = arts
        .map((a) => {
          const s = String(a);
          if (isUrl(s))
            return `<li><a class="artifact-link" href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a></li>`;
          return `<li>${escapeHtml(s)}</li>`;
        })
        .join('');
      return `<div style="margin-top:6px"><b>Artifacts:</b><ul style="margin:6px 0 0 16px; padding:0">${items}</ul></div>`;
    }

    function buildPanel(cat) {
      const section = document.createElement('section');
      section.className = 'card';
      section.id = 'panel-' + cat.id;
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-labelledby', 'tab-' + cat.id);

      const sevCounts = {};
      (cat.findings || []).forEach((f) => {
        const sv = f.severity || 'info';
        sevCounts[sv] = (sevCounts[sv] || 0) + 1;
      });
      const sevPairs = Object.keys(sevCounts)
        .map((k) => [k, sevCounts[k]])
        .sort((a, b) => severityRank(b[0]) - severityRank(a[0]));
      const sevBadges = sevPairs
        .map((p) => `<span class="badge ${sevClass(p[0])}">${p[0]}: ${p[1]}</span>`)
        .join(' ');

      let pass = 0,
        fail = 0;
      (cat.findings || []).forEach((f) => {
        if (f && f.status === 'pass') pass++;
        else fail++;
      });

      const headerHtml =
        `<div class="row"><h3 style="margin:0">${escapeHtml(cat.title)} (${cat.score ?? 0})</h3>` +
        `  <span class="chip">Validations: <b>${(cat.findings || []).length}</b></span>` +
        `  <span class="chip" style="color:var(--pass)">✅ ${pass}</span>` +
        `  <span class="chip" style="color:var(--fail)">❌ ${fail}</span>` +
        `  <span class="right">${sevBadges}</span>` +
        `</div>`;

      section.innerHTML = headerHtml + '<div class="items-wrap" role="list"></div>';
      const wrap = section.querySelector('.items-wrap');

      (cat.findings || []).forEach((f) => {
        const st = f && f.status === 'pass' ? 'pass' : 'fail';
        const row = document.createElement('details');
        row.className = 'item';
        row.setAttribute('data-sev', f.severity || '');
        row.setAttribute('data-status', st);
        const arts = f.artifacts || [];
        const artsText = Array.isArray(arts) ? arts.join(' ') : String(arts || '');
        row.setAttribute(
          'data-text',
          (
            (f.title || '') +
            ' ' +
            (f.message || '') +
            ' ' +
            (f.file || '') +
            ' ' +
            artsText
          ).toLowerCase(),
        );
        row.open = true;

        const sevBadge = f.severity
          ? `<span class="badge ${sevClass(f.severity)}">${escapeHtml(f.severity)}</span>`
          : '';
        const fileLine = f.file
          ? `<div class="sub" style="margin-top:4px">${escapeHtml(f.file)}</div>`
          : '';
        const suggestion = f.suggestion
          ? `<div style="margin-top:6px"><i>Suggestion: ${escapeHtml(f.suggestion)}</i></div>`
          : '';

        row.innerHTML = `<summary>
            <div class="item-head">
              <div>${statusIconHTML(st)}</div>
              <div><b>${escapeHtml(f.title || '')}</b>${fileLine}</div>
              <div style="text-align:right">${sevBadge}</div>
            </div>
          </summary>
          <div class="item-body">
            ${f.message ? `<div>${escapeHtml(f.message)}</div>` : ''}
            ${suggestion}
            ${arts && arts.length ? artifactsHTML(arts) : ''}
          </div>`;

        wrap.appendChild(row);
      });

      return section;
    }

    function expandCollapseProvider(open) {
      const visiblePanel = $('#panels [role="tabpanel"]:not(.hidden)');
      if (!visiblePanel) return;
      visiblePanel.querySelectorAll('.items-wrap .item').forEach((d) => {
        d.open = !!open;
      });
    }

    function csvExporter() {
      const rows = [
        ['Category', 'Status', 'Severity', 'Title', 'Message', 'Suggestion', 'File', 'Artifacts'],
      ];
      (RESULT.categories || []).forEach((c) => {
        (c.findings || []).forEach((f) => {
          const st = f && f.status === 'pass' ? 'pass' : 'fail';
          const arts = Array.isArray(f.artifacts) ? f.artifacts.join(' | ') : f.artifacts || '';
          rows.push([
            c.title,
            st,
            f.severity || '',
            f.title || '',
            f.message || '',
            f.suggestion || '',
            f.file || '',
            String(arts),
          ]);
        });
      });
      const csv = rows
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'playwright-audit.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
    }

    // Tabs + Panels
    wireTabs(RESULT, buildPanel, applyFilters);

    // Controls
    wireControls(expandCollapseProvider, csvExporter, () => drawBars(RESULT));

    // Initial filters & charts
    applyFilters();
    drawDonut(RESULT);
    drawBars(RESULT);
    wireDonutTooltip();
  } catch (e) {
    const box = document.getElementById('err');
    if (box) {
      box.style.display = '';
      box.textContent = 'Report rendering failed: ' + (e && e.message ? e.message : String(e));
    }
    console.error(e);
  }
});
