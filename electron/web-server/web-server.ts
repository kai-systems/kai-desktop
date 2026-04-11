import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { join, extname } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { webClients } from './web-clients.js';
import { invokeHandler } from './ipc-bridge.js';
import { ensureSelfSignedCert } from './self-signed.js';
import { getLoginPageHtml } from './login-page.js';

interface WebServerConfig {
  enabled: boolean;
  port: number;
  tls: {
    enabled: boolean;
    mode: 'self-signed' | 'custom';
    certPath: string;
    keyPath: string;
  };
  auth: {
    mode: 'anonymous' | 'password';
    username: string;
    password: string;
  };
}

let httpServer: http.Server | https.Server | null = null;
let wss: WebSocketServer | null = null;

/** Cached favicon PNG read from build/icon.png at module load. */
const APP_ICON_PATH = join(__dirname, '../../build/icon.png');
let faviconBuffer: Buffer | null = null;
try {
  if (existsSync(APP_ICON_PATH)) {
    faviconBuffer = readFileSync(APP_ICON_PATH);
  }
} catch {
  // Favicon not available — non-fatal.
}

/** Session cookie / token lifetime: 24 hours. */
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_SECS = SESSION_LIFETIME_MS / 1000;

/** One-time login-token lifetime (QR codes): 5 minutes. */
const LOGIN_TOKEN_LIFETIME_MS = 5 * 60 * 1000;

/* ── File-backed session store ─────────────────────────────────────── */

const SESSIONS_DIR = join(homedir(), '.' + __BRAND_APP_SLUG);
const SESSIONS_PATH = join(SESSIONS_DIR, 'sessions.json');

type SessionStore = Record<string, number>; // token -> expiry epoch ms

function loadSessions(): SessionStore {
  try {
    if (!existsSync(SESSIONS_PATH)) return {};
    return JSON.parse(readFileSync(SESSIONS_PATH, 'utf-8')) as SessionStore;
  } catch {
    return {};
  }
}

function saveSessions(store: SessionStore): void {
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(SESSIONS_PATH, JSON.stringify(store), 'utf-8');
  } catch {
    // Non-fatal — sessions degrade to in-memory-only.
  }
}

/** Prune expired entries and return the cleaned store. */
function pruneExpired(store: SessionStore): SessionStore {
  const now = Date.now();
  const pruned: SessionStore = {};
  for (const [token, expiry] of Object.entries(store)) {
    if (expiry > now) pruned[token] = expiry;
  }
  return pruned;
}

/** In-memory mirror of the on-disk store, loaded once at startup. */
let sessions: SessionStore = pruneExpired(loadSessions());
saveSessions(sessions); // persist any pruning

function addSession(token: string, expiresAt: number): void {
  sessions[token] = expiresAt;
  saveSessions(sessions);
}

function hasSession(token: string): boolean {
  const expiry = sessions[token];
  if (!expiry) return false;
  if (Date.now() > expiry) {
    delete sessions[token];
    saveSessions(sessions);
    return false;
  }
  return true;
}

function deleteSession(token: string): void {
  delete sessions[token];
  saveSessions(sessions);
}

/** Serialization guard — only one restart runs at a time; late callers get the latest config. */
let pendingRestart: { promise: Promise<void>; config: WebServerConfig } | null = null;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
};

/** Base directory where generated media files are stored. */
const MEDIA_DIR = join(homedir(), '.' + __BRAND_APP_SLUG, 'media');

/** Base directory where compiled plugin renderer bundles are cached. */
const PLUGIN_RENDERERS_DIR = join(homedir(), '.' + __BRAND_APP_SLUG, 'plugin-renderers');

/**
 * Client-side bridge script injected into the HTML served to web clients.
 * Defines `window.app` backed by a WebSocket connection instead of Electron IPC.
 */
function getBridgeScript(): string {
  return `<script>
(function() {
  var ws, msgId = 0, pending = {}, listeners = {};
  var reconnectDelay = 2000;

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');

    ws.onopen = function() {
      reconnectDelay = 2000;
    };

    ws.onmessage = function(evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch(e) { return; }

      if (msg.type === 'result' || msg.type === 'error') {
        var cb = pending[msg.id];
        if (cb) {
          delete pending[msg.id];
          if (msg.type === 'error') cb.reject(new Error(msg.message));
          else cb.resolve(msg.data);
        }
      } else if (msg.type === 'event') {
        var cbs = listeners[msg.channel];
        if (cbs) {
          for (var i = 0; i < cbs.length; i++) {
            try { cbs[i](msg.data); } catch(e) { console.error('[WsBridge] Event handler error:', e); }
          }
        }
      }
    };

    ws.onclose = function() {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
    };
  }

  function invoke(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    var id = String(++msgId);
    return new Promise(function(resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        delete pending[id];
        reject(new Error('WebSocket not connected'));
        return;
      }
      ws.send(JSON.stringify({ id: id, type: 'invoke', channel: channel, args: args }));
      setTimeout(function() {
        if (pending[id]) {
          delete pending[id];
          reject(new Error('Timeout waiting for ' + channel));
        }
      }, 60000);
    });
  }

  function on(channel, callback) {
    if (!listeners[channel]) listeners[channel] = [];
    listeners[channel].push(callback);
    return function() {
      listeners[channel] = (listeners[channel] || []).filter(function(cb) { return cb !== callback; });
    };
  }

  function noop() { return Promise.resolve(); }
  function noopObj(v) { return Promise.resolve(v || {}); }

  window.app = {
    __isWebBridge: true,
    config: {
      get: function() { return invoke('config:get'); },
      set: function(path, value) { return invoke('config:set', path, value); },
      onChanged: function(cb) { return on('config:changed', cb); }
    },
    agent: {
      stream: function(cId, msgs, mk, re, pk, fb, cwd) { return invoke('agent:stream', cId, msgs, mk, re, pk, fb, cwd); },
      cancelStream: function(cId) { return invoke('agent:cancel-stream', cId); },
      generateTitle: function(msgs, mk) { return invoke('agent:generate-title', msgs, mk); },
      listBackends: function() { return invoke('agent:list-backends'); },
      onStreamEvent: function(cb) { return on('agent:stream-event', cb); },
      sendSubAgentMessage: function(cId, msg) { return invoke('agent:sub-agent-message', cId, msg); },
      stopSubAgent: function(cId) { return invoke('agent:sub-agent-stop', cId); },
      listSubAgents: function() { return invoke('agent:sub-agent-list'); }
    },
    conversations: {
      list: function() { return invoke('conversations:list'); },
      get: function(id) { return invoke('conversations:get', id); },
      put: function(c) { return invoke('conversations:put', c); },
      delete: function(id) { return invoke('conversations:delete', id); },
      clear: function() { return invoke('conversations:clear'); },
      getActiveId: function() { return invoke('conversations:get-active-id'); },
      setActiveId: function(id) { return invoke('conversations:set-active-id', id); },
      onChanged: function(cb) { return on('conversations:changed', cb); }
    },
    memory: {
      clear: function(opts) { return invoke('memory:clear', opts); },
      testEmbedding: function() { return invoke('memory:test-embedding'); }
    },
    mcp: {
      testConnection: function(server) { return invoke('mcp:test-connection', server); }
    },
    cliTools: {
      checkBinaries: function(names) { return invoke('cli-tools:check-binaries', names); }
    },
    skills: {
      list: function() { return invoke('skills:list'); },
      get: function(name) { return invoke('skills:get', name); },
      delete: function(name) { return invoke('skills:delete', name); },
      toggle: function(name, enable) { return invoke('skills:toggle', name, enable); }
    },
    plugins: {
      getUIState: function() { return invoke('plugin:get-ui-state'); },
      list: function() { return invoke('plugin:list'); },
      getConfig: function(pn) { return invoke('plugin:get-config', pn); },
      setConfig: function(pn, path, value) { return invoke('plugin:set-config', pn, path, value); },
      modalAction: function(pn, mid, act, data) { return invoke('plugin:modal-action', pn, mid, act, data); },
      bannerAction: function(pn, bid, act, data) { return invoke('plugin:banner-action', pn, bid, act, data); },
      action: function(pn, tid, act, data) { return invoke('plugin:action', pn, tid, act, data); },
      onUIStateChanged: function(cb) { return on('plugin:ui-state-changed', cb); },
      onEvent: function(cb) { return on('plugin:event', cb); },
      onNavigationRequest: function(cb) { return on('plugin:navigation-request', cb); },
      onModalCallback: function(cb) { return on('plugin:modal-callback', cb); }
    },
    modelCatalog: function() { return invoke('agent:model-catalog'); },
    realtime: {
      startSession: function(cId) { return invoke('realtime:start-session', cId); },
      endSession: function() { return invoke('realtime:end-session'); },
      sendAudio: function(pcm) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'send', channel: 'realtime:send-audio', data: pcm })); },
      getStatus: function() { return invoke('realtime:get-status'); },
      onEvent: function(cb) { return on('realtime:event', cb); }
    },
    profileCatalog: function() { return invoke('agent:profiles'); },
    dialog: {
      openFile: function() { return Promise.resolve({ canceled: true, files: [] }); },
      openDirectory: function() { return Promise.resolve({ canceled: true }); },
      openDirectoryFiles: function() { return Promise.resolve({ canceled: true, filePaths: [] }); }
    },
    clipboard: {
      writeText: function(text) { try { navigator.clipboard.writeText(text); return Promise.resolve({ ok: true }); } catch(e) { return Promise.resolve({ ok: false, error: String(e) }); } }
    },
    image: {
      fetch: function() { return Promise.resolve({ error: 'Not supported in web mode' }); },
      save: function() { return Promise.resolve({ canceled: true }); }
    },
    platform: {
      homedir: function() { return invoke('platform:homedir'); }
    },
    webServer: {
      getLanAddresses: function() { return invoke('webServer:lan-addresses'); },
      createToken: function() { return invoke('webServer:create-token'); }
    },
    fs: {
      listDirectory: function(dirPath) { return invoke('fs:list-directory', dirPath); }
    },
    computerUse: {
      startSession: function(goal, opts) { return invoke('computer-use:start-session', goal, opts); },
      pauseSession: function(sId) { return invoke('computer-use:pause-session', sId); },
      resumeSession: function(sId) { return invoke('computer-use:resume-session', sId); },
      stopSession: function(sId) { return invoke('computer-use:stop-session', sId); },
      approveAction: function(sId, aId) { return invoke('computer-use:approve-action', sId, aId); },
      rejectAction: function(sId, aId, r) { return invoke('computer-use:reject-action', sId, aId, r); },
      listSessions: function() { return invoke('computer-use:list-sessions'); },
      getSession: function(sId) { return invoke('computer-use:get-session', sId); },
      setSurface: function(sId, s) { return invoke('computer-use:set-surface', sId, s); },
      sendGuidance: function(sId, t) { return invoke('computer-use:send-guidance', sId, t); },
      updateSessionSettings: function(sId, s) { return invoke('computer-use:update-session-settings', sId, s); },
      continueSession: function(sId, g) { return invoke('computer-use:continue-session', sId, g); },
      markSessionsSeen: function(cId) { return invoke('computer-use:mark-sessions-seen', cId); },
      openSetupWindow: function() { return Promise.resolve(); },
      getLocalMacosPermissions: function() { return invoke('computer-use:get-local-macos-permissions'); },
      requestLocalMacosPermissions: function() { return invoke('computer-use:request-local-macos-permissions'); },
      requestSingleLocalMacosPermission: function(s) { return invoke('computer-use:request-single-local-macos-permission', s); },
      openLocalMacosPrivacySettings: function(s) { return invoke('computer-use:open-local-macos-privacy-settings', s); },
      probeInputMonitoring: function(t) { return invoke('computer-use:probe-input-monitoring', t); },
      checkFullScreenApps: function() { return invoke('computer-use:check-fullscreen-apps'); },
      exitFullScreenApps: function(a) { return invoke('computer-use:exit-fullscreen-apps', a); },
      listRunningApps: function() { return invoke('computer-use:list-running-apps'); },
      listDisplays: function() { return invoke('computer-use:list-displays'); },
      focusSession: function(sId) { return invoke('computer-use:focus-session', sId); },
      overlayMouseEnter: noop,
      overlayMouseLeave: noop,
      onEvent: function(cb) { return on('computer-use:event', cb); },
      onOverlayState: function(cb) { return on('computer-use:overlay-state', cb); },
      onFocusThread: function(cb) { return on('computer-use:focus-thread', cb); }
    },
    mic: {
      listDevices: function() { return Promise.resolve([]); },
      startRecording: function() { return Promise.resolve({ error: 'Not supported in web mode' }); },
      stopRecording: function() { return Promise.resolve({ error: 'Not supported in web mode' }); },
      cancelRecording: function() { return Promise.resolve({ ok: true }); },
      startMonitor: function() { return Promise.resolve({}); },
      getLevel: function() { return Promise.resolve({}); },
      stopMonitor: function() { return Promise.resolve({ ok: true }); },
      liveStart: function() { return Promise.resolve({ error: 'Not supported in web mode' }); },
      liveMicStart: function() { return Promise.resolve({ error: 'Not supported in web mode' }); },
      liveMicDrain: function() { return Promise.resolve([]); },
      liveMicStop: function() { return Promise.resolve({ ok: true }); },
      liveAudio: noop,
      liveStop: function() { return Promise.resolve({ ok: true }); },
      onPartial: function(cb) { return on('stt:partial', cb); },
      onFinal: function(cb) { return on('stt:final', cb); },
      onSttError: function(cb) { return on('stt:error', cb); }
    },
    usage: {
      summary: function() { return invoke('usage:summary'); },
      byConversation: function(p) { return invoke('usage:by-conversation', p); },
      byModel: function() { return invoke('usage:by-model'); },
      timeSeries: function(p) { return invoke('usage:time-series', p); },
      nonLlmEvents: function(p) { return invoke('usage:non-llm-events', p); },
      recordEvent: function(e) { return invoke('usage:record-event', e); },
      exportCsv: function() { return invoke('usage:export-csv'); }
    },
    onMenuOpenSettings: function(cb) { return on('menu:open-settings', cb); },
    onFind: function(cb) { return on('menu:find', cb); },
    onModelSwitched: function(cb) { return on('agent:model-switched', cb); }
  };

  connect();
})();
</script>
<link rel="icon" type="image/png" href="/favicon.png">`;
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  }
  return cookies;
}

function hasValidSession(req: http.IncomingMessage): boolean {
  const cookies = parseCookies(req);
  const token = cookies[__BRAND_APP_SLUG + '_session'];
  return Boolean(token && hasSession(token));
}

function isAuthenticated(
  req: http.IncomingMessage,
  config: WebServerConfig,
): boolean {
  if (config.auth.mode === 'anonymous') return true;
  return hasValidSession(req);
}

/** Routes that bypass auth so the login page and its API work. */
const AUTH_EXEMPT_PATHS = new Set(['/login', '/api/login', '/api/auth-status', '/api/token-login', '/favicon.ico', '/favicon.png']);

function getRendererDir(): string {
  return join(__dirname, '../renderer');
}

function serveStaticFile(
  filePath: string,
  res: http.ServerResponse,
  bridgeScript?: string,
): void {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Inject bridge script into HTML files
    if (ext === '.html' && bridgeScript) {
      let html = readFileSync(filePath, 'utf-8');
      html = html.replace('</head>', bridgeScript + '\n</head>');
      const buf = Buffer.from(html, 'utf-8');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': buf.byteLength,
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
      return;
    }

    const data = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.byteLength,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

function proxyToViteDev(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  viteUrl: string,
  bridgeScript: string,
): void {
  const targetUrl = new URL(req.url ?? '/', viteUrl);

  const proxyReq = http.request(
    targetUrl,
    { method: req.method, headers: { ...req.headers, host: targetUrl.host } },
    (proxyRes) => {
      const ct = proxyRes.headers['content-type'] ?? '';
      const isHtml = ct.includes('text/html');

      if (isHtml) {
        // Collect HTML, inject bridge script
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          html = html.replace('</head>', bridgeScript + '\n</head>');
          const buf = Buffer.from(html, 'utf-8');
          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          delete headers['content-encoding'];
          headers['content-length'] = String(buf.byteLength);
          res.writeHead(proxyRes.statusCode ?? 200, headers);
          res.end(buf);
        });
      } else {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    },
  );

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Vite dev server not reachable');
  });

  req.pipe(proxyReq);
}

export async function startWebServer(config: WebServerConfig): Promise<void> {
  if (httpServer) await stopWebServer();

  const bridgeScript = getBridgeScript();
  const rendererDir = getRendererDir();
  const viteDevUrl = process.env.ELECTRON_RENDERER_URL;

  // Resolve TLS options
  let tlsOptions: { cert: string; key: string } | null = null;
  if (config.tls?.enabled) {
    if (config.tls.mode === 'custom' && config.tls.certPath && config.tls.keyPath) {
      tlsOptions = {
        cert: readFileSync(config.tls.certPath, 'utf-8'),
        key: readFileSync(config.tls.keyPath, 'utf-8'),
      };
    } else {
      tlsOptions = ensureSelfSignedCert();
    }
  }

  const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const urlPath = (req.url ?? '/').split('?')[0];

    // --- Auth-exempt API endpoints ---

    if (urlPath === '/api/login' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (body.username?.toLowerCase() === config.auth.username.toLowerCase() && body.password === config.auth.password) {
            const token = crypto.randomUUID();
            addSession(token, Date.now() + SESSION_LIFETIME_MS);
            const secure = config.tls?.enabled ? '; Secure' : '';
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': `${__BRAND_APP_SLUG}_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECS}${secure}`,
            });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
        }
      });
      return;
    }

    if (urlPath === '/api/auth-status') {
      const authed = isAuthenticated(req, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: authed, mode: config.auth.mode }));
      return;
    }

    // Token-based auto-login (for QR code scanning)
    if (urlPath === '/api/token-login') {
      const fullUrl = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
      const loginToken = fullUrl.searchParams.get('token');
      if (loginToken && hasSession(loginToken)) {
        // Consume the token (one-time use)
        deleteSession(loginToken);
        // Issue a fresh session cookie
        const sessionToken = crypto.randomUUID();
        addSession(sessionToken, Date.now() + SESSION_LIFETIME_MS);
        const secure = config.tls?.enabled ? '; Secure' : '';
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': `${__BRAND_APP_SLUG}_session=${sessionToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECS}${secure}`,
        });
        res.end();
      } else {
        res.writeHead(302, { Location: '/login' });
        res.end();
      }
      return;
    }

    // --- Favicon ---

    if ((urlPath === '/favicon.ico' || urlPath === '/favicon.png') && faviconBuffer) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': faviconBuffer.byteLength,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(faviconBuffer);
      return;
    }

    // --- Auth check (skip for login page) ---

    if (!AUTH_EXEMPT_PATHS.has(urlPath) && !isAuthenticated(req, config)) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }

    // --- Login page ---

    if (urlPath === '/login') {
      if (config.auth.mode === 'anonymous' || isAuthenticated(req, config)) {
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
      }
      const html = getLoginPageHtml();
      const buf = Buffer.from(html, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.byteLength,
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
      return;
    }

    // --- Serve generated media files (images, videos, audio) ---
    if (urlPath.startsWith('/media/')) {
      const relativePath = decodeURIComponent(urlPath.slice('/media/'.length));
      const filePath = join(MEDIA_DIR, relativePath);

      // Security: ensure the resolved path is under the media directory
      if (!filePath.startsWith(MEDIA_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.byteLength,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      return;
    }

    // --- Serve plugin renderer bundles (compiled JS, CSS, assets) ---
    if (urlPath.startsWith('/plugin-renderer/')) {
      // URL format: /plugin-renderer/<pluginName>/<fileHash>/<assetPath>
      const segments = urlPath.slice('/plugin-renderer/'.length).split('/').map(decodeURIComponent);
      const [pluginName, fileHash, ...assetParts] = segments;
      const assetPath = assetParts.join('/');

      if (!pluginName || !fileHash || !assetPath) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return;
      }

      const expectedRoot = join(PLUGIN_RENDERERS_DIR, pluginName, fileHash);
      const filePath = join(expectedRoot, assetPath);

      // Security: ensure the resolved path is under the expected plugin cache root
      if (!filePath.startsWith(expectedRoot + '/') && filePath !== expectedRoot) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.byteLength,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      return;
    }

    // Dev mode: proxy to Vite
    if (viteDevUrl) {
      proxyToViteDev(req, res, viteDevUrl, bridgeScript);
      return;
    }

    // Production: serve static files
    if (urlPath === '/' || urlPath === '/index.html') {
      serveStaticFile(join(rendererDir, 'index.html'), res, bridgeScript);
      return;
    }

    const filePath = join(rendererDir, urlPath);
    // Security: prevent path traversal
    if (!filePath.startsWith(rendererDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      serveStaticFile(filePath, res);
    } else {
      // SPA fallback
      serveStaticFile(join(rendererDir, 'index.html'), res, bridgeScript);
    }
  };

  // Create HTTP or HTTPS server
  httpServer = tlsOptions
    ? https.createServer({ cert: tlsOptions.cert, key: tlsOptions.key }, requestHandler)
    : http.createServer(requestHandler);

  // WebSocket server
  wss = new WebSocketServer({ noServer: true });

  const handleUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }

    // Auth check for WebSocket (cookies)
    if (config.auth.mode === 'password') {
      if (!hasValidSession(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req);
    });
  };

  httpServer.on('upgrade', handleUpgrade);

  wss.on('connection', (ws: WebSocket) => {
    webClients.add(ws);

    // Heartbeat: ping every 30s, terminate if no pong within 10s
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) {
        clearInterval(heartbeat);
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30000);

    ws.on('message', async (raw: Buffer | string) => {
      let msg: { id?: string; type?: string; channel?: string; args?: unknown[]; data?: unknown };
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
      } catch {
        return;
      }

      if (msg.type === 'invoke' && msg.channel && msg.id) {
        try {
          const result = await invokeHandler(msg.channel, ...(msg.args ?? []));
          ws.send(JSON.stringify({ id: msg.id, type: 'result', data: result }));
        } catch (err) {
          ws.send(JSON.stringify({
            id: msg.id,
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          }));
        }
      }

      // Fire-and-forget sends (like realtime:send-audio)
      if (msg.type === 'send' && msg.channel) {
        try {
          await invokeHandler(msg.channel, msg.data);
        } catch {
          // Ignore errors on fire-and-forget
        }
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      webClients.delete(ws);
    });

    ws.on('error', () => {
      clearInterval(heartbeat);
      webClients.delete(ws);
    });
  });

  return new Promise<void>((resolve, reject) => {
    httpServer!.on('error', (err) => {
      reject(err);
    });
    httpServer!.listen(config.port, () => {
      resolve();
    });
  });
}

export async function stopWebServer(): Promise<void> {
  // Close all web client connections
  for (const ws of webClients) {
    try { ws.close(); } catch { /* ignore */ }
  }
  webClients.clear();

  if (wss) {
    wss.close();
    wss = null;
  }

  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Force-close all keep-alive connections so .close() fires promptly
      server.closeAllConnections();
    });
  }
}

/**
 * Create a one-time-use login token for QR code auto-login.
 * The token expires after 5 minutes.
 * Returns the token string, or null if the server isn't running.
 */
export function createLoginToken(): string | null {
  if (!httpServer) return null;
  const token = crypto.randomUUID();
  addSession(token, Date.now() + LOGIN_TOKEN_LIFETIME_MS);
  return token;
}

export async function restartWebServer(config: WebServerConfig): Promise<void> {
  // If a restart is already in-flight, update its target config and return
  // the same promise — this coalesces rapid successive restarts.
  if (pendingRestart) {
    pendingRestart.config = config;
    return pendingRestart.promise;
  }

  // Assign pendingRestart BEFORE calling doRestart so the async function
  // can read it synchronously on its first iteration.
  const entry: { promise: Promise<void>; config: WebServerConfig } = {
    promise: null as unknown as Promise<void>,
    config,
  };
  pendingRestart = entry;

  entry.promise = (async () => {
    try {
      // Loop until the queued config is stable (no new config arrived during restart)
      while (true) {
        const target = entry.config;
        await stopWebServer();
        await startWebServer(target);
        // If config hasn't changed while we were restarting, we're done
        if (entry.config === target) break;
      }
    } finally {
      pendingRestart = null;
    }
  })();

  return entry.promise;
}
