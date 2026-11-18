const DEFAULT_SERVER_URL = 'https://grok-trading-team.onrender.com';
const VAR_BASE_URL = 'https://omni.variational.io';
const RWA_ETFS = new Set(['QQQ', 'SOXL', 'EWY', 'SPY', 'IBIT', 'TLT', 'GLD', 'SLV', 'USO', 'VNQ', 'EWJ']);
const ALLOWED_SERVERS = new Set([
  'https://grok-trading-team.onrender.com',
  'http://localhost:3000'
]);

let lastContentHeartbeatAt = 0;
let bgHeartbeatBusy = false;
let currentBgAddress = '';
const bgExecutedSignals = new Set();
const connectedTabPorts = new Set();

function normalizeServerUrl(url) {
  const cleaned = String(url || '').trim().replace(/\/+$/, '');
  return ALLOWED_SERVERS.has(cleaned) ? cleaned : DEFAULT_SERVER_URL;
}

async function getConfiguredServerUrl() {
  const stored = await chrome.storage.local.get(['serverUrl']).catch(() => ({}));
  return normalizeServerUrl(stored?.serverUrl || DEFAULT_SERVER_URL);
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

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

async function bgVarApi(path, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(currentBgAddress ? { 'vr-connected-address': currentBgAddress } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${VAR_BASE_URL}${path}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`BG Variational API ${path} 실패 (${res.status}): ${json?.error || json?.message || text?.slice(0, 120)}`);
  }
  return json;
}

async function readWalletSnapshotFromBg() {
  let me = null;
  try {
    me = await bgVarApi('/api/me');
  } catch {
    return { loggedIn: false, address: '', balanceUsd: 0, upnlUsd: 0, marginUsage: 0, positions: [] };
  }
  const token = String(me?.token || '').trim();
  const payload = decodeJwtPayload(token);
  const addr = String(payload?.address || '').trim();
  if (!token || !addr || (payload?.exp && Date.now() / 1000 > Number(payload.exp))) {
    currentBgAddress = '';
    return { loggedIn: false, address: addr || '', balanceUsd: 0, upnlUsd: 0, marginUsage: 0, positions: [] };
  }
  currentBgAddress = addr;
  const [portfolio, rawPositions] = await Promise.all([
    bgVarApi('/api/portfolio?compute_margin=true').catch(() => ({})),
    bgVarApi('/api/positions').catch(() => ([]))
  ]);
  const rows = Array.isArray(rawPositions) ? rawPositions : (Array.isArray(rawPositions?.result) ? rawPositions.result : []);
  const positions = rows
    .map((r) => {
      const info = r?.position_info || r || {};
      const qty = Number(info.qty || 0);
      return {
        symbol: String(info?.instrument?.underlying || '').toUpperCase(),
        qty,
        rawQty: String(info?.qty ?? '0'),
        side: qty > 0 ? 'LONG' : qty < 0 ? 'SHORT' : 'FLAT',
        avgEntryPrice: Number(info?.avg_entry_price || 0),
        upnlUsd: Number(r?.upnl || info?.upnl || 0)
      };
    })
    .filter((p) => p.symbol && Math.abs(p.qty) > 0);

  const rawMu = portfolio?.margin_usage;
  const parsedMarginUsage = typeof rawMu === 'object' && rawMu !== null
    ? Number(rawMu.initial_margin || rawMu.total_initial_margin || 0)
    : Number(rawMu || 0);

  return {
    loggedIn: true,
    address: addr,
    balanceUsd: Number(portfolio?.balance || 0),
    upnlUsd: Number(portfolio?.upnl || 0),
    marginUsage: parsedMarginUsage,
    positions
  };
}

function getInstrumentFromBg(symbol) {
  const clean = String(symbol || '').toUpperCase().replace(/-PERP$/i, '').replace(/\/USD$/i, '').replace(/USDT$/i, '').trim();
  if (!clean) throw new Error('심볼이 비어 있습니다.');
  if (RWA_ETFS.has(clean)) {
    return { underlying: clean, instrument_type: 'perpetual_rwa_future', settlement_asset: 'USDC', kind: 'etf' };
  }
  return { underlying: clean, instrument_type: 'perpetual_future', settlement_asset: 'USDC', funding_interval_s: 3600 };
}

function countDecimalsBg(stepStr) {
  const s = String(stepStr || '').trim();
  if (!s || !s.includes('.')) return 0;
  return s.split('.')[1].replace(/0+$/, '').length;
}

function formatTickValueBg(rawNum, tickStr, minStr) {
  const num = Number(rawNum);
  if (!Number.isFinite(num) || num <= 0) return null;
  const tick = Number(tickStr);
  const minVal = Number(minStr);
  if (!Number.isFinite(tick) || tick <= 0) return num.toFixed(6).replace(/\.?0+$/, '');
  const decimals = Math.min(8, Math.max(countDecimalsBg(tickStr), countDecimalsBg(minStr)));
  let snapped = Math.floor((num + 1e-12) / tick) * tick;
  if (Number.isFinite(minVal) && minVal > 0 && snapped < minVal) snapped = minVal;
  if (snapped <= 0) snapped = tick;
  return snapped.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

function formatPriceBg(rawPrice) {
  const n = Number(rawPrice);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const decimals = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 4 : 6;
  const factor = 10 ** decimals;
  return (Math.floor(n * factor + 1e-9) / factor).toFixed(decimals).replace(/\.?0+$/, '');
}

async function executeSignalInBg(signal, snapshot, cfg) {
  const allowed = String(cfg?.allowedAddress || '').trim().toLowerCase();
  const actual = String(snapshot?.address || '').trim().toLowerCase();
  if (!snapshot?.loggedIn || !actual) throw new Error('BG 백업: Variational 세션 미로그인');
  if (!allowed || allowed !== actual) throw new Error(`BG 안전잠금 차단: ${snapshot.address} != ${cfg?.allowedAddress}`);

  const inst = getInstrumentFromBg(signal.symbol);
  if (signal.type === 'EXIT') {
    const pos = (snapshot.positions || []).find((p) => p.symbol === inst.underlying && Math.abs(p.qty) > 0);
    if (!pos) return { ok: true, symbol: inst.underlying, alreadyClosedOnVenue: true, exitPriceUsd: Number(signal.exitPriceUsd || 0) };
    const closeSide = pos.qty > 0 ? 'sell' : 'buy';
    const absQtyStr = pos.rawQty.replace(/^-/, '').trim();
    const slippageDecimal = Math.max(0.01, Math.min(0.05, Number(cfg?.maxSlippageBps || 100) / 10000));
    const quote = await bgVarApi('/api/quotes/indicative', { method: 'POST', body: { instrument: inst, qty: absQtyStr } });
    const acceptRes = await bgVarApi('/api/quotes/accept', {
      method: 'POST',
      body: { quote_id: quote.quote_id, side: closeSide, max_slippage: slippageDecimal, is_reduce_only: true }
    });
    const exitPriceUsd = Number(closeSide === 'sell' ? (quote.bid || quote.mark_price) : (quote.ask || quote.mark_price)) || Number(signal.exitPriceUsd || 0);
    return { ok: true, symbol: inst.underlying, alreadyClosedOnVenue: false, rfqId: acceptRes?.rfq_id || quote.quote_id, exitPriceUsd, closedQty: absQtyStr };
  }

  if (signal.type === 'ENTRY') {
    const activePositions = snapshot.positions || [];
    if (activePositions.some((p) => p.symbol === inst.underlying && Math.abs(p.qty) > 0)) {
      throw new Error(`중복 진입 차단: 이미 ${inst.underlying} 포지션 보유 중`);
    }
    const maxSlots = Math.max(1, Number(cfg?.maxSlots || 3));
    if (activePositions.length >= maxSlots) {
      throw new Error(`슬롯 상한 차단: ${activePositions.length}/${maxSlots}`);
    }
    const side = String(signal.direction || '').toUpperCase() === 'SHORT' ? 'sell' : 'buy';
    const targetLeverage = Math.max(1, Math.min(50, Math.round(Number(signal.leverage || 30))));
    let appliedLeverage = targetLeverage;
    for (const tryLev of Array.from(new Set([targetLeverage, 30, 25, 20, 15, 10]))) {
      try {
        await bgVarApi('/api/settlement_pools/set_leverage', { method: 'POST', body: { asset: inst.underlying, leverage: String(tryLev) } });
        appliedLeverage = tryLev;
        break;
      } catch {}
    }

    const bal = Number(snapshot.balanceUsd || 0);
    const rawUsed = Number(snapshot.marginUsage || 0);
    const usedMarginUsd = rawUsed > 1.5 ? rawUsed : (bal > 0 && rawUsed > 0 && rawUsed <= 1.5 ? bal * rawUsed : 0);
    const autoThirdMargin = bal > 0
      ? Number(((bal * 0.96) / maxSlots).toFixed(2))
      : Number(signal.marginUsd || cfg?.orderMarginUsd || 33);
    const freeMargin = bal > usedMarginUsd ? Number(((bal - usedMarginUsd) * 0.95).toFixed(2)) : autoThirdMargin;
    let marginUsd = Math.max(5, Math.min(autoThirdMargin, freeMargin > 5 ? freeMargin : autoThirdMargin));
    let notionalUsd = Number((marginUsd * appliedLeverage).toFixed(2));
    const slippageDecimal = Math.max(0.001, Math.min(0.05, Number(cfg?.maxSlippageBps || 100) / 10000));

    const estPrice = Number(signal.entryPriceUsd || signal.estPriceUsd || 100) || 100;
    const probeQty = String(Math.max(0.0001, Math.min(1, notionalUsd / estPrice)).toFixed(6)).replace(/\.?0+$/, '') || '0.01';
    const probe = await bgVarApi('/api/quotes/indicative', { method: 'POST', body: { instrument: inst, qty: probeQty } });
    const refPrice = Number(side === 'buy' ? (probe.ask || probe.mark_price) : (probe.bid || probe.mark_price)) || Number(probe.mark_price) || estPrice;
    const sideLimit = side === 'buy' ? (probe?.qty_limits?.ask || {}) : (probe?.qty_limits?.bid || {});
    const minQtyStr = sideLimit.min_qty || '0.0001';
    const tickStr = sideLimit.min_qty_tick || minQtyStr;
    let finalQtyStr = formatTickValueBg(notionalUsd / refPrice, tickStr, minQtyStr) || String(minQtyStr);
    let quote = await bgVarApi('/api/quotes/indicative', { method: 'POST', body: { instrument: inst, qty: finalQtyStr } });
    let execPrice = Number(side === 'buy' ? (quote.ask || quote.mark_price) : (quote.bid || quote.mark_price)) || refPrice;

    const tpTarget = Number(signal.takeProfitUsd || 0);
    const slTarget = Number(signal.stopLossUsd || 0);
    const minRr = Number(signal.minRrRatio || 1.15);
    if (tpTarget > 0 && slTarget > 0 && execPrice > 0) {
      const actualRisk = side === 'sell' ? (slTarget - execPrice) : (execPrice - slTarget);
      const actualReward = side === 'sell' ? (execPrice - tpTarget) : (tpTarget - execPrice);
      const actualRR = actualRisk > 0 ? (actualReward / actualRisk) : 0;
      if (actualRisk <= 0 || actualReward <= 0 || actualRR < minRr) {
        throw new Error(`손익비 안전가드 차단: 실시간 호가($${execPrice}) 기준 실제 손익비(1:${actualRR.toFixed(2)}) < 최소(1:${minRr})`);
      }
    }

    const buildBody = (qId) => {
      const p = { quote_id: qId, side, max_slippage: slippageDecimal, is_reduce_only: false };
      const tpStr = formatPriceBg(signal.takeProfitUsd);
      const slStr = formatPriceBg(signal.stopLossUsd);
      if (tpStr) Object.assign(p, { take_profit: tpStr, tp_is_auto_resize: true, tp_use_mark_price: true, tp_slippage_limit: '0.01' });
      if (slStr) Object.assign(p, { stop_loss: slStr, sl_is_auto_resize: true, sl_use_mark_price: true, sl_slippage_limit: '0.01' });
      return p;
    };

    let orderRes = null;
    try {
      orderRes = await bgVarApi('/api/orders/new/market', { method: 'POST', body: buildBody(quote.quote_id) });
    } catch (ordErr) {
      if (/margin|balance|insufficient|422/i.test(String(ordErr?.message || ''))) {
        marginUsd = Math.max(5, Number((marginUsd * 0.65).toFixed(2)));
        notionalUsd = Number((marginUsd * appliedLeverage).toFixed(2));
        finalQtyStr = formatTickValueBg(notionalUsd / refPrice, tickStr, minQtyStr) || String(minQtyStr);
        quote = await bgVarApi('/api/quotes/indicative', { method: 'POST', body: { instrument: inst, qty: finalQtyStr } });
        execPrice = Number(side === 'buy' ? (quote.ask || quote.mark_price) : (quote.bid || quote.mark_price)) || refPrice;
        orderRes = await bgVarApi('/api/orders/new/market', { method: 'POST', body: buildBody(quote.quote_id) });
      } else {
        throw ordErr;
      }
    }

    return {
      ok: true,
      symbol: inst.underlying,
      direction: side === 'sell' ? 'SHORT' : 'LONG',
      leverage: appliedLeverage,
      rfqId: orderRes?.rfq_id || quote.quote_id,
      qty: Number(finalQtyStr),
      qtyStr: finalQtyStr,
      entryPriceUsd: execPrice,
      marginUsd,
      notionalUsd: Number(finalQtyStr) * execPrice
    };
  }

  throw new Error(`BG 미지원 신호 유형: ${signal.type}`);
}

async function preventVariationalTabsSleeping() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://omni.variational.io/*'] });
    for (const tab of tabs) {
      if (tab.id && tab.autoDiscardable !== false) {
        chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
      }
    }
    return tabs;
  } catch {
    return [];
  }
}

async function tryForwardSignalToTab(tabs, signal, cfg) {
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const tabResp = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 10000);
        chrome.tabs.sendMessage(tab.id, { type: 'EXEC_SIGNAL_FROM_BG', signal, config: cfg }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp) return resolve(null);
          resolve(resp);
        });
      });
      if (tabResp && tabResp.handled) {
        return tabResp;
      }
    } catch {
      // fallback to next tab or background execution
    }
  }
  return null;
}

async function wakeTabsToHeartbeat(tabs) {
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const ack = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 2500);
        chrome.tabs.sendMessage(tab.id, { type: 'WAKE_HEARTBEAT' }, (resp) => {
          clearTimeout(t);
          if (chrome.runtime.lastError || !resp) return resolve(null);
          resolve(resp);
        });
      });
      if (ack?.ok) return true;
    } catch {}
  }
  return false;
}

async function runBgFallbackHeartbeat(force = false) {
  if (bgHeartbeatBusy) return;
  const ageMs = Date.now() - lastContentHeartbeatAt;
  if (!force && ageMs < 6000) return;

  bgHeartbeatBusy = true;
  try {
    const tabs = await preventVariationalTabsSleeping();
    // 1) 먼저 열려 있는 omni.variational.io 탭을 깨워 실제 페이지 출처(Same-Origin)로 하트비트 전송
    const tabWoke = await wakeTabsToHeartbeat(tabs);
    if (tabWoke) return;

    // 2) 탭이 응답하지 않을 때만 서비스 워커 직접 조회 -> 실패 시 캐시된 lastValidSnapshot 사용
    let snapshot = await readWalletSnapshotFromBg();
    if (!snapshot?.loggedIn || !snapshot?.address) {
      const stored = await chrome.storage.local.get(['lastValidSnapshot']).catch(() => ({}));
      if (stored?.lastValidSnapshot?.loggedIn && stored?.lastValidSnapshot?.address) {
        snapshot = stored.lastValidSnapshot;
      }
    }
    // 유효한 로그인 세션을 못 얻었으면 절대 loggedIn:false로 서버 기존 연결을 덮어쓰지 않고 조용히 종료
    if (!snapshot?.loggedIn || !snapshot?.address) {
      return;
    }

    const serverUrl = await getConfiguredServerUrl();
    const resp = await handleBridgeHttp({
      url: `${serverUrl}/api/live/edge-heartbeat`,
      method: 'POST',
      storeStatus: true,
      body: {
        loggedIn: true,
        address: snapshot.address,
        balanceUsd: snapshot.balanceUsd,
        upnlUsd: snapshot.upnlUsd,
        marginUsage: snapshot.marginUsage,
        positions: snapshot.positions,
        pageUrl: tabs[0]?.url || 'edge-service-worker://keepalive',
        source: 'BG_KEEPALIVE',
        sentAt: Date.now()
      }
    });

    if (resp?.ok && resp?.data?.signals?.length) {
      const cfg = resp.data.config || resp.data.status || {};
      for (const sig of resp.data.signals) {
        const sid = String(sig?.signalId || '');
        if (!sid || bgExecutedSignals.has(sid)) continue;
        bgExecutedSignals.add(sid);
        if (bgExecutedSignals.size > 200) {
          bgExecutedSignals.delete(bgExecutedSignals.values().next().value);
        }

        const forwarded = await tryForwardSignalToTab(tabs, sig, cfg);
        if (forwarded) continue;

        let ackBody = { signalId: sid, type: sig.type, symbol: sig.symbol };
        try {
          const result = await executeSignalInBg(sig, snapshot, cfg);
          ackBody = { ...ackBody, ok: true, result };
        } catch (err) {
          ackBody = { ...ackBody, ok: false, error: err?.message || 'BG 실행 오류' };
        }
        await handleBridgeHttp({
          url: `${serverUrl}/api/live/edge-ack`,
          method: 'POST',
          body: ackBody
        });
      }
    }
  } catch {
    // ignore transient wakeup error
  } finally {
    bgHeartbeatBusy = false;
  }
}

async function ensureKeepaliveAlarm() {
  try {
    const existing = await chrome.alarms.get('grok_bridge_keepalive');
    if (!existing) {
      await chrome.alarms.create('grok_bridge_keepalive', { periodInMinutes: 0.5 });
    }
  } catch {
    // fallback if interval < 1m rejected on older runtime
    try {
      await chrome.alarms.create('grok_bridge_keepalive', { periodInMinutes: 1 });
    } catch {}
  }
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
  await ensureKeepaliveAlarm();
  await preventVariationalTabsSleeping();
  runBgFallbackHeartbeat(true);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureKeepaliveAlarm();
  await preventVariationalTabsSleeping();
  runBgFallbackHeartbeat(true);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === 'grok_bridge_keepalive') {
    runBgFallbackHeartbeat(false);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab?.url?.startsWith('https://omni.variational.io/') && changeInfo.status === 'complete') {
    chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port?.name !== 'grok-keepalive') return;
  connectedTabPorts.add(port);
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'TAB_HEARTBEAT_OK') {
      lastContentHeartbeatAt = Date.now();
    }
  });
  port.onDisconnect.addListener(() => {
    connectedTabPorts.delete(port);
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'BRIDGE_HTTP') {
    if (String(msg.url || '').includes('/api/live/edge-heartbeat')) {
      lastContentHeartbeatAt = Date.now();
    }
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

ensureKeepaliveAlarm();
setInterval(() => runBgFallbackHeartbeat(false), 5000);
