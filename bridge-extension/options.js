/**
 * options.js — setelan lanjutan: backend, parameter anti-bot, ambang
 * klasifikasi, pemilihan endpoint, penguji endpoint, dan tabel hasil klasifikasi.
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

const NUM_FIELDS = [
  'minDelayMs', 'maxDelayMs', 'batchMin', 'batchMax',
  'longPauseMinMs', 'longPauseMaxMs', 'cooldownMinMs', 'cooldownMaxMs',
  'maxRetries', 'requestTimeoutMs', 'refreshAfterDays',
];
const TEXT_FIELDS = ['backendUrl', 'backendApiKey', 'rawPath', 'screenerTemplateId', 'historicalPeriod'];
const BOOL_FIELDS = ['relayEnabled', 'relayRaw', 'skipExisting'];
const SELECT_FIELDS = ['investorType', 'marketBoard'];

let catalog = [];
let settings = null;

function applySettings(s) {
  settings = s;
  for (const f of TEXT_FIELDS) $(f).value = s[f] ?? '';
  for (const f of NUM_FIELDS) $(f).value = s[f] ?? '';
  for (const f of BOOL_FIELDS) $(f).checked = !!s[f];
  for (const f of SELECT_FIELDS) $(f).value = s[f] ?? '';
  $('thBluechip').value = s.tierThresholds.bluechip;
  $('thSecond').value = s.tierThresholds.second;
}

function collectPatch() {
  const patch = { endpoints: {} };
  for (const f of TEXT_FIELDS) patch[f] = $(f).value.trim();
  for (const f of NUM_FIELDS) patch[f] = Number($(f).value) || 0;
  for (const f of BOOL_FIELDS) patch[f] = $(f).checked;
  for (const f of SELECT_FIELDS) patch[f] = $(f).value;
  patch.tierThresholds = {
    bluechip: Number($('thBluechip').value) || 10e12,
    second: Number($('thSecond').value) || 500e9,
  };
  for (const cb of document.querySelectorAll('.epcb')) patch.endpoints[cb.dataset.id] = cb.checked;
  // hanya kirim kalau kartunya sudah tergambar, supaya kegagalan render
  // tidak menimpa setelan kedalaman dengan objek kosong
  if (Object.keys(depthState).length) patch.depth = collectDepth();
  patch.customSymbols = [...picked];
  patch.customOnly = $('customOnly').checked;
  return patch;
}

function renderEndpoints(list) {
  catalog = list;
  const groups = {};
  for (const ep of list) (groups[ep.group] = groups[ep.group] || []).push(ep);

  const box = $('endpoints');
  box.innerHTML = '';
  for (const [group, eps] of Object.entries(groups)) {
    const div = document.createElement('div');
    div.className = 'epgroup';
    const h = document.createElement('h3');
    h.textContent = group;
    div.appendChild(h);
    const ul = document.createElement('div');
    ul.className = 'eplist';
    for (const ep of eps) {
      const row = document.createElement('label');
      row.className = 'ep';
      row.innerHTML = `
        <input type="checkbox" class="epcb" data-id="${ep.id}" ${ep.enabled ? 'checked' : ''} />
        <span>${ep.label}</span>
        <span class="tag">${ep.scope === 'global' ? 'global' : 'per emiten'}</span>
        ${ep.perYear ? '<span class="tag year">×jendela</span>' : ''}
        ${ep.needsTemplate ? `<span class="tag ${ep.hasTemplate ? '' : 'year'}">${ep.hasTemplate ? 'template ✔' : 'butuh template'}</span>` : ''}`;
      ul.appendChild(row);
    }
    div.appendChild(ul);
    box.appendChild(div);
  }

  const sel = $('testEndpoint');
  sel.innerHTML = '';
  for (const ep of list) {
    const o = document.createElement('option');
    o.value = ep.id;
    o.textContent = `${ep.group} — ${ep.label}`;
    sel.appendChild(o);
  }
}

function flashSaved() {
  $('saved').classList.add('show');
  setTimeout(() => $('saved').classList.remove('show'), 1400);
}

async function save() {
  const res = await send('SAVE_SETTINGS', { patch: collectPatch() });
  if (res.settings) applySettings(res.settings);
  flashSaved();
}

const fmtRp = (n) => {
  if (!n) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} Jt`;
  return String(n);
};

// Halaman Stockbit yang memicu tiap endpoint — supaya user tahu harus membuka
// apa agar template-nya terpelajari.
const TEMPLATE_HINT = {
  ihsg_market: 'Halaman utama / Stream (widget IHSG)',
  broker_top: 'Broker Analysis → Top Broker',
  historical_summary: 'Halaman simbol → tab Price / Historical',
  broker_activity_historical: 'Broker Analysis → Broker Activity (ubah rentang tanggal)',
  running_trade_chart: 'Halaman simbol → Running Trade / Chart',
  broker_distribution: 'Halaman simbol → Bandar Detector → Distribusi Broker',
};

async function loadTemplates() {
  const { templates, pending } = await send('TEMPLATE_STATUS');
  const tbody = $('templateTable').querySelector('tbody');
  tbody.innerHTML = '';

  const pendingIds = new Set((pending || []).map((p) => p.id));
  const rows = [
    ...(pending || []).map((p) => ({ id: p.id, label: p.label, ok: false })),
    ...Object.keys(templates || {})
      .filter((id) => !pendingIds.has(id))
      .map((id) => ({ id, label: id, ok: true, url: templates[id].url })),
  ];

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#8b949e">Belum ada endpoint yang butuh template.</td></tr>';
    return;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${r.label}</b></td>
      <td>${r.ok ? '<span class="ok">✔ terpelajari</span>' : '<span class="warn">⏳ menunggu</span>'}</td>
      <td style="color:#8b949e;word-break:break-all">${r.ok ? (r.url || '').slice(0, 110) : (TEMPLATE_HINT[r.id] || '—')}</td>`;
    tbody.appendChild(tr);
  }
}

// ---- saringan emiten ----
// Daftar seluruh emiten BEI dibaca dari idx-universe.js lewat service worker
// (berkas extension, tanpa request ke Stockbit). Yang dicentang disimpan sebagai
// `customSymbols`; `customOnly` menentukan apakah sisanya diabaikan atau hanya
// diturunkan prioritasnya.
let universe = [];
let picked = new Set();

function symMatches(r) {
  const q = ($('symSearch').value || '').trim().toLowerCase();
  const board = $('symBoard').value || '';
  if (board && r.board !== board) return false;
  if (!q) return true;
  return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
}

function renderSymCount() {
  const shown = universe.filter(symMatches).length;
  $('symCount').textContent =
    `${picked.size} dicentang dari ${universe.length} emiten` +
    (shown !== universe.length ? ` · ${shown} tampil` : '');
}

function renderSymList() {
  const box = $('symList');
  box.innerHTML = '';
  const rows = universe.filter(symMatches);
  if (!rows.length) {
    box.innerHTML = '<div style="color:#8b949e;font-size:12px;padding:6px">Tidak ada emiten yang cocok.</div>';
    renderSymCount();
    return;
  }
  // 900+ baris aman digambar sekali; kontainernya yang di-scroll.
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const label = document.createElement('label');
    label.className = 'ep';
    label.title = `${r.name}${r.board ? ` · ${r.board}` : ''}${r.listed ? ` · tercatat ${r.listed}` : ''}`;
    label.innerHTML = `
      <input type="checkbox" class="symcb" data-code="${r.code}"${picked.has(r.code) ? ' checked' : ''} />
      <span style="font-weight:600;min-width:44px">${r.code}</span>
      <span style="color:#8b949e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</span>`;
    frag.appendChild(label);
  }
  box.appendChild(frag);
  for (const cb of box.querySelectorAll('.symcb')) {
    cb.addEventListener('change', () => {
      if (cb.checked) picked.add(cb.dataset.code);
      else picked.delete(cb.dataset.code);
      renderSymCount();
    });
  }
  renderSymCount();
}

async function loadUniverseList() {
  const res = await send('UNIVERSE_LIST');
  universe = res.symbols || [];
  picked = new Set(res.selected || []);
  $('customOnly').checked = !!res.customOnly;

  const boards = [...new Set(universe.map((r) => r.board).filter(Boolean))].sort();
  $('symBoard').innerHTML = '<option value="">Semua papan</option>' +
    boards.map((b) => `<option value="${b}">${b}</option>`).join('');

  $('symSearch').addEventListener('input', renderSymList);
  $('symBoard').addEventListener('change', renderSymList);
  $('symAll').addEventListener('click', () => {
    for (const r of universe) picked.add(r.code);
    renderSymList();
  });
  $('symNone').addEventListener('click', () => { picked.clear(); renderSymList(); });
  $('symVisible').addEventListener('click', () => {
    for (const r of universe.filter(symMatches)) picked.add(r.code);
    renderSymList();
  });
  renderSymList();
}

// ---- kedalaman histori per jenis data ----
const DEPTH_KEYS = {
  chart: 'Candle & harga harian',
  historical: 'Ringkasan historis (daily/weekly/monthly)',
  broker: 'Broker summary & bandarmologi',
  runningTrade: 'Running trade (cetakan transaksi)',
  ownership: 'Kepemilikan & insider',
  default: 'Endpoint lainnya',
};
const DEPTH_META = {
  chart:        { ico: '\u{1F4C8}', hint: 'ringan — aman diambil dalam' },
  historical:   { ico: '\u{1F4CA}', hint: 'ringan, 3 periode sekaligus' },
  broker:       { ico: '\u{1F3E6}', hint: 'sedang — 1 request per hari bursa' },
  runningTrade: { ico: '\u{1F9FE}', hint: 'PALING berat — ribuan cetakan/hari' },
  ownership:    { ico: '\u{1F465}', hint: 'ringan, terbit bulanan' },
  default:      { ico: '\u2699\uFE0F', hint: 'profil, dividen, rasio' },
};
const DEPTH_UNITS = { days: 'hari', weeks: 'minggu', months: 'bulan', years: 'tahun' };
const UNIT_DAYS = { days: 1, weeks: 7, months: 30, years: 365 };
const DEPTH_PRESETS = [
  { label: '1 bln', value: 1, unit: 'months' },
  { label: '3 bln', value: 3, unit: 'months' },
  { label: '6 bln', value: 6, unit: 'months' },
  { label: '1 thn', value: 1, unit: 'years' },
  { label: '2 thn', value: 2, unit: 'years' },
  { label: '5 thn', value: 5, unit: 'years' },
];

// Sumber kebenaran kedalaman dipegang di sini, bukan di DOM. Dengan begitu
// kontrol yang tidak relevan boleh benar-benar disembunyikan tanpa membuat
// nilainya hilang saat disimpan.
let depthState = {};

function spanFrom(d, to) {
  const days = Math.max(1, Number(d.value) || 1) * (UNIT_DAYS[d.unit] || 365);
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  return from.toISOString().slice(0, 10);
}

function effectiveRange(d) {
  const today = new Date().toISOString().slice(0, 10);
  if (d.mode === 'range') {
    if (!d.from) return '\u26A0 tanggal "dari" belum diisi';
    return `${d.from} \u2192 ${d.to || today}`;
  }
  return `${spanFrom(d, today)} \u2192 ${today}`;
}

function renderDepth(depth) {
  // normalisasi sekali; setelah ini semua interaksi menulis ke depthState
  depthState = {};
  for (const key of Object.keys(DEPTH_KEYS)) {
    depthState[key] = { mode: 'span', unit: 'years', value: 5, from: '', to: '', ...((depth || {})[key] || {}) };
  }

  const wrap = $('depthCards');
  wrap.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);

  for (const [key, label] of Object.entries(DEPTH_KEYS)) {
    const d = depthState[key];
    const isRange = d.mode === 'range';
    const meta = DEPTH_META[key] || { ico: '\u2022', hint: '' };

    const card = document.createElement('div');
    card.className = 'dcard';
    card.innerHTML = `
      <div class="dcard-top">
        <span class="dcard-ico">${meta.ico}</span>
        <div style="flex:1;min-width:0">
          <div class="dcard-name">${label}</div>
          <div class="dcard-sub">${meta.hint}</div>
        </div>
      </div>
      <div class="seg">
        <button type="button" data-k="${key}" data-mode="span"${isRange ? '' : ' class="on"'}>N satuan</button>
        <button type="button" data-k="${key}" data-mode="range"${isRange ? ' class="on"' : ''}>Rentang tanggal</button>
      </div>
      ${isRange ? `
        <div class="drow">
          <label>Dari</label>
          <input type="date" data-k="${key}" data-f="from" value="${d.from || ''}" max="${today}" />
        </div>
        <div class="drow">
          <label>Sampai</label>
          <input type="date" data-k="${key}" data-f="to" value="${d.to || ''}" max="${today}"
                 title="Kosongkan untuk memakai hari ini" />
        </div>
      ` : `
        <div class="presets">
          ${DEPTH_PRESETS.map((p) => {
            const on = Number(d.value) === p.value && d.unit === p.unit;
            return `<button type="button" data-k="${key}" data-pv="${p.value}" data-pu="${p.unit}"${on ? ' class="on"' : ''}>${p.label}</button>`;
          }).join('')}
        </div>
        <div class="drow">
          <label>Lain</label>
          <input type="number" data-k="${key}" data-f="value" min="1" max="9999" value="${d.value}" />
          <select data-k="${key}" data-f="unit">
            ${Object.entries(DEPTH_UNITS).map(([u, l]) =>
              `<option value="${u}"${d.unit === u ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      `}
      <div class="deff">${effectiveRange(d)}</div>`;
    wrap.appendChild(card);
  }

  // --- interaksi: tulis ke depthState lalu gambar ulang ---
  for (const b of wrap.querySelectorAll('.seg button')) {
    b.addEventListener('click', () => {
      const d = depthState[b.dataset.k];
      d.mode = b.dataset.mode;
      if (d.mode === 'span') {
        // Permintaan: begitu kembali ke "N satuan", tanggalnya dikosongkan
        // supaya tidak ada nilai tersembunyi yang membingungkan.
        d.from = ''; d.to = '';
      } else if (!d.from) {
        // Pindah ke rentang: isi otomatis dari span yang sedang berlaku,
        // jadi tanggalnya tidak pernah kosong tanpa alasan.
        d.from = spanFrom(d, today); d.to = today;
      }
      renderDepth(depthState);
    });
  }
  for (const b of wrap.querySelectorAll('.presets button')) {
    b.addEventListener('click', () => {
      const d = depthState[b.dataset.k];
      d.value = Number(b.dataset.pv); d.unit = b.dataset.pu;
      renderDepth(depthState);
    });
  }
  for (const el of wrap.querySelectorAll('input[data-f], select[data-f]')) {
    el.addEventListener('change', () => {
      const d = depthState[el.dataset.k];
      d[el.dataset.f] = el.dataset.f === 'value' ? (Number(el.value) || 1) : el.value;
      renderDepth(depthState);
    });
  }
}

function collectDepth() {
  const out = {};
  for (const [k, d] of Object.entries(depthState)) {
    out[k] = d.mode === 'range'
      ? { mode: 'range', from: d.from || '', to: d.to || '', value: d.value, unit: d.unit }
      : { mode: 'span', value: d.value, unit: d.unit, from: '', to: '' };
  }
  return out;
}

async function loadClasses() {
  const { classes, summary, total } = await send('GET_CLASSES');
  $('classSummary').textContent = total
    ? `${total} emiten terklasifikasi — bluechip ${summary.bluechip || 0}, second ${summary.second || 0}, ` +
      `third ${summary.third || 0}, belum diketahui ${summary.unknown || 0}, gorengan ${summary.gorengan || 0}`
    : 'Belum ada emiten terklasifikasi. Jalankan engine dari popup.';

  const tbody = $('classTable').querySelector('tbody');
  tbody.innerHTML = '';
  const rows = Object.values(classes || {})
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
    .slice(0, 300);
  for (const c of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${c.symbol}</b></td>
      <td>${c.tier}</td>
      <td>${fmtRp(c.marketCap)}</td>
      <td>${c.gorengan && c.gorengan.is ? `<span class="warn">ya (${c.gorengan.score})</span>` : '—'}</td>
      <td style="color:#8b949e">${(c.gorengan && c.gorengan.reasons || []).join(' · ') || '—'}</td>`;
    tbody.appendChild(tr);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const st = await send('GET_STATE');
  if (st.settings) { applySettings(st.settings); renderDepth(st.settings.depth || {}); }
  const cat = await send('ENDPOINT_CATALOG');
  if (cat.endpoints) renderEndpoints(cat.endpoints);
  loadClasses();
  loadTemplates();
  await loadUniverseList();

  $('btnSave').addEventListener('click', save);
  $('btnLoadTemplates').addEventListener('click', loadTemplates);

  $('btnAllOn').addEventListener('click', () => {
    document.querySelectorAll('.epcb').forEach((c) => { c.checked = true; });
  });
  $('btnAllOff').addEventListener('click', () => {
    document.querySelectorAll('.epcb').forEach((c) => { c.checked = false; });
  });
  $('btnDefaults').addEventListener('click', async () => {
    await send('SAVE_SETTINGS', { patch: { endpoints: {} } });
    const cat2 = await send('ENDPOINT_CATALOG');
    if (cat2.endpoints) renderEndpoints(cat2.endpoints);
    flashSaved();
  });

  $('btnTestBackend').addEventListener('click', async () => {
    await save();
    $('backendHint').textContent = 'Menguji…';
    const { result } = await send('TEST_BACKEND');
    if (result && result.ok) {
      $('backendHint').innerHTML = `<span class="ok">✔ Terjangkau (HTTP ${result.status})</span>`;
    } else if (result && result.hint) {
      $('backendHint').innerHTML = `<span class="warn">⚠ HTTP ${result.status} — ${result.hint}</span>`;
    } else {
      $('backendHint').innerHTML = `<span class="bad">✖ ${(result && (result.error || `HTTP ${result.status}`)) || 'gagal'}</span>`;
    }
  });

  // Backend di host selain localhost butuh izin tambahan (optional_host_permissions).
  $('btnGrant').addEventListener('click', async () => {
    const url = $('backendUrl').value.trim();
    let origin;
    try { origin = `${new URL(url).origin}/*`; } catch (e) {
      $('backendHint').innerHTML = '<span class="bad">URL tidak valid</span>';
      return;
    }
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      $('backendHint').innerHTML = granted
        ? `<span class="ok">✔ Izin diberikan untuk ${origin}</span>`
        : '<span class="bad">✖ Izin ditolak</span>';
    });
  });

  $('btnFlush').addEventListener('click', async () => {
    const { result } = await send('FLUSH_BUFFER');
    $('backendHint').textContent = result
      ? `Buffer: ${result.sent} terkirim, ${result.left} tersisa.`
      : 'Buffer kosong.';
  });

  $('btnTestEndpoint').addEventListener('click', async () => {
    $('testOut').textContent = 'Menjalankan…';
    const res = await send('TEST_ENDPOINT', {
      endpointId: $('testEndpoint').value,
      symbol: $('testSymbol').value.trim().toUpperCase(),
    });
    if (res.error) { $('testOut').textContent = `✖ ${res.error}`; return; }
    $('testOut').textContent =
      `${res.url}\n\nHTTP ${res.status} ${res.ok ? '✔' : '✖'}${res.error ? ` (${res.error})` : ''}\n\n${res.preview || '(kosong)'}`;
  });

  $('btnLoadClasses').addEventListener('click', loadClasses);
});
