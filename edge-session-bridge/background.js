const DEFAULT_SERVER_URL = 'https://grok-trading-team.onrender.com';
const ALLOWED_SERVERS = new Set([
  'https://grok-trading-team.onrender.com',
  'http://localhost:3000'
]);

function normalizeServerUrl(url) {
  const cleaned = String(url || '').trim().replace(/\/+$/, '');
  return ALLOWED_SERVERS.has(cleaned) ? cleaned : DEFAULT_SERVER_URL;
}

async function handleBridgeHttp(msg) {
  const url = String(msg?.url || '');
  if (!url.startsWith('https://grok-trading-team.onrender.com/') && !url.startsWith('http://localhost:3000/')) {
    return { ok: false, status: 400, data: { error: '허용되지 않은 브리지 대상 서버입니다.' } };
  }

  const controller = new AbortController();
  const timeoutMs = Number(msg?.timeoutMs) || 25000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: msg?.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(msg?.headers || {})
      },
      body: msg?.body ? (typeof msg.body === 'string' ? msg.body : JSON.stringify(msg.body)) : undefined,
      signal: controller.signal
    });

    const rawText = await res.text();
    let parsed = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = { rawText };
    }

    if (res.ok && parsed && parsed.status && (url.includes('/api/live/') || msg?.storeStatus)) {
      const serverBase = url.startsWith('http://localhost:3000')
        ? 'http://localhost:3000'
        : DEFAULT_SERVER_URL;
      await chrome.storage.local.set({
        lastBridgeStatus: parsed.status,
        lastHeartbeatAt: Date.now(),
        lastServerUrl: serverBase
      });
    }

    return { ok: res.ok, status: res.status, data: parsed };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: err?.name === 'AbortError' ? '서버 응답 시간 초과' : (err?.message || '네트워크 오류') }
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readVariationalCookies() {
  const allCookies = await chrome.cookies.getAll({ domain: 'variational.io' });
  const filtered = allCookies.filter((c) => {
    const d = (c.domain || '').toLowerCase();
    return d === 'omni.variational.io' || d === '.omni.variational.io' || d === '.variational.io' || d === 'variational.io';
  });
  if (filtered.length === 0) {
    return { ok: false, count: 0, cookieHeader: '' };
  }
  const map = new Map();
  for (const c of filtered) {
    if (!map.has(c.name) || String(c.domain).includes('omni.')) {
      map.set(c.name, `${c.name}=${c.value}`);
    }
  }
  return {
    ok: true,
    count: map.size,
    cookieHeader: Array.from(map.values()).join('; ')
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['serverUrl']);
  if (!existing.serverUrl) {
    await chrome.storage.local.set({ serverUrl: DEFAULT_SERVER_URL });
  } else {
    const normalized = normalizeServerUrl(existing.serverUrl);
    if (normalized !== existing.serverUrl) {
      await chrome.storage.local.set({ serverUrl: normalized });
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'BRIDGE_HTTP') {
    handleBridgeHttp(msg)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, status: 0, data: { error: err?.message || 'BRIDGE_HTTP 오류' } }));
    return true;
  }

  if (msg.type === 'GET_VARIATIONAL_COOKIES') {
    readVariationalCookies()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message || '쿠키 읽기 실패' }));
    return true;
  }

  return false;
});
