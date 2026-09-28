import http from 'node:http';

const cdpBase = process.env.ARSANT_STOCKBIT_CDP_URL || 'http://127.0.0.1:9222';
const listenHost = '127.0.0.1';
const listenPort = Number(process.env.ARSANT_STOCKBIT_AGENT_PORT || 4311);
const mirrorNames = new Set([
  'authorization', 'x-app-version', 'x-platform', 'x-device-id',
  'x-request-id', 'x-source', 'x-api-key',
]);

let cdp = null;
let targetId = '';
let pageUrl = '';
let auth = { token: '', expiresAt: 0, capturedAt: 0, headers: {} };
let lastError = '';
let lastFetchAt = 0;

class CDP {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('CDP connection failed'));
      };
      ws.onclose = () => {
        for (const { reject: fail } of this.pending.values()) fail(new Error('CDP connection closed'));
        this.pending.clear();
      };
      ws.onmessage = (event) => this.onMessage(event.data);
    });
  }

  onMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP error'));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners) listener(message.method, message.params || {});
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP is disconnected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

function tokenExpiry(token) {
  try {
    const jwt = String(token).replace(/^bearer\s+/i, '');
    const part = jwt.split('.')[1];
    if (!part) return 0;
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return Number(value.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function captureHeaders(input, sourceUrl = '') {
  if (!input || typeof input !== 'object') return;
  const mirrored = { ...auth.headers };
  let token = '';
  const exactExodus = /(^|\.)exodus\.stockbit\.com$/i.test((() => {
    try { return new URL(sourceUrl).hostname; } catch { return ''; }
  })());
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    const value = String(rawValue || '');
    if (!mirrorNames.has(name) || !value) continue;
    mirrored[name] = value;
    if (name === 'authorization' && /^bearer\s+\S+/i.test(value) && (exactExodus || !auth.token)) token = value;
  }
  if (token) {
    const expiresAt = tokenExpiry(token);
    if (exactExodus || !auth.expiresAt || !expiresAt || expiresAt >= auth.expiresAt) {
      auth = { token, expiresAt, capturedAt: Date.now(), headers: mirrored };
      lastError = '';
      return;
    }
  }
  auth.headers = mirrored;
}

function isAuthenticated() {
  if (!auth.token) return false;
  return !auth.expiresAt || auth.expiresAt > Date.now() + 60000;
}

async function discoverTarget() {
  const response = await fetch(`${cdpBase}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`CDP discovery returned ${response.status}`);
  const targets = await response.json();
  const pages = targets.filter((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  const loginTarget = pages.find((item) => /accounts\.google\.com|oauth/i.test(item.url || ''));
  const stockbitTarget = pages.find((item) => {
    try { return /(^|\.)stockbit\.com/i.test(new URL(item.url).hostname); } catch { return false; }
  });
  return (!isAuthenticated() && loginTarget) || stockbitTarget || pages[0] || null;
}

async function attach() {
  const target = await discoverTarget();
  if (!target) throw new Error('Stockbit browser page is unavailable');
  if (cdp && target.id === targetId && cdp.ws?.readyState === WebSocket.OPEN) {
    pageUrl = target.url;
    return;
  }
  cdp?.close();
  const next = new CDP(target.webSocketDebuggerUrl);
  await next.connect();
  next.listeners.add((method, params) => {
    if (method === 'Network.requestWillBeSent') captureHeaders(params.request?.headers, params.request?.url || '');
    if (method === 'Network.requestWillBeSentExtraInfo') captureHeaders(params.headers, '');
    if (method === 'Page.frameNavigated' && params.frame?.url) pageUrl = params.frame.url;
  });
  await next.send('Network.enable');
  await next.send('Runtime.enable');
  await next.send('Page.enable');
  cdp = next;
  targetId = target.id;
  pageUrl = target.url;
  await probeLocalStorage();
}

async function probeLocalStorage() {
  if (!cdp) return;
  const expression = `(() => {
    const jwt = /eyJ[\\w-]+\\.eyJ[\\w-]+\\.[\\w-]+/;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i); const value = localStorage.getItem(key) || '';
      const match = value.match(jwt); if (match) return 'Bearer ' + match[0];
    }
    return '';
  })()`;
  try {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    const token = result.result?.value;
    if (token) captureHeaders({ authorization: token });
  } catch {}
}

async function fetchBrokerSummary(symbol, date) {
  await attach();
  await probeLocalStorage();
  if (!isAuthenticated()) {
    const error = new Error('Stockbit session requires login');
    error.statusCode = 428;
    throw error;
  }
  const url = `https://exodus.stockbit.com/marketdetectors/${symbol}` +
    `?transaction_type=TRANSACTION_TYPE_GROSS&market_board=MARKET_BOARD_REGULER` +
    `&investor_type=INVESTOR_TYPE_ALL&limit=0&from=${date}&to=${date}`;
  const headers = {};
  for (const [name, value] of Object.entries(auth.headers)) {
    if (mirrorNames.has(name) && value) headers[name] = value;
  }
  headers.authorization = auth.token;
  headers.accept = 'application/json, text/plain, */*';
  delete headers.cookie;
  let value;
  try {
    const response = await fetch(url, {
      method: 'GET', headers, signal: AbortSignal.timeout(30000),
    });
    value = { status: response.status, text: await response.text() };
  } catch (error) {
    value = { status: 0, error: String(error && error.message || error) };
  }
  lastFetchAt = Date.now();
  if (value.status === 401 || value.status === 403) {
    auth.token = '';
    lastError = `Stockbit session rejected with HTTP ${value.status}`;
  }
  if (value.status !== 200) {
    const error = new Error(value.error || `Stockbit returned HTTP ${value.status || 0}`);
    error.statusCode = value.status || 502;
    throw error;
  }
  try {
    return JSON.parse(value.text);
  } catch {
    const error = new Error('Stockbit returned invalid JSON');
    error.statusCode = 502;
    throw error;
  }
}

function health() {
  return {
    status: isAuthenticated() ? 'ready' : 'authentication_required',
    browserConnected: Boolean(cdp && cdp.ws?.readyState === WebSocket.OPEN),
    authenticated: isAuthenticated(),
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : null,
    capturedAt: auth.capturedAt ? new Date(auth.capturedAt).toISOString() : null,
    lastFetchAt: lastFetchAt ? new Date(lastFetchAt).toISOString() : null,
    pageUrl,
    error: lastError || null,
  };
}

function sendJSON(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  response.end(data);
}

const viewerHTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arsant · Login Stockbit</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:14px system-ui,sans-serif}header{display:flex;gap:16px;align-items:center;padding:10px 16px;background:#161b22;position:sticky;top:0}#state{color:#f0b429}small{color:#8b949e}#wrap{display:flex;justify-content:center;padding:12px}#screen{max-width:100%;height:auto;background:white;box-shadow:0 0 0 1px #30363d;outline:none;cursor:default}.ready{color:#2ea043!important}
</style></head><body><header><b>Arsant Stockbit Session</b><span id="state">Menghubungkan…</span><small>Klik gambar lalu ketik langsung. Ctrl+V didukung.</small></header><div id="wrap"><img id="screen" tabindex="0" alt="Browser Stockbit"></div><script>
const img=document.getElementById('screen'),state=document.getElementById('state');
let busy=false; async function refresh(){if(busy)return;busy=true;try{const r=await fetch('screen?'+Date.now(),{cache:'no-store'});if(r.ok){const b=await r.blob();const u=URL.createObjectURL(b);const old=img.src;img.onload=()=>{if(old.startsWith('blob:'))URL.revokeObjectURL(old)};img.src=u}}catch{}finally{busy=false}}
setInterval(refresh,700);refresh();setInterval(async()=>{try{const h=await(await fetch('health',{cache:'no-store'})).json();state.textContent=h.authenticated?'Sesi aktif':'Login diperlukan';state.className=h.authenticated?'ready':''}catch{state.textContent='Agent tidak terhubung'}},1500);
async function input(data){await fetch('input',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})}
img.addEventListener('click',e=>{img.focus();const r=img.getBoundingClientRect();input({type:'click',x:(e.clientX-r.left)*img.naturalWidth/r.width,y:(e.clientY-r.top)*img.naturalHeight/r.height})});
img.addEventListener('wheel',e=>{e.preventDefault();input({type:'scroll',x:img.naturalWidth/2,y:img.naturalHeight/2,deltaY:e.deltaY})},{passive:false});
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey){if(e.key.toLowerCase()!=='v')return}else if(e.key.length===1){e.preventDefault();input({type:'text',text:e.key});return}else if(['Tab','Enter','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete'].includes(e.key)){e.preventDefault();input({type:'key',key:e.key})}});
document.addEventListener('paste',e=>{const text=e.clipboardData.getData('text');if(text){e.preventDefault();input({type:'text',text})}});
</script></body></html>`;

const keyCodes = {
  Tab: 9, Enter: 13, Backspace: 8, Escape: 27, ArrowLeft: 37,
  ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
};

async function captureScreen() {
  await attach();
  const result = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: false });
  return Buffer.from(result.data, 'base64');
}

async function dispatchInput(input) {
  await attach();
  if (input.type === 'click') {
    const x = Number(input.x || 0), y = Number(input.y || 0);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return;
  }
  if (input.type === 'scroll') {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Number(input.x || 0), y: Number(input.y || 0), deltaX: 0, deltaY: Number(input.deltaY || 0) });
    return;
  }
  if (input.type === 'text') {
    const text = String(input.text || '').slice(0, 4096);
    if (text) await cdp.send('Input.insertText', { text });
    return;
  }
  if (input.type === 'key' && keyCodes[input.key]) {
    const code = keyCodes[input.key];
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: input.key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: input.key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && (request.url === '/viewer' || request.url === '/viewer/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(viewerHTML);
    }
    if (request.method === 'GET' && request.url.startsWith('/screen')) {
      const screenshot = await captureScreen();
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': screenshot.length, 'Cache-Control': 'no-store' });
      return response.end(screenshot);
    }
    if (request.method === 'POST' && request.url === '/input') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) throw Object.assign(new Error('request body is too large'), { statusCode: 413 });
      }
      await dispatchInput(JSON.parse(body || '{}'));
      return sendJSON(response, 200, { ok: true });
    }
    if (request.method === 'GET' && request.url === '/health') {
      return sendJSON(response, 200, health());
    }
    if (request.method === 'POST' && request.url === '/broker-summary') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 16384) throw Object.assign(new Error('request body is too large'), { statusCode: 413 });
      }
      const input = JSON.parse(body || '{}');
      const symbol = String(input.symbol || '').toUpperCase();
      const date = String(input.date || '');
      if (!/^[A-Z0-9]{2,8}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return sendJSON(response, 400, { error: 'valid symbol and date are required' });
      }
      const payload = await fetchBrokerSummary(symbol, date);
      return sendJSON(response, 200, { status: 200, payload });
    }
    return sendJSON(response, 404, { error: 'not found' });
  } catch (error) {
    lastError = String(error?.message || error);
    return sendJSON(response, Number(error?.statusCode || 500), { error: lastError });
  }
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(`Arsant Stockbit session agent listening on ${listenHost}:${listenPort}\n`);
});

setInterval(() => attach().catch((error) => { lastError = error.message; }), 5000);
setInterval(() => probeLocalStorage().catch(() => {}), 60000);
attach().catch((error) => { lastError = error.message; });
