/**
 * Pembungkus chrome.storage untuk service worker.
 *
 * Service worker MV3 bisa dimatikan Chrome kapan saja, jadi SEMUA state yang
 * tidak boleh hilang (setelan, posisi antrean, token, buffer relay) disimpan
 * di storage.local, bukan di variabel modul.
 */
import { DEFAULTS, KEYS } from './config.js';

const local = chrome.storage.local;
const session = chrome.storage.session || chrome.storage.local;

export async function getSettings() {
  const raw = (await local.get(KEYS.settings))[KEYS.settings] || {};
  return {
    ...DEFAULTS,
    ...raw,
    tierThresholds: { ...DEFAULTS.tierThresholds, ...(raw.tierThresholds || {}) },
    endpoints: { ...(raw.endpoints || {}) },
  };
}

export async function saveSettings(patch) {
  const cur = (await local.get(KEYS.settings))[KEYS.settings] || {};
  const next = { ...cur, ...patch };
  await local.set({ [KEYS.settings]: next });
  return getSettings();
}

export async function getState() {
  return (await local.get(KEYS.state))[KEYS.state] || null;
}

export async function saveState(state) {
  await local.set({ [KEYS.state]: state });
  return state;
}

export async function clearState() {
  await local.remove(KEYS.state);
}

// ---- log ring buffer (dibaca popup & overlay) ----
export async function addLog(level, message, extra) {
  const { logLimit } = await getSettings();
  const logs = (await local.get(KEYS.logs))[KEYS.logs] || [];
  logs.push({ t: Date.now(), level, message, ...(extra ? { extra } : {}) });
  if (logs.length > logLimit) logs.splice(0, logs.length - logLimit);
  await local.set({ [KEYS.logs]: logs });
}

export async function getLogs(limit) {
  const logs = (await local.get(KEYS.logs))[KEYS.logs] || [];
  return limit ? logs.slice(-limit) : logs;
}

export async function clearLogs() {
  await local.set({ [KEYS.logs]: [] });
}

// ---- token & cookie (session storage: ikut hilang saat browser ditutup) ----
export async function getAuth() {
  return (await session.get(KEYS.auth))[KEYS.auth] || null;
}

export async function setAuth(auth) {
  await session.set({ [KEYS.auth]: auth });
}

// ---- hasil klasifikasi emiten ----
export async function getClasses() {
  return (await local.get(KEYS.classes))[KEYS.classes] || {};
}

export async function setClasses(map) {
  await local.set({ [KEYS.classes]: map });
}

export async function mergeClass(symbol, info) {
  const map = await getClasses();
  map[symbol] = { ...(map[symbol] || {}), ...info, updatedAt: Date.now() };
  await setClasses(map);
  return map[symbol];
}

// ---- snapshot pasar hasil fase discovery ----
export async function getMarket() {
  return (await local.get(KEYS.market))[KEYS.market] || {};
}

export async function setMarket(patch) {
  const cur = await getMarket();
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await local.set({ [KEYS.market]: next });
  return next;
}

// ---- buffer relay saat backend mati ----
export async function getBuffer() {
  return (await local.get(KEYS.buffer))[KEYS.buffer] || [];
}

export async function setBuffer(list) {
  await local.set({ [KEYS.buffer]: list });
}
