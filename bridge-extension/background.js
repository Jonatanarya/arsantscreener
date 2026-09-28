/**
 * background.js — Service Worker utama Arsant Screener Data Collector.
 *
 * Tiga tugas:
 *   1. Auth Interceptor  — menangkap Bearer token & header Stockbit secara pasif
 *                          (lihat lib/auth.js).
 *   2. Queue & Rate Limit Engine — mengatur antrean crawling histori 5 tahun
 *                          dengan jitter & istirahat anti-bot (lihat lib/queue.js).
 *   3. DB Relay Forwarder — meneruskan hasilnya ke REST API backend
 *                          (lihat lib/relay.js).
 *
 * Service worker sengaja TIDAK melakukan fetch ke Stockbit sendiri; lihat
 * penjelasannya di lib/bridge.js.
 */
import { installAuthInterceptor, noteToken, currentAuth, hasSessionCookie } from './lib/auth.js';
import { registerPort, handleExecResult, execRequest, activePortCount } from './lib/bridge.js';
import {
  startEngine, pauseEngine, resumeEngine, stopEngine, getProgress, resumableInfo,
  onTabConnected, resumeIfDue, tick, ALARM_TICK, ALARM_WATCHDOG,
} from './lib/queue.js';
import {
  getSettings, saveSettings, getLogs, clearLogs, getClasses, getState, setMarket, getMarket, addLog,
} from './lib/storage.js';
import { testBackend, flushBuffer } from './lib/relay.js';
import { estimatePlan, resolveSymbols, loadUniverse } from './lib/planner.js';
import { DEPTH_KEYS, describeDepth } from './lib/depth.js';
import { ENDPOINTS, isEndpointEnabled, StockbitApi } from './apiClient.js';
import { learnFromUrls, getTemplates, pendingTemplates, resolveJobUrl } from './lib/templates.js';

// ---------------------------------------------------------------------------
// Inisialisasi
// ---------------------------------------------------------------------------
installAuthInterceptor();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
  addLog('info', 'Arsant Screener Data Collector terpasang.').catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
});

// service worker baru dihidupkan Chrome: pastikan watchdog tetap ada
chrome.alarms.get(ALARM_WATCHDOG).then((a) => {
  if (!a) chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
}).catch(() => {});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_TICK) tick().catch(() => {});
  else if (alarm.name === ALARM_WATCHDOG) {
    resumeIfDue().catch(() => {});
    flushBuffer().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Port dari content script (tab Stockbit)
// ---------------------------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'tw-collector') return;
  registerPort(port);

  port.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'HELLO':
        if (msg.buildId) setMarket({ buildId: msg.buildId }).catch(() => {});
        if (msg.token) noteToken(msg.token, 'content').catch(() => {});
        onTabConnected().catch(() => {});
        break;
      case 'AUTH':
        noteToken(msg.token, msg.source || 'interceptor').catch(() => {});
        break;
      case 'EXEC_RESULT':
        handleExecResult(msg);
        break;
      case 'SEEN':
        learnFromUrls(msg.urls).catch(() => {});
        break;
      case 'KEEPALIVE':
        // pesan ini saja sudah menahan service worker tetap hidup
        getProgress().then((p) => {
          try { port.postMessage({ type: 'PROGRESS', progress: p }); } catch (e) {}
        }).catch(() => {});
        break;
      default:
        break;
    }
  });
});

// ---------------------------------------------------------------------------
// Pesan dari popup / options
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((e) => {
    sendResponse({ error: String((e && e.message) || e) });
  });
  return true; // jawaban asinkron
});

async function handleMessage(msg) {
  if (!msg || !msg.type) return { error: 'pesan tanpa type' };

  switch (msg.type) {
    case 'GET_STATE': {
      const [settings, progress, logs, auth, state] = await Promise.all([
        getSettings(), getProgress(), getLogs(60), currentAuth(), getState(),
      ]);
      return {
        settings,
        progress,
        logs,
        // Popup hanya MENAMPILKAN kedalaman; nilainya dihitung di sini dengan
        // describeDepth() yang sama dipakai engine, supaya popup tidak mungkin
        // menampilkan angka yang berbeda dari yang benar-benar dipakai.
        depth: Object.entries(DEPTH_KEYS).map(([key, label]) => ({
          key, label, text: describeDepth(key, settings),
        })),
        state: state ? { status: state.status, phase: state.phase } : null,
        auth: auth ? { hasToken: !!auth.token, exp: auth.exp || 0, source: auth.source } : { hasToken: false },
        tabs: activePortCount(),
      };
    }

    case 'SAVE_SETTINGS':
      return { settings: await saveSettings(msg.patch || {}) };

    case 'RESUMABLE':
      return { resumable: await resumableInfo() };

    case 'START': {
      if (msg.patch) await saveSettings(msg.patch);
      // mode 'continue' = lanjut dari kursor terakhir; mode 'new' (bawaan) =
      // antrean baru dari nol. Popup menanyakan ini lewat RESUMABLE lebih dulu.
      if (msg.mode === 'continue') {
        const resumed = await resumeEngine();
        if (resumed) return { state: resumed, progress: await getProgress(), resumed: true };
        // tidak ada yang bisa dilanjutkan (mis. state hilang) — mulai baru saja
      }
      return { state: await startEngine(), progress: await getProgress() };
    }

    case 'PAUSE':
      await pauseEngine('manual');
      return { progress: await getProgress() };

    case 'RESUME':
      await resumeEngine();
      return { progress: await getProgress() };

    case 'STOP':
      await stopEngine();
      return { progress: await getProgress() };

    case 'GET_PROGRESS':
      return { progress: await getProgress() };

    case 'GET_LOGS':
      return { logs: await getLogs(msg.limit || 200) };

    case 'CLEAR_LOGS':
      await clearLogs();
      return { ok: true };

    case 'GET_CLASSES': {
      const classes = await getClasses();
      const summary = { bluechip: 0, second: 0, third: 0, unknown: 0, gorengan: 0 };
      for (const c of Object.values(classes)) {
        summary[c.tier] = (summary[c.tier] || 0) + 1;
        if (c.gorengan && c.gorengan.is) summary.gorengan++;
      }
      return { classes, summary, total: Object.keys(classes).length };
    }

    case 'ESTIMATE': {
      const settings = await saveSettings(msg.patch || {});
      const symbols = await resolveSymbols(settings);
      const market = await getMarket();
      return { plan: estimatePlan(symbols, settings, market), sample: symbols.slice(0, 12) };
    }

    case 'UNIVERSE_LIST': {
      // Daftar seluruh emiten BEI dari idx-universe.js, dipakai halaman Options
      // untuk saringan centang. Dibaca dari berkas extension — tanpa request
      // ke Stockbit sama sekali.
      const universe = await loadUniverse();
      const settings = await getSettings();
      return {
        symbols: universe.map((r) => ({
          code: String(r.code || '').toUpperCase(),
          name: r.name || '',
          board: r.board || '',
          listed: r.listed || '',
        })).filter((r) => r.code),
        selected: settings.customSymbols || [],
        customOnly: !!settings.customOnly,
      };
    }

    case 'ENDPOINT_CATALOG': {
      const settings = await getSettings();
      const templates = await getTemplates();
      return {
        endpoints: ENDPOINTS.map((e) => ({
          id: e.id, label: e.label, group: e.group, scope: e.scope, phase: e.phase,
          perYear: !!e.perYear || !!e.windowDays,
          needsTemplate: !!e.needsTemplate,
          hasTemplate: !!templates[e.id],
          enabled: isEndpointEnabled(e, settings),
        })),
      };
    }

    case 'TEMPLATE_STATUS': {
      const [templates, pending] = await Promise.all([getTemplates(), pendingTemplates()]);
      return { templates, pending };
    }

    case 'TEST_BACKEND':
      return { result: await testBackend(await getSettings()) };

    case 'FLUSH_BUFFER':
      return { result: await flushBuffer() };

    case 'TEST_ENDPOINT': {
      // uji satu endpoint lewat tab Stockbit — dipakai halaman Options
      if (!activePortCount()) return { error: 'Tidak ada tab Stockbit terbuka.' };
      const settings = await getSettings();
      const market = await getMarket();
      const ep = ENDPOINTS.find((e) => e.id === msg.endpointId);
      if (!ep) return { error: 'Endpoint tidak dikenal' };
      const ctx = { settings, market, symbol: (msg.symbol || 'BBCA').toUpperCase(), today: new Date().toISOString().slice(0, 10), window: { start: '', end: '' } };
      if (ep.perYear) {
        const now = new Date();
        const start = new Date(now); start.setFullYear(start.getFullYear() - 1);
        ctx.window = { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
      }
      const variant = typeof ep.variants === 'function' ? ep.variants(ctx)[0] : undefined;
      const req = ep.build(ctx, variant);
      // pakai template halaman kalau sudah ada, sama seperti Queue Runner
      const resolved = await resolveJobUrl(
        { endpointId: ep.id, url: req.url },
        { symbol: ctx.symbol, window: ctx.window, today: ctx.today },
      );
      if (!resolved.url) {
        return { error: `Endpoint ini menunggu template. Buka halaman Stockbit yang memakai ${ep.label}, lalu coba lagi.` };
      }
      const res = await execRequest({ method: req.method, url: resolved.url, body: req.body }, settings.requestTimeoutMs);
      return {
        url: resolved.url,
        source: resolved.source,
        status: res.status,
        ok: res.ok,
        error: res.error || null,
        preview: res.json ? JSON.stringify(res.json).slice(0, 1500) : (res.text || '').slice(0, 1500),
      };
    }

    case 'AUTH_STATUS': {
      const auth = await currentAuth();
      return {
        hasToken: !!(auth && auth.token),
        exp: (auth && auth.exp) || 0,
        source: (auth && auth.source) || null,
        cookie: await hasSessionCookie(),
        tabs: activePortCount(),
      };
    }

    default:
      return { error: `type tidak dikenal: ${msg.type}` };
  }
}

// Ekspor kecil supaya modul lain (dan devtools) bisa memakai wrapper API
// dengan transport yang benar tanpa menyalin kode.
export const api = new StockbitApi((req) => execRequest(req));
