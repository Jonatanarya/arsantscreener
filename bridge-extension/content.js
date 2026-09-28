/**
 * content.js — jembatan (ISOLATED world) + overlay status crawling.
 *
 * Dua peran:
 *   1. Menyalurkan perintah fetch dari service worker ke pageAgent.js (MAIN
 *      world) dan mengembalikan hasilnya. Content script punya akses
 *      chrome.runtime; MAIN world punya konteks halaman asli. Keduanya
 *      disambung lewat window.postMessage.
 *   2. Menampilkan overlay progress ringkas di halaman Stockbit, di dalam
 *      Shadow DOM supaya CSS-nya tidak bertabrakan dengan panel app.js maupun
 *      style Stockbit.
 */
(() => {
  if (window.__TW_COLLECTOR_CONTENT) return;
  window.__TW_COLLECTOR_CONTENT = true;

  let port = null;
  let progress = null;
  let keepaliveTimer = null;

  // -------------------------------------------------------------------------
  // Koneksi ke service worker
  // -------------------------------------------------------------------------
  function nextBuildId() {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (el && el.textContent) return (JSON.parse(el.textContent) || {}).buildId || null;
    } catch (e) {}
    return null;
  }

  function connect() {
    try {
      port = chrome.runtime.connect({ name: 'tw-collector' });
    } catch (e) {
      // extension baru saja di-reload: coba lagi sebentar lagi
      setTimeout(connect, 3000);
      return;
    }

    port.postMessage({ type: 'HELLO', buildId: nextBuildId(), url: location.href });

    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'EXEC') {
        window.postMessage({ __TW_AGENT: 'req', id: msg.id, req: msg.req }, location.origin);
      } else if (msg.type === 'PROGRESS') {
        progress = msg.progress;
        render();
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 2000);
    });
  }

  // Keepalive: selama engine jalan, pesan berkala menahan service worker MV3
  // tetap hidup sehingga jeda jitter (3–7 detik) tidak terputus.
  function startKeepalive() {
    if (keepaliveTimer) return;
    keepaliveTimer = setInterval(() => {
      if (!port) return;
      try { port.postMessage({ type: 'KEEPALIVE' }); } catch (e) {}
    }, 20000);
  }

  // -------------------------------------------------------------------------
  // Jembatan ke pageAgent (MAIN world)
  // -------------------------------------------------------------------------
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || !d.__TW_AGENT) return;
    if (d.__TW_AGENT === 'res' && port) {
      try { port.postMessage({ type: 'EXEC_RESULT', id: d.id, result: d.result }); } catch (e) {}
    } else if ((d.__TW_AGENT === 'auth' || d.__TW_AGENT === 'ready') && d.token && port) {
      try { port.postMessage({ type: 'AUTH', token: d.token, source: 'pageAgent' }); } catch (e) {}
    } else if (d.__TW_AGENT === 'seen' && Array.isArray(d.urls) && port) {
      // URL API yang dipanggil halaman -> bahan belajar template request
      try { port.postMessage({ type: 'SEEN', urls: d.urls }); } catch (e) {}
    }
  });

  function send(type, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...(extra || {}) }, (res) => {
          void chrome.runtime.lastError;
          resolve(res || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
      width: 280px; font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e6edf3; background: rgba(13,17,23,.96); border: 1px solid #30363d;
      border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.45); overflow: hidden;
      backdrop-filter: blur(6px);
    }
    .wrap.collapsed .body { display: none; }
    .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer;
            background: linear-gradient(180deg,#161b22,#0d1117); border-bottom: 1px solid #21262d; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #6e7681; flex: none; }
    .dot.running { background: #3fb950; box-shadow: 0 0 8px #3fb95088; animation: pulse 1.6s infinite; }
    .dot.paused { background: #d29922; }
    .dot.cooldown { background: #f85149; }
    .dot.done { background: #58a6ff; }
    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
    .title { font-weight: 600; font-size: 12px; letter-spacing: .2px; flex: 1; }
    .chev { color: #8b949e; font-size: 10px; }
    .body { padding: 10px; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
    .k { color: #8b949e; }
    .v { color: #e6edf3; font-variant-numeric: tabular-nums; text-align: right; }
    .bar { height: 5px; background: #21262d; border-radius: 3px; overflow: hidden; margin: 8px 0 6px; }
    .fill { height: 100%; background: linear-gradient(90deg,#238636,#3fb950); transition: width .4s ease; }
    .sym { color: #58a6ff; font-weight: 600; }
    .err { color: #f85149; margin-top: 6px; word-break: break-word; }
    .warn { color: #d29922; margin-top: 6px; }
    .btns { display: flex; gap: 6px; margin-top: 9px; }
    button {
      flex: 1; padding: 5px 6px; font-size: 11px; font-family: inherit; cursor: pointer;
      background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px;
    }
    button:hover { background: #30363d; }
    button.stop { color: #f85149; }
    .idle { color: #8b949e; text-align: center; padding: 4px 0; }
  `;

  const COLLAPSE_KEY = '__tw_collector_collapsed';
  let root = null, el = {};

  function mount() {
    if (root || !document.body) return;
    const host = document.createElement('div');
    host.id = 'tw-collector-overlay';
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    // Overlay ini satu-satunya UI collector di halaman, jadi bawaannya TERBUKA.
    // Pilihan buka/tutup user diingat lintas navigasi.
    let collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) {}

    const wrap = document.createElement('div');
    wrap.className = `wrap${collapsed ? ' collapsed' : ''}`;
    wrap.innerHTML = `
      <div class="head">
        <span class="dot"></span>
        <span class="title">Arsant Screener Collector</span>
        <span class="chev">${collapsed ? '▲' : '▼'}</span>
      </div>
      <div class="body">
        <div class="idle">Engine idle. Buka popup extension untuk memulai.</div>
        <div class="stats" style="display:none">
          <div class="row"><span class="k">Fase</span><span class="v phase">—</span></div>
          <div class="row"><span class="k">Emiten</span><span class="v sym">—</span></div>
          <div class="bar"><div class="fill" style="width:0%"></div></div>
          <div class="row"><span class="k">Progres</span><span class="v pct">0%</span></div>
          <div class="row"><span class="k">Request</span><span class="v reqs">0</span></div>
          <div class="row"><span class="k">Sukses / Gagal</span><span class="v okfail">0 / 0</span></div>
          <div class="row"><span class="k">Dilewati</span><span class="v skipped">0</span></div>
          <div class="row"><span class="k">Berikutnya</span><span class="v next">—</span></div>
          <div class="msg"></div>
        </div>
        <div class="btns">
          <button class="toggle">Pause</button>
          <button class="stop">Stop</button>
        </div>
      </div>`;
    root.appendChild(wrap);

    el = {
      wrap,
      dot: wrap.querySelector('.dot'),
      chev: wrap.querySelector('.chev'),
      idle: wrap.querySelector('.idle'),
      stats: wrap.querySelector('.stats'),
      phase: wrap.querySelector('.phase'),
      sym: wrap.querySelector('.sym'),
      fill: wrap.querySelector('.fill'),
      pct: wrap.querySelector('.pct'),
      reqs: wrap.querySelector('.reqs'),
      okfail: wrap.querySelector('.okfail'),
      skipped: wrap.querySelector('.skipped'),
      next: wrap.querySelector('.next'),
      msg: wrap.querySelector('.msg'),
      toggle: wrap.querySelector('.toggle'),
      stopBtn: wrap.querySelector('.stop'),
    };

    wrap.querySelector('.head').addEventListener('click', () => {
      const isCollapsed = wrap.classList.toggle('collapsed');
      el.chev.textContent = isCollapsed ? '▲' : '▼';
      try { localStorage.setItem(COLLAPSE_KEY, isCollapsed ? '1' : '0'); } catch (e) {}
    });
    el.toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      const running = progress && (progress.status === 'running' || progress.status === 'cooldown');
      const res = await send(running ? 'PAUSE' : 'RESUME');
      if (res.progress) { progress = res.progress; render(); }
    });
    el.stopBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await send('STOP');
      progress = res.progress || null;
      render();
    });
  }

  const PHASE_LABEL = { global: 'Discovery pasar', symbols: 'Crawling emiten', done: 'Selesai' };
  const STATUS_LABEL = {
    idle: 'Idle', running: 'Berjalan', paused: 'Dijeda',
    cooldown: 'Cooldown rate-limit', done: 'Selesai', error: 'Error',
  };

  function render() {
    if (!root) mount();
    if (!root) return;
    const p = progress;

    if (!p || p.status === 'idle') {
      el.dot.className = 'dot';
      el.idle.style.display = '';
      el.stats.style.display = 'none';
      el.toggle.textContent = 'Resume';
      return;
    }

    el.idle.style.display = 'none';
    el.stats.style.display = '';
    el.dot.className = `dot ${p.status}`;
    const passTxt = p.passTotal > 1 && p.phase === 'symbols' ? ` · tahap ${p.pass}/${p.passTotal}` : '';
    el.phase.textContent = `${STATUS_LABEL[p.status] || p.status} — ${PHASE_LABEL[p.phase] || p.phase || '—'}${passTxt}`;
    el.sym.textContent = p.symbol ? `${p.symbol} (${p.symbolIndex + 1}/${p.symbolTotal})` : '—';
    el.fill.style.width = `${p.percent || 0}%`;
    el.pct.textContent = `${p.percent || 0}%`;
    const c = p.counters || {};
    el.reqs.textContent = `${c.requests || 0} / ±${p.estimatedTotal || 0}`;
    el.okfail.textContent = `${c.ok || 0} / ${c.failed || 0}`;
    el.skipped.textContent = `${c.skippedSymbols || 0} emiten`;

    if (p.cooldownUntil && Date.now() < p.cooldownUntil) {
      el.next.textContent = `cooldown ${Math.ceil((p.cooldownUntil - Date.now()) / 1000)} dtk`;
    } else if (p.nextRunAt) {
      const s = Math.max(0, Math.ceil((p.nextRunAt - Date.now()) / 1000));
      el.next.textContent = s > 0 ? `${s} dtk` : 'sekarang';
    } else {
      el.next.textContent = '—';
    }

    el.msg.className = 'msg';
    el.msg.textContent = '';
    if (p.status === 'paused' && p.pausedReason === 'auth') {
      el.msg.className = 'msg warn';
      el.msg.textContent = 'Token ditolak — refresh halaman ini lalu Resume.';
    } else if (p.status === 'paused' && p.pausedReason === 'no-tab') {
      el.msg.className = 'msg warn';
      el.msg.textContent = 'Menunggu tab Stockbit aktif.';
    } else if (c.rateLimits) {
      el.msg.className = 'msg warn';
      el.msg.textContent = `${c.rateLimits}x kena rate limit (429/403).`;
    } else if (p.lastError) {
      el.msg.className = 'msg err';
      el.msg.textContent = p.lastError;
    }

    el.toggle.textContent = (p.status === 'running' || p.status === 'cooldown') ? 'Pause' : 'Resume';
  }

  // hitung mundur "berikutnya" tetap jalan walau tidak ada pesan baru
  setInterval(() => {
    if (progress && (progress.status === 'running' || progress.status === 'cooldown')) render();
  }, 1000);

  function boot() {
    mount();
    connect();
    startKeepalive();
    send('GET_PROGRESS').then((r) => { if (r.progress) { progress = r.progress; render(); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
