// src/reporters/html.ts
import { promises as fs } from 'fs';
import path from 'path';
import type { AuditResult } from '../types.js';

export async function writeHtml(result: AuditResult, outDir: string) {
  await fs.mkdir(outDir, { recursive: true });

  // Safe embed of the result JSON
  const embedded = JSON.stringify(result).replace(/</g, '\\u003c');

  // Favicon (Q+I)
  const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="qStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#34d399"/>
      <stop offset="55%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="10"/>
  <circle cx="32" cy="32" r="20" fill="none" stroke="url(#qStroke)" stroke-width="8" stroke-linecap="round"/>
  <path d="M45 45 L56 56" stroke="url(#qStroke)" stroke-width="8" stroke-linecap="round"/>
  <rect x="30" y="17" width="4" height="28" rx="2" fill="#0f172a"/>
  <circle cx="32" cy="12.5" r="3" fill="#22d3ee"/>
</svg>`;
  const faviconHref = 'data:image/svg+xml,' + encodeURIComponent(faviconSvg);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Qualisight</title>
  <link rel="icon" type="image/svg+xml" href="${faviconHref}"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    :root{
      --bg-start:#59d6c9; --bg-mid:#7aa6ff; --bg-end:#9a5be8;
      --card:#0f1724; --card-2:#0f1826; --ink:#e9f0ff; --muted:#bcd1ffcc;
      --line:#1f2b45; --pill-bg:#0f1c31; --pill-ink:#cfe0ff;
      --bar-track:#17304d; --bar-ink:#9fb6ff;

      /* Logo palette */
      --logo-surface:#0b1a33;
      --logo-stroke1:#34d399;
      --logo-stroke2:#60a5fa;
      --logo-stroke3:#a78bfa;
      --logo-dot:#22d3ee;
      --logo-i:#e2fbe8;
      --logo-glow:#65c7ff44;
    }
    body.light{
      --card:#fff; --card-2:#fff; --ink:#0f172a; --muted:#475569;
      --line:#e2e8f0; --pill-bg:#eef2ff; --pill-ink:#0f172a;
      --bar-track:#e6edf9; --bar-ink:#334155;

      --logo-surface:#ffffff;
      --logo-i:#0f172a;
      --logo-glow:#65c7ff22;
    }

    *{box-sizing:border-box} html,body{height:100%}
    body{
      margin:0; font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--ink);
      background: radial-gradient(1200px 600px at 10% 0%, #7eead8 0%, #7eead800 60%),
                  linear-gradient(135deg, var(--bg-start) 0%, #6db7ff 40%, var(--bg-end) 100%);
      min-height:100%;
    }
    .page{max-width:1120px;margin:0 auto;padding:56px 24px 64px}
    .menu{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-bottom:12px;align-items:center}
    .menu button,.menu label,.menu input[type=search]{font-size:12px;border-radius:10px}
    .menu button{
      appearance:none;border:1px solid #28406b;background:#0b1a33;color:#cfe0ff;padding:8px 12px;cursor:pointer;box-shadow:inset 0 0 0 1px #ffffff0a;
    }
    body.light .menu button{border-color:#cbd5e1;background:#fff;color:#0f172a;box-shadow:inset 0 0 0 1px #00000008}
    .menu input[type=search]{padding:8px 10px;border:1px solid #28406b;background:#0b1a33;color:#cfe0ff;min-width:220px;outline:none}
    body.light .menu input[type=search]{border-color:#cbd5e1;background:#fff;color:#0f172a}
    .menu .checkline{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid #28406b;background:#0b1a33;color:#cfe0ff;border-radius:10px}
    body.light .menu .checkline{border-color:#cbd5e1;background:#fff;color:#0f172a}

    .brand{display:flex;align-items:center;gap:16px}
    .qlogo{
      width:66px;height:66px;border-radius:16px;
      background:linear-gradient(180deg,var(--logo-surface),#0b1a3300);
      position:relative;display:grid;place-items:center;
      box-shadow:0 12px 28px #0a0f2026, inset 0 0 0 1px #ffffff12, 0 0 0 6px transparent;
      overflow:hidden;
    }
    body.light .qlogo{ box-shadow:0 8px 18px #00000012, inset 0 0 0 1px #00000010 }
    .qlogo::after{ content:""; position:absolute; inset:0; border-radius:16px; box-shadow:inset 0 0 24px var(--logo-glow); pointer-events:none; }
    .qlogo svg{ display:block; width:52px; height:52px; }

    .wordmark{font-weight:800;letter-spacing:-0.5px;font-size:56px;line-height:1;margin-top:2px;text-shadow:0 2px 8px #0000001c}
    .tagline{font-size:36px;font-weight:600;letter-spacing:-0.2px;margin:28px 0 36px;color:var(--ink);text-shadow:0 2px 10px #00000022}

    .grid{display:grid;grid-template-columns:1.05fr 1fr;gap:24px}
    .card{background:var(--card);border-radius:18px;padding:28px;box-shadow:0 12px 28px #0a0f2026,inset 0 0 0 1px #ffffff0f}
    body.light .card{box-shadow:0 8px 18px #00000012,inset 0 0 0 1px #00000008}

    .kpi{display:flex;align-items:center;gap:16px;margin-bottom:6px}
    .score{font-size:48px;font-weight:800;letter-spacing:-0.3px}
    .meta{font-size:13px;color:var(--muted)}
    .meta b{color:#ffffffd9;font-weight:600} body.light .meta b{color:#0f172a}
    .subhead{font-weight:700;margin:18px 0 10px;font-size:18px}

    .list{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:12px}
    .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .name{color:#dbe7ff;font-weight:300} body.light .name{color:#0f172a}
    .name small{opacity:.7}
    .right{display:flex;align-items:center;gap:8px}
    .badge{font-size:12px;line-height:20px;min-width:20px;display:inline-flex;justify-content:center;align-items:center;padding:0 8px;border-radius:999px;background:#122036;color:#9dc1ff;border:1px solid #28406b}
    body.light .badge{background:#eef2ff;color:#334155;border-color:#cbd5e1}
    .tick{width:20px;height:20px;border-radius:999px;background:rgba(20,214,122,.12);color:#10d07a;display:inline-flex;justify-content:center;align-items:center;font-size:14px;font-weight:700;border:1px solid rgba(20,214,122,.35)}
    .err{background:rgba(255,77,79,.14);color:#ff6b6d;border-color:rgba(255,77,79,.35)}
    body.light .err{background:#fee2e2;color:#b91c1c;border-color:#fecaca}

    .badge.ok{ background:rgba(20,214,122,.12); color:#10d07a; border-color:rgba(20,214,122,.35); }
    body.light .badge.ok{ background:#dcfce7; color:#166534; border-color:#bbf7d0; }
    .cross{ width:20px;height:20px;border-radius:999px;background:rgba(255,77,79,.14);color:#ff6b6d;display:inline-flex;justify-content:center;align-items:center;font-size:14px;font-weight:700;border:1px solid rgba(255,77,79,.35) }
    body.light .cross{ background:#fee2e2; color:#b91c1c; border-color:#fecaca }

    .chart-wrap{display:grid;grid-template-columns:1fr;gap:20px}
    .h2{font-size:18px;font-weight:700;margin-bottom:8px}
    .viz{display:grid;grid-template-columns:1fr;gap:10px;align-items:center;justify-items:center}
    .pie{width:260px;height:260px;position:relative}
    .pie .center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:36px;letter-spacing:-0.3px;pointer-events:none}

    /* 3D-style look & feel + hover animations */
    .pie svg {
      filter: drop-shadow(0 6px 12px rgba(0,0,0,0.35));
      transition: transform 0.3s ease, filter 0.3s ease;
      transform: perspective(800px) rotateX(8deg);
      will-change: transform, filter;
    }
    .pie:hover svg {
      transform: perspective(800px) rotateX(0deg) scale(1.03);
      filter: drop-shadow(0 10px 20px rgba(0,0,0,0.45));
    }
    .pie path[data-slice="1"] {
      transition: transform 0.25s ease, filter 0.25s ease, stroke-width 0.25s ease, stroke 0.25s ease, opacity 0.25s ease;
      transform-origin: 130px 130px;
      opacity: 0;            /* for entrance animation */
      transform: scale(0.8); /* for entrance animation */
    }
    .pie path[data-slice="1"].pop-in {
      opacity: 1;
      transform: scale(1);
    }
    .pie path[data-slice="1"]:hover {
      transform: scale(1.06);
      filter: brightness(1.25) saturate(1.3);
      stroke: #ffffffaa;
      stroke-width: 1.5px;
    }

    /* Legend */
    .legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;align-self:stretch;width:100%;margin-top:4px}
    @media (min-width:520px){ .legend{grid-template-columns:repeat(3,minmax(0,1fr));} }
    @media (min-width:820px){ .legend{grid-template-columns:repeat(4,minmax(0,1fr));} }
    .legend-item{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);min-width:0;cursor:default;transition:transform .2s ease, filter .2s ease}
    .legend-item.hover{filter:saturate(1.15) brightness(1.05); transform: translateY(-1px);}
    .legend-swatch{width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 1px #00000022; transition: transform .2s ease, filter .2s ease}
    body.light .legend-swatch{box-shadow:inset 0 0 0 1px #00000024}
    .legend-item.hover .legend-swatch{transform: scale(1.2); filter: brightness(1.15);}
    .legend-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

    .sev-rows{display:grid;gap:12px}
    .sev-row{display:grid;grid-template-columns:110px 1fr 64px;align-items:center;gap:12px}
    .sev-name{font-size:13px;color:var(--bar-ink);text-transform:capitalize}
    .sev-track{height:16px;border-radius:10px;overflow:hidden;background:var(--bar-track);box-shadow:inset 0 0 0 1px #ffffff14}
    body.light .sev-track{box-shadow:inset 0 0 0 1px #00000010}
    .sev-fill{height:100%;border-radius:10px}
    .sev-val{font-size:12px;color:var(--bar-ink);text-align:right}
    .total-line{text-align:center;font-size:12px;color:var(--bar-ink);margin-top:4px}

    .tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px;margin:8px 0 16px}
    .tab{appearance:none;cursor:pointer;user-select:none;background:var(--pill-bg);color:var(--pill-ink);border:1px solid var(--line);border-bottom:2px solid transparent;padding:8px 12px;border-radius:10px 10px 0 0;font-size:13px;line-height:1}
    .tab[aria-selected=true]{background:#0b2a33;color:#e5f7ff;border-color:#22d3ee;border-bottom-color:transparent;box-shadow:0 1px 0 0 #0b2a33}
    body.light .tab{background:#f8fafc;color:#0f172a}
    body.light .tab[aria-selected=true]{background:#e6f6ff;color:#0f172a;border-color:#38bdf8}

    .cat-panel{background:var(--card);border-radius:16px;padding:16px;box-shadow:inset 0 0 0 1px #ffffff0f}
    .cat-panel.hidden{display:none}
    .item{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--card-2)}
    .item + .item{margin-top:10px}
    .item summary{list-style:none;cursor:pointer}
    .item summary::-webkit-details-marker{display:none}
    .item-head{display:grid;grid-template-columns:110px minmax(0,1fr) 110px;gap:12px;align-items:center}
    .status{display:inline-flex;align-items:center;gap:8px;font-weight:700}
    .status-pass{color:#16a34a}.status-fail{color:#ef4444}
    .sev-badge{padding:2px 8px;border-radius:999px;border:1px solid var(--line);font-size:12px;text-transform:capitalize}
    .sev-critical{color:#ef4444}.sev-high{color:#f59e0b}.sev-medium{color:#38bdf8}.sev-info{color:#7c83ff}
    .item-body{margin-top:8px;color:var(--ink);font-size:14px}
    .sub{color:var(--muted);font-size:12px}

    @media (max-width:980px){ .grid{grid-template-columns:1fr} .item-head{grid-template-columns:1fr;gap:6px} }

    .tooltip{ position:fixed; pointer-events:none; padding:6px 8px; font-size:12px; background:#0b1a33; color:#cfe0ff; border:1px solid #28406b; border-radius:8px; box-shadow:0 6px 20px #00000030; z-index:9999; }
    body.light .tooltip{ background:#fff; color:#0f172a; border-color:#cbd5e1; box-shadow:0 8px 18px #00000012; }

    /* Controlled margin utilities for specific headers */
    /* For Validation Summary */
    .heading-validation-summary {
      margin-top: 20px;
      margin-bottom: 16px; /* 1-line breathing space */
    }

    /* For Severity Breakdown */
    .heading-severity-breakdown {
      margin-top: 20px;
      margin-bottom: 10px;
    }

    /* For Category Reports */
    .heading-category-reports {
      margin-top: 5px; /* more breathing room before the section */
      margin-bottom: 25px;
    }

  </style>
</head>
<body>
  <div class="page">
    <div class="menu">
      <input id="search" type="search" placeholder="Search findings..."
             title="Search findings by title, message, file name, or artifact links" />
      <label class="checkline" title="Show only failed validations">
        <input id="onlyFailed" type="checkbox"/> Only failed
      </label>
      <button id="btnExpandAll"   title="Expand all visible findings">Expand All</button>
      <button id="btnCollapseAll" title="Collapse all visible findings">Collapse All</button>
      <button id="btnCsv"         title="Export all findings to CSV">Export CSV</button>
      <button id="btnTheme"       title="Toggle light/dark theme">Theme</button>
    </div>

    <div class="brand">
      <div class="qlogo" aria-label="Qualisight logo">
        <svg viewBox="0 0 64 64" role="img" aria-label="Q and I monogram">
          <defs>
            <linearGradient id="qStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"  stop-color="var(--logo-stroke1)"/>
              <stop offset="55%" stop-color="var(--logo-stroke2)"/>
              <stop offset="100%" stop-color="var(--logo-stroke3)"/>
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="10"/>
          <circle cx="32" cy="32" r="20" fill="none" stroke="url(#qStroke)" stroke-width="8" stroke-linecap="round"/>
          <path d="M45 45 L56 56" stroke="url(#qStroke)" stroke-width="8" stroke-linecap="round"/>
          <rect x="30" y="17" width="4" height="28" rx="2" fill="var(--logo-i)"/>
          <circle cx="32" cy="12.5" r="3" fill="var(--logo-dot)"/>
        </svg>
      </div>
      <div class="wordmark">Qualisight</div>
    </div>
    <div class="tagline">Actionable Quality Insights for Test Automation</div>

    <div class="grid">
      <section class="card">
        <div class="kpi"><div class="score">0/100</div></div>
        <div class="meta" id="kpiLine"></div>
        <div class="subhead heading-validation-summary">Validation Summary</div>
        <ul class="list" id="summaryList"></ul>
      </section>

      <section class="card">
        <div class="h2">Category Scores</div>
        <div class="chart-wrap">
          <div class="viz">
            <div class="pie" id="pie"></div>
            <div class="legend" id="catLegend" aria-label="Category legend"></div>
          </div>
          <div class="h2">Severity Breakdown</div>
          <div class="sev-rows" id="sevRows"></div>
          <div class="total-line" id="sevTotal"></div>
        </div>
      </section>
    </div>

    <section class="card" style="margin-top:24px">
      <div class="h2">Category Reports</div>
      <div class="tabs" id="catTabs" role="tablist" aria-label="Audit Categories"></div>
      <div id="catPanels"></div>
    </section>
  </div>

  <div id="tooltip" class="tooltip" hidden></div>

  <script>
  (function(){
    "use strict";
    const RESULT = ${embedded};

    // ---------------- Utils ----------------
    const $  = (s, r) => (r||document).querySelector(s);
    const $$ = (s, r) => Array.from((r||document).querySelectorAll(s));
    const norm = s => String(s||"").toLowerCase();
    const esc  = s => {
      return String(s).replace(/[&<>"']/g, function(c){
        switch(c){
          case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;';
          case '"': return '&quot;'; case "'": return '&#039;';
          default: return c;
        }
      });
    }

    function normTitle(t){
      return String(t||"")
        .toLowerCase()
        .replace(/[_-]+/g," ")
        .replace(/[\\s\\u2000-\\u206F\\u2E00-\\u2E7F\\'’"“”‘‚‛\\.,:;!\\?()\\[\\]{}\\/\\+\\*~#\\^\\$\\|<>\\x60]+/g," ")
        .trim()
        .replace(/\\s+/g," ");
    }

    // Colors via golden-angle hues (unbounded distinct colors)
    function makeCategoryColors(n){
      const isLight = document.body.classList.contains("light");
      const sat = isLight ? 65 : 72;
      const lit = isLight ? 45 : 58;
      const phi = 137.508;
      const cols = [];
      for (let i=0;i<n;i++){
        const h = (i*phi) % 360;
        cols.push("hsl(" + h.toFixed(2) + ", " + sat + "%, " + lit + "%)");
      }
      return cols;
    }

    // Aggregate duplicate categories by normalized title; average scores
    function aggregateCategories(src){
      const groups = new Map();
      const order = [];
      (Array.isArray(src)?src:[]).forEach((c, i)=>{
        const title = (c && typeof c.title === "string") ? c.title.trim() : "";
        if (!title) return;
        const key = normTitle(title);
        if (!key) return;
        if (!groups.has(key)){
          groups.set(key, { key, title, scores: [], firstIndex: i });
          order.push(key);
        }
        const s = Number(c && c.score);
        groups.get(key).scores.push(Number.isFinite(s) && s >= 0 ? s : 0);
      });
      return order.map(key=>{
        const g = groups.get(key);
        const sum = g.scores.reduce((a,b)=>a+b,0);
        const avg = g.scores.length ? (sum / g.scores.length) : 0;
        return { key: g.key, title: g.title, score: avg };
      });
    }

    // ---------- Header / Summary ----------
    function renderHeader(){
      const score = $(".score"); if (score) score.textContent = String(RESULT.overallScore||0) + "/100";

      const cats = RESULT.categories||[];
      let pass=0, fail=0, total=0;
      cats.forEach(c => (c.findings||[]).forEach(f => { total++; (f && f.status==="pass")?pass++:fail++; }));
      const tiny = $("#kpiLine");
      if (tiny) tiny.innerHTML =
        "Categories: <b>" + cats.length + "</b>&nbsp;&nbsp; " +
        "Validations: <b>" + total + "</b>&nbsp;&nbsp; " +
        "<span style=\\"color:#16a34a\\">✅ (" + pass + ")</span>&nbsp;&nbsp; " +
        "<span style=\\"color:#ef4444\\">❌ (" + fail + ")</span>";

      const list = $("#summaryList"); if (!list) return;
      list.innerHTML = "";
      cats.forEach(cat=>{
        const tot = (cat.findings || []).length;
        const passCount = (cat.findings || []).filter(f => f && f.status==="pass").length;
        const failCount = tot - passCount;
        const li = document.createElement("li");
        li.className = "row";
        li.innerHTML =
          "<span class=\\"name\\">" + esc(cat.title||"") + " <small>(" + (cat.score??0) + ")</small></span>" +
          "<span class=\\"right\\">" +
            "<span class=\\"badge ok\\" title=\\"Passed validations\\">" + passCount + "</span>" +
            "<span class=\\"badge err\\" title=\\"Failed validations\\">" + failCount + "</span>" +
          "</span>";
        list.appendChild(li);
      });
    }

    // ---------- Tabs & Panels ----------
    function renderTabsAndPanels(){
      const tabsHost = $("#catTabs"); const panelsHost = $("#catPanels");
      if (!tabsHost || !panelsHost) return;
      tabsHost.innerHTML=""; panelsHost.innerHTML="";

      const cats = RESULT.categories||[];
      cats.forEach((c, idx)=>{
        const btn = document.createElement("button");
        btn.className="tab"; btn.id="tab-"+c.id;
        btn.setAttribute("role","tab"); btn.setAttribute("aria-controls","panel-"+c.id);
        btn.setAttribute("aria-selected", idx===0?"true":"false");
        btn.innerHTML = esc(c.title||"") + " (" + (c.score??0) + ")";
        tabsHost.appendChild(btn);

        const panel = document.createElement("div");
        panel.className="cat-panel"+(idx!==0?" hidden":"");
        panel.id="panel-"+c.id; panel.setAttribute("role","tabpanel");
        panel.setAttribute("aria-labelledby","tab-"+c.id);

        const pass = (c.findings||[]).filter(f=>f && f.status==="pass").length;
        const fail = (c.findings||[]).length - pass;
        const head = document.createElement("div");
        head.className="meta"; head.style.marginBottom="12px";
        head.innerHTML = "Validations: <b>" + ((c.findings||[]).length) + "</b> " +
                         "&nbsp;&nbsp; <span style=\\"color:#16a34a\\">✅ " + pass + "</span> " +
                         "&nbsp;&nbsp; <span style=\\"color:#ef4444\\">❌ " + fail + "</span>";
        panel.appendChild(head);

        const wrap = document.createElement("div"); wrap.className="findings-wrap";
        (c.findings||[]).forEach(f=>{
          const st = (f && f.status==="pass")?"pass":"fail";
          const details = document.createElement("details");
          details.className="item"; details.open=true;

          const sev = String((f && f.severity) || "info").toLowerCase();
          const sevClass = "sev-"+(["critical","high","medium","info"].includes(sev)?sev:"info");

          const textBlob = [ f && f.title, f && f.message, f && f.suggestion, f && f.file,
            Array.isArray(f && f.artifacts)? (f.artifacts||[]).join(" ") : (f && f.artifacts) ]
            .filter(Boolean).join(" ");
          details.dataset.status = st;
          details.dataset.search = norm(textBlob);

          const fileLine = (f && f.file) ? "<div class=\\"sub\\" style=\\"margin-top:4px\\">" + esc(f.file) + "</div>" : "";
          const artHtml = (Array.isArray(f && f.artifacts) && (f && f.artifacts).length)
            ? "<div style=\\"margin-top:6px\\"><b>Artifacts:</b><ul style=\\"margin:6px 0 0 16px; padding:0\\">" +
              (f && f.artifacts).map(a=>"<li>" + esc(String(a)) + "</li>").join("") +
              "</ul></div>"
            : "";
          const suggestion = (f && f.suggestion) ? "<div style=\\"margin-top:6px\\"><i>Suggestion: " + esc(f.suggestion) + "</i></div>" : "";

          details.innerHTML =
            "<summary>"+
              "<div class=\\"item-head\\">"+
                "<div class=\\"status status-"+st+"\\">"+(st==="pass"?"✓ Pass":"✕ Fail")+"</div>"+
                "<div><b>"+esc((f && f.title) || "")+"</b>"+fileLine+"</div>"+
                "<div style=\\"text-align:right\\"><span class=\\"sev-badge "+sevClass+"\\">"+esc(sev)+"</span></div>"+
              "</div>"+
            "</summary>"+
            "<div class=\\"item-body\\">"+
              ((f && f.message)? "<div>"+esc(f.message)+"</div>" : "")+
              suggestion + artHtml +
            "</div>";
          wrap.appendChild(details);
        });

        panel.appendChild(wrap);
        panelsHost.appendChild(panel);
      });
    }

    // ---------- Controls ----------
    function wireControls(){
      $("#btnTheme")?.addEventListener("click", ()=>{
        document.body.classList.toggle("light");
        drawPie();   // recolor & rerender
        wirePieTooltip();
      });

      $("#btnCsv")?.addEventListener("click", ()=>{
        const rows = [["Category","Status","Severity","Title","Message","Suggestion","File","Artifacts"]];
        (RESULT.categories||[]).forEach(c=>{
          (c.findings||[]).forEach(f=>{
            rows.push([
              c.title||"",
              (f && f.status)||"",
              String((f && f.severity) || ""),
              (f && f.title)||"",
              (f && f.message)||"",
              (f && f.suggestion)||"",
              (f && f.file)||"",
              Array.isArray(f && f.artifacts)? (f && f.artifacts).join(" | ") : ((f && f.artifacts)||"")
            ]);
          });
        });
        const csv = rows.map(r=>r.map(cell => '"' + String(cell).replace(/"/g,'""') + '"').join(",")).join("\\r\\n");
        const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "qualisight-findings.csv";
        document.body.appendChild(a); a.click();
        setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
      });

      const tabsHost = $("#catTabs");
      const panelsHost = $("#catPanels");
      tabsHost?.addEventListener("click", (e)=>{
        const btn = (e.target && e.target.closest) ? e.target.closest(".tab") : null; if (!btn) return;
        const catId = btn.id.replace("tab-","");
        $$("#catTabs .tab").forEach(b=> b.setAttribute("aria-selected", b===btn ? "true" : "false"));
        panelsHost?.querySelectorAll(".cat-panel").forEach(p=> p.classList.toggle("hidden", p.id !== ("panel-" + catId)));
        applyFilters();
      });
      tabsHost?.addEventListener("keydown", (e)=>{
        const keys = ["ArrowLeft","ArrowRight","Home","End"]; if (!keys.includes(e.key)) return;
        const buttons = Array.from(tabsHost.querySelectorAll(".tab"));
        let i = buttons.findIndex(b=> b.getAttribute("aria-selected")==="true"); if (i===-1) i=0;
        if (e.key==="ArrowRight") i = (i+1)%buttons.length;
        if (e.key==="ArrowLeft") i = (i-1+buttons.length)%buttons.length;
        if (e.key==="Home") i = 0;
        if (e.key==="End") i = buttons.length-1;
        const next = buttons[i]; if (next){ (next).click(); (next).focus(); }
      });

      const $search = $("#search");
      const $onlyFailed = $("#onlyFailed");
      const $btnExpandAll = $("#btnExpandAll");
      const $btnCollapseAll = $("#btnCollapseAll");

      let t = null;
      $search?.addEventListener("input", ()=>{
        if (t) clearTimeout(t);
        t = setTimeout(applyFilters, 120);
      });
      $onlyFailed?.addEventListener("change", applyFilters);

      $btnExpandAll?.addEventListener("click", ()=>{
        const p = getActivePanel(); if (!p) return;
        p.querySelectorAll(".item").forEach(d => { if ((d).style.display !== "none") (d).open = true; });
      });
      $btnCollapseAll?.addEventListener("click", ()=>{
        const p = getActivePanel(); if (!p) return;
        p.querySelectorAll(".item").forEach(d => { if ((d).style.display !== "none") (d).open = false; });
      });
    }

    function getActivePanel(){
      const panels = $$("#catPanels .cat-panel");
      return panels.find(p => !p.classList.contains("hidden")) || panels[0] || null;
    }

    function applyFilters(){
      const panel = getActivePanel(); if (!panel) return;
      const queryEl = $("#search");
      const onlyFailedEl = $("#onlyFailed");
      const query = norm(queryEl ? (queryEl).value : "").trim();
      const failedOnly = !!(onlyFailedEl && (onlyFailedEl).checked);

      let shown = 0;
      $$(".item", panel).forEach(el=>{
        const ds = (el).dataset || {};
        const matchQuery = !query || (ds.search || "").includes(query);
        const matchStatus = !failedOnly || ds.status === "fail";
        const show = matchQuery && matchStatus;
        (el).style.display = show ? "" : "none";
        if (show) shown++;
      });
      (panel).setAttribute("data-visible-count", String(shown));
    }

    // ---------- Legend ----------
    function renderLegend(cats, colors){
      const legend = $("#catLegend"); if (!legend) return;
      legend.innerHTML = "";
      cats.forEach((c, i)=>{
        const item = document.createElement("div");
        item.className = "legend-item";
        item.setAttribute("data-index", String(i));
        const sw = document.createElement("span");
        sw.className = "legend-swatch";
        sw.style.background = colors[i];
        sw.setAttribute("aria-hidden","true");
        const label = document.createElement("span");
        label.className = "legend-label";
        const pretty = Math.round((Number(c.score)||0)*100)/100;
        label.title = c.title + " (" + pretty + ")";
        label.textContent = c.title;
        item.appendChild(sw);
        item.appendChild(label);
        legend.appendChild(item);
      });
      bindLegendHover();
    }

    // ---------- PIE CHART ----------
    // Exact 360° pie with LRM; duplicates aggregated; zero-score categories omitted from arcs.
    function drawPie(){
      const host = $("#pie"); if (!host) return;
      const rawCats = aggregateCategories(RESULT.categories || []);

      // Split into positive and zero score sets
      const posCats = rawCats.filter(c => Number(c.score) > 0);
      const catsForPie = posCats.length ? posCats : rawCats.slice(); // if all zero, make equal slices
      const total = catsForPie.reduce((a,c)=> a + Math.max(0, Number(c.score)||0), 0);
      const n = catsForPie.length;

      // Colors for ALL categories (legend uses colors for zeros too)
      const colorsAll = makeCategoryColors(rawCats.length);
      const colorMap = new Map();
      rawCats.forEach((c, i)=> colorMap.set(c.key, colorsAll[i]));
      const colorsPie = catsForPie.map(c => colorMap.get(c.key) || "#888");

      // Angle allocation (Largest Remainder Method) to sum exactly 360
      const TOTAL = 360;
      const floats = (total === 0)
        ? catsForPie.map(()=> TOTAL / n)
        : catsForPie.map(c => (Math.max(0, Number(c.score)||0) / total) * TOTAL);
      const base = floats.map(Math.floor);
      let remaining = TOTAL - base.reduce((a,b)=>a+b,0);
      const frac = floats.map((v,i)=>({i, r:v-base[i]})).sort((a,b)=>b.r - a.r);
      for (let k=0;k<remaining;k++) base[frac[k].i]++;

      // Build paths
      const W=260, H=260, CX=130, CY=130, R=100;
      let angle = -90; // start at top

      function polarToXY(cx, cy, r, aDeg){
        const a = (aDeg * Math.PI) / 180;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      }
      function arcPath(cx, cy, r, startAngle, endAngle){
        const large = (endAngle - startAngle) > 180 ? 1 : 0;
        const p0 = polarToXY(cx, cy, r, startAngle);
        const p1 = polarToXY(cx, cy, r, endAngle);
        return [
          "M", cx, cy,
          "L", p0.x, p0.y,
          "A", r, r, 0, large, 1, p1.x, p1.y,
          "Z"
        ].join(" ");
      }

      // Build one <svg> with a single <defs> that contains per-slice radial gradients
      const gradParts = [];
      const sliceParts = [];
      for (let i=0; i<base.length; i++){
        const sweep = base[i];
        if (sweep <= 0) continue;
        const start = angle;
        const end = angle + sweep;
        const d = arcPath(CX, CY, R, start, end);
        const c = catsForPie[i];
        const pretty = Math.round((Number(c.score)||0)*100)/100;
        const label = c.title + " (" + pretty + ")";
        const fillId = "grad-" + i;

        // radial gradient for depth
        gradParts.push(
          '<radialGradient id="' + fillId + '" cx="50%" cy="50%" r="85%">' +
            '<stop offset="0%" stop-color="' + colorsPie[i] + '" stop-opacity="1"/>' +
            '<stop offset="100%" stop-color="' + colorsPie[i] + '" stop-opacity="0.82"/>' +
          '</radialGradient>'
        );

        sliceParts.push(
          '<path data-slice="1" data-index="' + i + '" d="' + d + '" fill="url(#' + fillId + ')"' +
          ' role="img" tabindex="0" aria-label="' + esc(label) + '">' +
            '<title>' + esc(label) + '</title>' +
          '</path>'
        );

        angle = end;
      }

      host.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-label="Category pie">' +
          '<defs>' + gradParts.join('') + '</defs>' +
          sliceParts.join('') +
        '</svg>' +
        '<div class="center">' + (RESULT.overallScore||0) + '/100</div>';

      // Legend for all categories (including zeros)
      renderLegend(rawCats, colorsAll);

      // Hover sync
      bindPieHover(catsForPie, rawCats);

      // Tooltip for slices
      wirePieTooltip();

      // Entrance animation: staggered pop-in
      requestAnimationFrame(()=>{
        const slices = host.querySelectorAll('path[data-slice="1"]');
        slices.forEach((el, i)=>{
          setTimeout(()=> el.classList.add('pop-in'), i*60);
        });
      });
    }

    // ---------- Severity Bars ----------
    function drawBars(){
      const sevColors = { critical:"#ef4444", high:"#f59e0b", medium:"#38bdf8", info:"#7c83ff" };
      const order = ["critical","high","medium","info"];
      const counts = { critical:0, high:0, medium:0, info:0, low:0 };

      (RESULT.categories||[]).forEach(c=>{
        (c.findings||[]).forEach(f=>{
          let s = (f && f.severity ? String(f.severity).toLowerCase() : "info");
          if (s==="low") s="info";
          if (!counts.hasOwnProperty(s)) s="info";
          counts[s]++;
        });
      });

      const max = Math.max(1, counts.critical, counts.high, counts.medium, counts.info);
      const total = counts.critical + counts.high + counts.medium + counts.info;

      const host = $("#sevRows"); if (!host) return;
      host.innerHTML = "";
      order.forEach(key=>{
        const row = document.createElement("div"); row.className="sev-row";
        const pct = Math.round((counts[key]/max)*100);
        row.innerHTML =
          '<div class="sev-name">' + key + '</div>' +
          '<div class="sev-track"><div class="sev-fill" style="width:' + pct + '%; background:' + sevColors[key] + '"></div></div>' +
          '<div class="sev-val">' + counts[key] + '</div>';
        host.appendChild(row);
      });
      const totalLine = $("#sevTotal"); if (totalLine) totalLine.textContent = "Total validations: " + total;
    }

    // ---------- Tooltip (pie) ----------
    function wirePieTooltip(){
      const host = $("#pie"); const tip = $("#tooltip"); if (!host || !tip) return;
      const POS = 12;
      function show(e, el){
        const t = el.getAttribute("aria-label") || "Category";
        tip.textContent = t;
        tip.hidden = false; move(e);
      }
      function move(e){
        const src = (e.touches && e.touches[0]) ? e.touches[0] : e;
        tip.style.left = ((src.clientX||0)+POS)+"px";
        tip.style.top  = ((src.clientY||0)+POS)+"px";
      }
      function hide(){ tip.hidden = true; }
      host.querySelectorAll('[data-slice="1"]').forEach(el=>{
        el.addEventListener("mouseenter", e=>show(e,el));
        el.addEventListener("mousemove",  e=>move(e));
        el.addEventListener("mouseleave", hide);
        el.addEventListener("focus",      e=>show(e,el));
        el.addEventListener("blur",       hide);
        el.addEventListener("touchstart", e=>{ show(e,el); setTimeout(hide,1200); }, {passive:true});
      });
    }

    // ---------- Mutual hover: legend <-> pie ----------
    function bindLegendHover(){
      const legend = $("#catLegend"); const pie = $("#pie"); if (!legend || !pie) return;
      legend.querySelectorAll(".legend-item").forEach(item=>{
        const idx = item.getAttribute("data-index");
        item.addEventListener("mouseenter", ()=>{
          const target = pie.querySelector('[data-slice="1"][data-index="' + idx + '"]');
          if (target){
            target.style.filter = "brightness(1.15) saturate(1.2)";
            target.style.stroke = "#ffffff88";
            target.style.strokeWidth = "1.5";
            target.style.transform = "scale(1.05)";
          }
          item.classList.add("hover");
        });
        item.addEventListener("mouseleave", ()=>{
          const target = pie.querySelector('[data-slice="1"][data-index="' + idx + '"]');
          if (target){
            target.style.filter = "";
            target.style.stroke = "none";
            target.style.strokeWidth = "0";
            target.style.transform = "";
          }
          item.classList.remove("hover");
        });
      });
    }

    function bindPieHover(catsForPie, rawCats){
      const legend = $("#catLegend"); const pie = $("#pie"); if (!legend || !pie) return;
      const legendItems = Array.from(legend.querySelectorAll(".legend-item"));
      pie.querySelectorAll('[data-slice="1"]').forEach(slice=>{
        const pieIdx = Number(slice.getAttribute("data-index"));
        const catKey = (catsForPie[pieIdx] || {}).key;
        const rawIdx = rawCats.findIndex(c => c.key === catKey);
        slice.addEventListener("mouseenter", ()=>{
          const li = legendItems[rawIdx];
          if (li) li.classList.add("hover");
        });
        slice.addEventListener("mouseleave", ()=>{
          const li = legendItems[rawIdx];
          if (li) li.classList.remove("hover");
        });
      });
    }

    // ---------- Init ----------
    function drawAll(){
      renderHeader();
      renderTabsAndPanels();
      wireControls();
      applyFilters();
      drawPie();     // 3D pie with gradients & animation
      drawBars();
      wirePieTooltip();
    }
    drawAll();
  })();
  </script>
</body>
</html>`;

  await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
}
