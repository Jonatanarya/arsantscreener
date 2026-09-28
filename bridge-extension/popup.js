/**
 * popup.js — panel kontrol ringkas engine collector.
 * Semua state hidup di service worker; popup hanya menampilkan & mengirim perintah.
 */
const $ = (id) => document.getElementById(id);

function send(type, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...(extra || {}) }, (res) => {
      void chrome.runtime.lastError;
      resolve(res || {});
    });
  });
}

function collectPatch() {
  return {
    backendUrl: $('backendUrl').value.trim(),
    categories: [...document.querySelectorAll('.cat')].filter((c) => c.checked).map((c) => c.value),
    customSymbols: $('customSymbols').value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
    customOnly: $('customOnly').checked,
    maxSymbols: Number($('maxSymbols').value) || 0,
    liquidityOnlyHeavy: $('liquidityOnlyHeavy').checked,
    liquidityCandidateLimit: Math.max(10, Math.min(900, Number($('liquidityCandidateLimit').value) || 100)),
  };
}

function applySettings(s) {
  $('backendUrl').value = s.backendUrl || '';
  $('customSymbols').value = (s.customSymbols || []).join(', ');
  $('customOnly').checked = !!s.customOnly;
  $('maxSymbols').value = String(s.maxSymbols || 0);
  $('liquidityOnlyHeavy').checked = !!s.liquidityOnlyHeavy;
  $('liquidityCandidateLimit').value = String(s.liquidityCandidateLimit || 100);
  for (const c of document.querySelectorAll('.cat')) {
    c.checked = (s.categories || []).includes(c.value);
  }
}

/**
 * Kedalaman histori TIDAK bisa diubah dari popup — hanya ditampilkan. Dulu ada
 * dropdown `years` di sini yang isinya bisa berbeda dari tabel per-jenis-data di
 * halaman Setelan, jadi dua tempat mengklaim hal yang sama. Teksnya dihitung di
 * service worker dengan describeDepth(), fungsi yang sama dipakai engine.
 */
function renderDepthSummary(rows) {
  const box = $('depthSummary');
  if (!rows || !rows.length) { box.textContent = '—'; return; }
  box.innerHTML = '';
  for (const r of rows) {
    const line = document.createElement('div');
    const k = document.createElement('span'); k.className = 'dk'; k.textContent = r.label;
    const v = document.createElement('span'); v.className = 'dv'; v.textContent = r.text;
    line.append(k, v);
    box.appendChild(line);
  }
}

// ---- konfirmasi lanjut / mulai baru ----
let pendingPatch = null;

function fmtAgo(ts) {
  if (!ts) return '—';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} jam lalu` : `${Math.round(h / 24)} hari lalu`;
}

function showResumeAsk(info, patch) {
  pendingPatch = patch;
  const posisi = info.phase === 'global'
    ? 'masih di tahap data pasar (discovery)'
    : `tahap ${info.pass}/${info.passTotal}, emiten ${info.symbolIndex + 1}/${info.symbolTotal}` +
      `${info.symbol ? ` (${info.symbol})` : ''}`;
  $('resumeInfo').textContent =
    `${info.percent}% — ${posisi}. ${info.requests} request sukses, ` +
    `${info.skippedExisting} dilewati. Aktivitas terakhir ${fmtAgo(info.updatedAt || info.startedAt)}.`;
  $('resumeAsk').hidden = false;
}

function hideResumeAsk() {
  $('resumeAsk').hidden = true;
  pendingPatch = null;
}

const STATUS_LABEL = {
  idle: 'Idle', running: 'Berjalan', paused: 'Dijeda',
  cooldown: 'Cooldown rate-limit', done: 'Selesai', error: 'Error',
};
const PHASE_LABEL = { global: 'Discovery pasar', symbols: 'Crawling emiten', done: 'Selesai' };

function renderProgress(p) {
  const status = (p && p.status) || 'idle';
  $('dot').className = `dot ${status}`;
  const passTxt = p && p.passTotal > 1 && p.phase === 'symbols' ? ` · tahap ${p.pass}/${p.passTotal}` : '';
  const phaseTxt = `${STATUS_LABEL[status] || status}${p && p.phase ? ` — ${PHASE_LABEL[p.phase] || p.phase}` : ''}${passTxt}`;
  $('phase').textContent = p && p.pausedReason && status === 'paused'
    ? `${phaseTxt} (${p.pausedReason === 'auth' ? 'token ditolak' : p.pausedReason === 'no-tab' ? 'tab Stockbit tertutup' : p.pausedReason})`
    : phaseTxt;

  const c = (p && p.counters) || {};
  $('curSymbol').textContent = p && p.symbol ? `${p.symbol} (${p.symbolIndex + 1}/${p.symbolTotal})` : '—';
  $('fill').style.width = `${(p && p.percent) || 0}%`;
  $('pct').textContent = `${(p && p.percent) || 0}%`;
  $('reqs').textContent = `${c.requests || 0} / ±${(p && p.estimatedTotal) || 0} (${c.ok || 0}/${c.failed || 0})`;
  $('skippedExisting').textContent = String(c.skippedExisting || 0);
  $('skipped').textContent = String(c.skippedSymbols || 0);

  // Pesan penutup: paling penting saat user tidak sengaja menarik ulang
  // periode yang datanya sudah lengkap.
  const done = $('doneMsg');
  if (p && p.doneMessage && (status === 'done' || status === 'idle')) {
    done.style.display = '';
    done.textContent = (c.requests === 0 && c.skippedExisting > 0 ? 'ℹ ' : '✔ ') + p.doneMessage;
  } else {
    done.style.display = 'none';
  }
  $('relayed').textContent = String(c.relayed || 0);
  $('rl').textContent = String(c.rateLimits || 0);

  if (p && p.cooldownUntil && Date.now() < p.cooldownUntil) {
    $('next').textContent = `cooldown ${Math.ceil((p.cooldownUntil - Date.now()) / 1000)} dtk`;
  } else if (p && p.nextRunAt && status === 'running') {
    const s = Math.max(0, Math.ceil((p.nextRunAt - Date.now()) / 1000));
    $('next').textContent = s > 0 ? `${s} dtk` : 'sekarang';
  } else {
    $('next').textContent = '—';
  }

  const running = status === 'running' || status === 'cooldown';
  const active = running || status === 'paused';
  $('btnStart').disabled = active;
  $('btnPause').disabled = !running;
  $('btnResume').disabled = status !== 'paused';
  $('btnStop').disabled = !active && status !== 'done';

  $('badgeTab').textContent = `tab ${(p && p.tabs) || 0}`;
  $('badgeTab').className = `badge ${p && p.tabs ? 'ok' : 'bad'}`;
}

function renderLogs(logs) {
  const box = $('logs');
  box.innerHTML = '';
  for (const l of (logs || []).slice(-80)) {
    const d = document.createElement('div');
    d.className = `lvl-${l.level}`;
    const t = new Date(l.t).toLocaleTimeString('id-ID', { hour12: false });
    d.textContent = `${t}  ${l.message}`;
    box.appendChild(d);
  }
  box.scrollTop = box.scrollHeight;
}

function renderAuth(auth) {
  const b = $('badgeAuth');
  if (auth && auth.hasToken) {
    const expired = auth.exp && Date.now() > auth.exp;
    b.textContent = expired ? 'token basi' : 'token ok';
    b.className = `badge ${expired ? 'bad' : 'ok'}`;
  } else {
    b.textContent = 'token —';
    b.className = 'badge bad';
  }
}

async function refresh(full) {
  if (full) {
    const st = await send('GET_STATE');
    if (st.settings) applySettings(st.settings);
    renderDepthSummary(st.depth);
    renderAuth(st.auth);
    renderLogs(st.logs);
    renderProgress(st.progress);
  } else {
    const [{ progress }, { logs }] = await Promise.all([send('GET_PROGRESS'), send('GET_LOGS', { limit: 80 })]);
    renderProgress(progress);
    renderLogs(logs);
  }
}

async function estimate() {
  const { plan } = await send('ESTIMATE', { patch: collectPatch() });
  if (!plan) return;
  $('estimate').textContent =
    `${plan.symbols} emiten × ${plan.jobsPerSymbol} job — ` +
    `${plan.requestsMin.toLocaleString('id-ID')}–${plan.requestsMax.toLocaleString('id-ID')} request ` +
    `(±${plan.estimatedHoursMin}–${plan.estimatedHours} jam). Rentangnya tergantung berapa emiten yang lolos filter kategori.`;
}

// ---- event ----
document.addEventListener('DOMContentLoaded', async () => {
  await refresh(true);
  estimate();

  for (const el of ['maxSymbols', 'customOnly', 'customSymbols', 'liquidityOnlyHeavy', 'liquidityCandidateLimit']) {
    $(el).addEventListener('change', estimate);
  }
  for (const c of document.querySelectorAll('.cat')) c.addEventListener('change', estimate);

  $('btnStart').addEventListener('click', async () => {
    const patch = collectPatch();
    if (!patch.categories.length && !patch.customOnly) {
      $('estimate').textContent = 'Pilih minimal satu kategori, atau aktifkan mode kustom.';
      return;
    }
    // Start TIDAK langsung menimpa antrean yang belum selesai — tanya dulu,
    // karena startEngine() mengembalikan kursor ke nol.
    const { resumable } = await send('RESUMABLE');
    if (resumable) { showResumeAsk(resumable, patch); return; }
    await send('START', { patch, mode: 'new' });
    refresh(true);
  });

  $('btnContinue').addEventListener('click', async () => {
    hideResumeAsk();
    // setelan tetap disimpan: kedalaman/saringan boleh berubah di tengah crawl
    await send('START', { patch: pendingPatch, mode: 'continue' });
    refresh(true);
  });
  $('btnFresh').addEventListener('click', async () => {
    hideResumeAsk();
    await send('START', { patch: pendingPatch, mode: 'new' });
    refresh(true);
  });
  $('btnCancelAsk').addEventListener('click', () => hideResumeAsk());
  $('btnPause').addEventListener('click', async () => { await send('PAUSE'); refresh(); });
  $('btnResume').addEventListener('click', async () => { await send('RESUME'); refresh(); });
  $('btnStop').addEventListener('click', async () => { await send('STOP'); refresh(); });

  $('btnTest').addEventListener('click', async () => {
    await send('SAVE_SETTINGS', { patch: { backendUrl: $('backendUrl').value.trim() } });
    $('backendHint').textContent = 'Menguji…';
    const { result } = await send('TEST_BACKEND');
    if (result && result.ok) {
      $('backendHint').textContent = `✔ Backend terjangkau (HTTP ${result.status}).`;
    } else if (result && result.hint) {
      // server MENJAWAB, cuma menolak request — beda dengan backend mati
      $('backendHint').textContent = `⚠ HTTP ${result.status}: ${result.hint}`;
    } else {
      $('backendHint').textContent = `✖ Tidak terjangkau: ${(result && (result.error || `HTTP ${result.status}`)) || 'gagal'}`;
    }
  });

  $('openDepth').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  // Setelan diubah di tab lain: begitu popup dilihat lagi, angkanya ikut segar.
  window.addEventListener('focus', () => { refresh(true).catch(() => {}); });

  $('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('clearLogs').addEventListener('click', async (e) => {
    e.preventDefault();
    await send('CLEAR_LOGS');
    renderLogs([]);
  });

  setInterval(() => refresh(false), 1000);
});
