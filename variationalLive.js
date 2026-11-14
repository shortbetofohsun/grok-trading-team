const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');
const LIVE_STATE_FILE = path.join(DATA_DIR, '.variational_live.json');
const API_BASE = 'https://omni.variational.io/api';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const ANALYTICS_COOKIE_NAMES = new Set([
  '_gid', '_fbp', '_fbc', '_dd_s', '_uetsid', '_uetvid', '_clck', '_clsk',
  '_rdt_uuid', '_ttp', '_tt_enable_cookie', '_scid', '_sctr', '_pin_unauth',
  'IDE', 'MUID', 'li_sugr', 'lidc', 'bcookie', 'bscookie',
  'sa-user-id', 'sa-user-id-v2', 'sa-user-id-v3'
]);

const ANALYTICS_COOKIE_PREFIXES = [
  '_ga', '_gcl_', '_hj', '_pk_', '_vwo', '_uet', 'ajs_', 'amp_',
  'amplitude', 'mp_', 'ph_', 'intercom-', '__hs', 'hubspotutk', '__str'
];

const RWA_ETFS = new Set(['QQQ', 'SOXL', 'EWY', 'SPY', 'IBIT', 'TLT', 'GLD', 'SLV', 'USO', 'VNQ', 'EWJ']);

function getDefaultLiveState() {
  return {
    enabled: false,
    allowedAddress: '',
    connectedAddress: '',
    cookies: '',
    token: '',
    tokenExp: 0,
    maxEquityCapUsd: 250,
    orderMarginUsd: 10,
    maxSlippageBps: 50,
    lastBalanceUsd: null,
    lastUpnlUsd: null,
    lastMarginUsageUsd: null,
    lastOpenPositionsCount: 0,
    lastVerifiedAt: null,
    lastError: null
  };
}

let liveState = getDefaultLiveState();

function loadLiveState() {
  try {
    if (fs.existsSync(LIVE_STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LIVE_STATE_FILE, 'utf-8'));
      if (raw && typeof raw === 'object') {
        liveState = { ...getDefaultLiveState(), ...raw };
      }
    }
  } catch {
    liveState = getDefaultLiveState();
  }
  return liveState;
}

function saveLiveState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LIVE_STATE_FILE, JSON.stringify(liveState, null, 2), 'utf-8');
  } catch (err) {
    console.error('[VariationalLive] Failed to save live state:', err.message);
  }
}

loadLiveState();

function isBlockedVendorCookie(name) {
  const lower = String(name || '').toLowerCase();
  if (!lower) return true;
  if (lower === '__cf_bm' || lower === '_cfuvid' || lower === 'cf_clearance') return true;
  if (lower.startsWith('cf_') || lower.startsWith('__cf')) return true;
  if (ANALYTICS_COOKIE_NAMES.has(name) || ANALYTICS_COOKIE_NAMES.has(lower)) return true;
  for (const prefix of ANALYTICS_COOKIE_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

function cleanCookieHeader(rawCookie) {
  let s = String(rawCookie || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^cookie:\s*/i, '').trim();
  if (!s) return '';

  const map = new Map();
  for (const part of s.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (isBlockedVendorCookie(name)) continue;
    map.set(name, val);
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbSetCookies(existingHeader, setCookieHeaders) {
  if (!Array.isArray(setCookieHeaders) || !setCookieHeaders.length) return existingHeader;
  const map = new Map();
  const base = cleanCookieHeader(existingHeader);
  if (base) {
    for (const part of base.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }
  for (const sc of setCookieHeaders) {
    const firstPart = String(sc || '').split(';')[0] || '';
    const eq = firstPart.indexOf('=');
    if (eq <= 0) continue;
    const name = firstPart.slice(0, eq).trim();
    const val = firstPart.slice(eq + 1).trim();
    if (isBlockedVendorCookie(name)) continue;
    if (val === '' || /max-age=0/i.test(sc)) {
      map.delete(name);
    } else {
      map.set(name, val);
    }
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function escapeCurlConfigValue(val) {
  return `"${String(val)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function splitCurlStdout(stdout) {
  let offset = 0;
  let lastHeaderBlock = '';
  while (stdout.slice(offset).startsWith('HTTP/')) {
    const slice = stdout.slice(offset);
    const match = /\r?\n\r?\n/.exec(slice);
    if (!match) break;
    lastHeaderBlock = slice.slice(0, match.index);
    offset += match.index + match[0].length;
  }
  return {
    rawHeaders: lastHeaderBlock,
    rawBody: stdout.slice(offset)
  };
}

function parseHeaderLines(rawHeaders) {
  const lines = String(rawHeaders || '').split(/\r?\n/);
  const statusLine = lines[0] || '';
  const status = Number.parseInt(statusLine.split(' ')[1] || '0', 10) || 0;
  const setCookies = [];
  const headers = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (name === 'set-cookie') {
      setCookies.push(val);
    } else {
      headers[name] = val;
    }
  }
  return { status, headers, setCookies };
}

function curlVariationalRequest(method, apiPath, bodyObj = undefined, customCookies = undefined, customAddress = undefined) {
  const url = apiPath.startsWith('http') ? apiPath : `${API_BASE}${apiPath}`;
  const curlBin = process.env.CURL_BIN || (process.platform === 'win32' ? 'curl.exe' : 'curl');
  const cookieStr = customCookies !== undefined ? cleanCookieHeader(customCookies) : cleanCookieHeader(liveState.cookies);
  const addrStr = String(customAddress !== undefined ? customAddress : (liveState.connectedAddress || liveState.allowedAddress || '')).trim();

  const args = [
    '--silent',
    '--show-error',
    '--dump-header', '-',
    '--max-time', '25',
    '--no-location',
    '--request', String(method || 'GET').toUpperCase(),
    '--user-agent', BROWSER_USER_AGENT,
    '--config', '-',
    '--url', url
  ];

  const cfgLines = [];
  if (cookieStr) {
    cfgLines.push(`header = ${escapeCurlConfigValue(`cookie: ${cookieStr}`)}`);
  }
  if (addrStr) {
    cfgLines.push(`header = ${escapeCurlConfigValue(`vr-connected-address: ${addrStr}`)}`);
  }
  if (bodyObj !== undefined) {
    const jsonBody = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
    cfgLines.push(`header = ${escapeCurlConfigValue('content-type: application/json')}`);
    cfgLines.push(`data-raw = ${escapeCurlConfigValue(jsonBody)}`);
  }
  const configText = cfgLines.length ? `${cfgLines.join('\n')}\n` : '';

  return new Promise((resolve, reject) => {
    const child = execFile(
      curlBin,
      args,
      { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`curl ${method} ${apiPath} failed: ${stderr || err.message}`));
        }
        const { rawHeaders, rawBody } = splitCurlStdout(stdout || '');
        const parsed = parseHeaderLines(rawHeaders);
        if (parsed.setCookies.length > 0 && customCookies === undefined && liveState.cookies) {
          const updated = absorbSetCookies(liveState.cookies, parsed.setCookies);
          if (updated && updated !== liveState.cookies) {
            liveState.cookies = updated;
            saveLiveState();
          }
        }
        let data = rawBody;
        try {
          if (rawBody && (rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[') || rawBody.trim().startsWith('"'))) {
            data = JSON.parse(rawBody);
          }
        } catch {}
        resolve({
          ok: parsed.status >= 200 && parsed.status < 300,
          status: parsed.status,
          headers: parsed.headers,
          setCookies: parsed.setCookies,
          data,
          rawBody
        });
      }
    );
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(configText);
    }
  });
}

function getVariationalInstrument(symbolOrTicker) {
  const sym = String(symbolOrTicker || '').toUpperCase().replace(/USDT$/, '').trim();
  if (RWA_ETFS.has(sym)) {
    return {
      underlying: sym,
      instrument_type: 'perpetual_rwa_future',
      settlement_asset: 'USDC',
      kind: 'etf'
    };
  }
  return {
    underlying: sym,
    instrument_type: 'perpetual_future',
    settlement_asset: 'USDC',
    funding_interval_s: 3600
  };
}

function toPlainString(value) {
  const raw = typeof value === 'string' ? value.trim().replace(/[,_\s]/g, '') : String(value);
  if (!raw || !/[eE]/.test(raw)) return raw;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(raw);
  if (!m) return raw;
  const sign = m[1] || '';
  const intPart = m[2] || '';
  const fracPart = m[3] || '';
  const exp = Number(m[4]);
  const digits = `${intPart}${fracPart}`;
  const point = intPart.length + exp;
  let body;
  if (point <= 0) body = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) body = `${digits}${'0'.repeat(point - digits.length)}`;
  else body = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${sign}${body}`;
}

function stripTrailingZeros(val) {
  const s = String(val || '');
  if (!s.includes('.')) return s;
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

function countDecimals(val) {
  const s = toPlainString(val);
  const idx = s.indexOf('.');
  return idx === -1 ? 0 : s.length - idx - 1;
}

function truncateToDecimals(val, decimals) {
  const s = toPlainString(val);
  if (!s) return s;
  const dot = s.indexOf('.');
  if (dot === -1) return s;
  if (decimals <= 0) return s.slice(0, dot);
  const cut = s.slice(0, dot + 1 + decimals);
  return cut.endsWith('.') ? cut.slice(0, -1) : cut;
}

function formatQty(qty, minQtyTick) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`유효하지 않은 주문 수량: ${qty}`);
  }
  const allowedDecimals = minQtyTick !== undefined && minQtyTick !== null
    ? countDecimals(stripTrailingZeros(toPlainString(minQtyTick)))
    : 4;
  return stripTrailingZeros(truncateToDecimals(n, allowedDecimals));
}

function formatPrice(price, maxDecimals = 8) {
  const n = Number(price);
  if (!Number.isFinite(n)) throw new Error(`유효하지 않은 주문 가격: ${price}`);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const lead = abs < 1 ? Math.max(0, Math.floor(-Math.log10(abs))) : 0;
  const decimals = Math.min(18, maxDecimals + lead);
  const fixed = abs < 1e21 ? n.toFixed(decimals) : toPlainString(n);
  return stripTrailingZeros(fixed);
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function extractApiError(res, fallback) {
  if (res?.data && typeof res.data === 'object') {
    return res.data.error_message || res.data.message || fallback;
  }
  if (typeof res?.rawBody === 'string' && res.rawBody.includes('Just a moment')) {
    return 'Cloudflare 보안 차단(클라우드 IP 또는 브라우저 헤더 불일치)';
  }
  return fallback || `HTTP ${res?.status || 0}`;
}

function getPublicLiveStatus() {
  return {
    enabled: Boolean(liveState.enabled),
    hasSession: Boolean(liveState.cookies),
    allowedAddress: liveState.allowedAddress || '',
    connectedAddress: liveState.connectedAddress || '',
    maxEquityCapUsd: Number(liveState.maxEquityCapUsd || 250),
    orderMarginUsd: Number(liveState.orderMarginUsd || 10),
    maxSlippageBps: Number(liveState.maxSlippageBps || 50),
    lastBalanceUsd: liveState.lastBalanceUsd,
    lastUpnlUsd: liveState.lastUpnlUsd,
    lastMarginUsageUsd: liveState.lastMarginUsageUsd,
    lastOpenPositionsCount: Number(liveState.lastOpenPositionsCount || 0),
    lastVerifiedAt: liveState.lastVerifiedAt || null,
    tokenExp: Number(liveState.tokenExp || 0),
    lastError: liveState.lastError || null,
    isCloudBlocked: Boolean(process.env.RENDER_EXTERNAL_URL)
  };
}

function isLiveTradingActive() {
  return Boolean(!process.env.RENDER_EXTERNAL_URL && liveState.enabled && liveState.cookies);
}

async function verifyLiveAccountSafety() {
  if (!liveState.cookies) {
    liveState.enabled = false;
    liveState.lastError = 'Edge 세션 쿠키가 등록되지 않았습니다.';
    saveLiveState();
    return { ok: false, error: liveState.lastError };
  }

  let meRes;
  try {
    meRes = await curlVariationalRequest('GET', '/me');
  } catch (err) {
    liveState.lastError = err.message;
    saveLiveState();
    return { ok: false, error: err.message };
  }

  const meToken = meRes?.data?.token || '';
  if (!meRes.ok || !meToken) {
    liveState.enabled = false;
    liveState.lastError = !meRes.ok
      ? `세션 검증 실패 (${meRes.status}): ${extractApiError(meRes)}`
      : '세션 쿠키가 만료되었거나 로그인되지 않았습니다.';
    saveLiveState();
    return { ok: false, error: liveState.lastError };
  }

  const claims = decodeJwtPayload(meToken) || {};
  const sessionAddr = String(claims.address || liveState.connectedAddress || '').trim();
  if (!sessionAddr) {
    liveState.enabled = false;
    liveState.lastError = 'JWT 토큰에서 지갑 주소를 확인할 수 없습니다.';
    saveLiveState();
    return { ok: false, error: liveState.lastError };
  }

  // 3중 안전장치 1) 부계정 화이트리스트 주소 하드락
  if (liveState.allowedAddress && sessionAddr.toLowerCase() !== liveState.allowedAddress.toLowerCase()) {
    liveState.enabled = false;
    liveState.lastError = `본계정 보호 차단: 세션 지갑(${sessionAddr})이 등록된 부계정 주소(${liveState.allowedAddress})와 불일치합니다.`;
    saveLiveState();
    return { ok: false, error: liveState.lastError };
  }
  if (!liveState.allowedAddress) {
    liveState.allowedAddress = sessionAddr;
  }

  liveState.connectedAddress = sessionAddr;
  liveState.token = meToken;
  liveState.tokenExp = Number(claims.exp || 0);

  const [portRes, posRes] = await Promise.all([
    curlVariationalRequest('GET', '/portfolio?compute_margin=true'),
    curlVariationalRequest('GET', '/positions')
  ]);

  if (!portRes.ok) {
    liveState.enabled = false;
    liveState.lastError = `잔고 조회 실패 (${portRes.status}): ${extractApiError(portRes)}`;
    saveLiveState();
    return { ok: false, error: liveState.lastError };
  }

  const portfolio = portRes.data || {};
  const balance = Number(portfolio.balance ?? 0);
  const upnl = Number(portfolio.upnl ?? 0);
  const marginUsage = Number(portfolio.margin_usage ?? 0);
  const positions = Array.isArray(posRes?.data)
    ? posRes.data
    : (Array.isArray(posRes?.data?.result) ? posRes.data.result : []);

  // 3중 안전장치 2) 계좌 잔고 상한선 차단
  const cap = Number(liveState.maxEquityCapUsd || 250);
  if (balance > cap) {
    liveState.enabled = false;
    liveState.lastBalanceUsd = balance;
    liveState.lastUpnlUsd = upnl;
    liveState.lastMarginUsageUsd = marginUsage;
    liveState.lastOpenPositionsCount = positions.length;
    liveState.lastError = `본계정 보호 차단: 계좌 잔고($${balance.toFixed(2)})가 부계정 상한선($${cap})을 초과합니다.`;
    saveLiveState();
    return { ok: false, error: liveState.lastError };
  }

  liveState.lastBalanceUsd = balance;
  liveState.lastUpnlUsd = upnl;
  liveState.lastMarginUsageUsd = marginUsage;
  liveState.lastOpenPositionsCount = positions.length;
  liveState.lastVerifiedAt = new Date().toISOString();
  liveState.lastError = null;
  saveLiveState();

  return { ok: true, status: getPublicLiveStatus(), positions };
}

async function connectEdgeSession({ cookies, allowedAddress, maxEquityCapUsd, orderMarginUsd, maxSlippageBps }) {
  const prevState = { ...liveState };
  if (cookies !== undefined && String(cookies).trim()) {
    const cleaned = cleanCookieHeader(cookies);
    if (!cleaned) {
      return { ok: false, error: '유효한 Variational 세션 쿠키(vr-*)가 포함되지 않았습니다.' };
    }
    liveState.cookies = cleaned;
  }
  if (allowedAddress !== undefined) {
    liveState.allowedAddress = String(allowedAddress || '').trim();
  }
  if (maxEquityCapUsd !== undefined && Number(maxEquityCapUsd) > 0) {
    liveState.maxEquityCapUsd = Number(maxEquityCapUsd);
  }
  if (orderMarginUsd !== undefined && Number(orderMarginUsd) >= 1) {
    liveState.orderMarginUsd = Number(orderMarginUsd);
  }
  if (maxSlippageBps !== undefined && Number(maxSlippageBps) > 0) {
    liveState.maxSlippageBps = Number(maxSlippageBps);
  }

  const verified = await verifyLiveAccountSafety();
  if (!verified.ok) {
    if (cookies === undefined && prevState.cookies) {
      liveState.lastError = verified.error;
      saveLiveState();
    }
    return verified;
  }
  return { ok: true, status: getPublicLiveStatus(), positions: verified.positions };
}

async function toggleLiveMode(enabled) {
  const want = Boolean(enabled);
  if (!want) {
    liveState.enabled = false;
    saveLiveState();
    return { ok: true, status: getPublicLiveStatus() };
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return { ok: false, error: '클라우드(Render) 환경에서는 Cloudflare 차단으로 실전 주문을 실행할 수 없습니다. 로컬 PC에서 실행해 주세요.' };
  }
  const verified = await verifyLiveAccountSafety();
  if (!verified.ok) return verified;

  liveState.enabled = true;
  saveLiveState();
  return { ok: true, status: getPublicLiveStatus() };
}

function disconnectEdgeSession() {
  const preservedCap = Number(liveState.maxEquityCapUsd || 250);
  const preservedMargin = Number(liveState.orderMarginUsd || 10);
  const preservedSlip = Number(liveState.maxSlippageBps || 50);
  liveState = {
    ...getDefaultLiveState(),
    maxEquityCapUsd: preservedCap,
    orderMarginUsd: preservedMargin,
    maxSlippageBps: preservedSlip
  };
  saveLiveState();
  return { ok: true, status: getPublicLiveStatus() };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function prepareExactQuoteForNotional(inst, side, notionalUsd, hintPriceUsd = 0) {
  const estPrice = Math.max(0.0001, Number(hintPriceUsd || 1));
  const estQty = stripTrailingZeros(Math.max(0.00001, notionalUsd / estPrice).toPrecision(4));

  const q1Res = await curlVariationalRequest('POST', '/quotes/indicative', {
    instrument: inst,
    qty: estQty
  });
  if (!q1Res.ok || !q1Res.data?.quote_id) {
    throw new Error(`1차 호가 조회 실패 (${q1Res.status}): ${extractApiError(q1Res)}`);
  }

  const q1 = q1Res.data;
  const limit = side === 'sell' ? q1.qty_limits?.bid : q1.qty_limits?.ask;
  const refPrice = Number(side === 'buy' ? (q1.ask || q1.mark_price) : (q1.bid || q1.mark_price)) || estPrice;
  const rawQty = notionalUsd / refPrice;
  const finalQty = formatQty(rawQty, limit?.min_qty_tick || '0.0001');

  if (limit?.min_qty && Number(finalQty) < Number(limit.min_qty)) {
    throw new Error(`계산된 수량(${finalQty})이 최소 주문 수량(${limit.min_qty})보다 작습니다. 1회 증거금을 늘려주세요.`);
  }
  if (Number(finalQty) * refPrice < 0.1) {
    throw new Error(`주문 금액이 최소 기준($0.10 USDC) 미만입니다.`);
  }

  if (finalQty === estQty) {
    return { quote: q1, finalQty, refPrice };
  }

  const q2Res = await curlVariationalRequest('POST', '/quotes/indicative', {
    instrument: inst,
    qty: finalQty
  });
  if (!q2Res.ok || !q2Res.data?.quote_id) {
    throw new Error(`2차 정밀 호가 조회 실패 (${q2Res.status}): ${extractApiError(q2Res)}`);
  }
  const q2 = q2Res.data;
  const finalRefPrice = Number(side === 'buy' ? (q2.ask || q2.mark_price) : (q2.bid || q2.mark_price)) || refPrice;
  return { quote: q2, finalQty, refPrice: finalRefPrice };
}

async function executeLiveStopHuntEntry(cand, overrideMarginUsd = undefined) {
  if (process.env.RENDER_EXTERNAL_URL) {
    throw new Error('클라우드(Render)에서는 실전 주문을 차단합니다.');
  }
  const safety = await verifyLiveAccountSafety();
  if (!safety.ok) throw new Error(safety.error);

  const inst = getVariationalInstrument(cand.contract || cand.symbol);
  try {
    await curlVariationalRequest('POST', '/settlement_pools/set_leverage', {
      asset: inst.underlying,
      leverage: '10'
    });
  } catch {}

  const availBalance = Number(liveState.lastBalanceUsd || 0);
  if (availBalance < 1) {
    throw new Error(`Variational 가용 잔고($${availBalance.toFixed(2)})가 부족합니다.`);
  }

  const marginUsd = Math.max(1, Math.min(
    Number(overrideMarginUsd || liveState.orderMarginUsd || 10),
    availBalance * 0.9
  ));
  const notionalUsd = Number((marginUsd * 10).toFixed(2));
  const side = cand.direction === 'LONG' ? 'buy' : 'sell';

  const { quote, finalQty, refPrice } = await prepareExactQuoteForNotional(
    inst,
    side,
    notionalUsd,
    Number(cand.priceUsd || cand.markPriceUsd || 1)
  );

  const orderBody = {
    quote_id: quote.quote_id,
    side,
    max_slippage: Number(liveState.maxSlippageBps || 50) / 10000,
    is_reduce_only: false,
    take_profit: formatPrice(cand.tp2PriceUsd),
    tp_is_auto_resize: true,
    tp_use_mark_price: true,
    tp_slippage_limit: '0.01',
    stop_loss: formatPrice(cand.stopPriceUsd),
    sl_is_auto_resize: true,
    sl_use_mark_price: true,
    sl_slippage_limit: '0.01'
  };

  const ackRes = await curlVariationalRequest('POST', '/orders/new/market', orderBody);
  if (!ackRes.ok || !ackRes.data?.rfq_id) {
    throw new Error(`실전 진입 주문 거부 (${ackRes.status}): ${extractApiError(ackRes)}`);
  }

  return {
    ok: true,
    rfqId: ackRes.data.rfq_id,
    qty: Number(finalQty),
    entryPriceUsd: refPrice,
    marginUsd: Number(marginUsd.toFixed(2)),
    notionalUsd
  };
}

function findMatchingVenuePosition(positions, underlying) {
  const target = String(underlying || '').toUpperCase();
  for (const row of positions || []) {
    const info = row?.position_info || row;
    const rowSym = String(info?.instrument?.underlying || info?.underlying || '').toUpperCase();
    const qty = Number(info?.qty ?? 0);
    if (rowSym === target && Math.abs(qty) > 0) {
      return { raw: row, qty };
    }
  }
  return null;
}

async function executeLiveStopHuntClose(pos) {
  if (process.env.RENDER_EXTERNAL_URL) {
    throw new Error('클라우드(Render)에서는 실전 청산을 실행할 수 없습니다.');
  }
  const inst = getVariationalInstrument(pos.contract || pos.symbol);
  const posRes = await curlVariationalRequest('GET', '/positions');
  const positions = Array.isArray(posRes?.data)
    ? posRes.data
    : (Array.isArray(posRes?.data?.result) ? posRes.data.result : []);

  const matched = findMatchingVenuePosition(positions, inst.underlying);
  if (!matched) {
    return { ok: true, alreadyClosedOnVenue: true, exitPriceUsd: pos.currentPriceUsd };
  }

  const closeSide = matched.qty > 0 ? 'sell' : 'buy';
  const rawAbsQty = toPlainString(Math.abs(matched.qty));

  const qRes = await curlVariationalRequest('POST', '/quotes/indicative', {
    instrument: inst,
    qty: rawAbsQty
  });
  if (!qRes.ok || !qRes.data?.quote_id) {
    throw new Error(`청산 호가 조회 실패 (${qRes.status}): ${extractApiError(qRes)}`);
  }

  const q = qRes.data;
  const limit = closeSide === 'sell' ? q.qty_limits?.bid : q.qty_limits?.ask;
  const cleanQty = limit?.min_qty_tick ? formatQty(rawAbsQty, limit.min_qty_tick) : stripTrailingZeros(rawAbsQty);

  let acceptQuote = q;
  if (cleanQty !== rawAbsQty) {
    const qRetry = await curlVariationalRequest('POST', '/quotes/indicative', {
      instrument: inst,
      qty: cleanQty
    });
    if (qRetry.ok && qRetry.data?.quote_id) {
      acceptQuote = qRetry.data;
    }
  }

  const accRes = await curlVariationalRequest('POST', '/quotes/accept', {
    quote_id: acceptQuote.quote_id,
    side: closeSide,
    max_slippage: 0.01,
    is_reduce_only: true
  });
  if (!accRes.ok || !accRes.data?.rfq_id) {
    throw new Error(`실전 청산 거부 (${accRes.status}): ${extractApiError(accRes)}`);
  }

  const exitPriceUsd = Number(closeSide === 'sell' ? (acceptQuote.bid || acceptQuote.mark_price) : (acceptQuote.ask || acceptQuote.mark_price)) || pos.currentPriceUsd;
  return {
    ok: true,
    rfqId: accRes.data.rfq_id,
    exitPriceUsd
  };
}

async function executeLiveRoundtripTest(symbol = 'BTC', notionalUsd = 1.5) {
  if (process.env.RENDER_EXTERNAL_URL) {
    throw new Error('클라우드(Render)에서는 실전 테스트 주문을 실행할 수 없습니다.');
  }
  const safety = await verifyLiveAccountSafety();
  if (!safety.ok) throw new Error(safety.error);

  const inst = getVariationalInstrument(symbol);
  try {
    await curlVariationalRequest('POST', '/settlement_pools/set_leverage', {
      asset: inst.underlying,
      leverage: '10'
    });
  } catch {}

  const statsRes = await curlVariationalRequest('POST', '/quotes/simple', {
    instrument: inst,
    qty: '0.001'
  });
  const hintPrice = Number(statsRes?.data?.mark_price || statsRes?.data?.ask || 67000);

  const { quote: openQuote, finalQty, refPrice: entryPrice } = await prepareExactQuoteForNotional(
    inst,
    'buy',
    Math.max(0.5, Number(notionalUsd || 1.5)),
    hintPrice
  );

  const existingBefore = findMatchingVenuePosition(safety.positions, inst.underlying);
  if (existingBefore) {
    throw new Error(`이미 ${inst.underlying} 열린 실전 포지션(qty=${existingBefore.qty})이 있어 테스트 주문을 중단했습니다.`);
  }

  const openRes = await curlVariationalRequest('POST', '/orders/new/market', {
    quote_id: openQuote.quote_id,
    side: 'buy',
    max_slippage: Number(liveState.maxSlippageBps || 50) / 10000,
    is_reduce_only: false
  });
  if (!openRes.ok || !openRes.data?.rfq_id) {
    throw new Error(`테스트 진입 주문 실패 (${openRes.status}): ${extractApiError(openRes)}`);
  }

  await sleep(1500);

  const posCheckRes = await curlVariationalRequest('GET', '/positions');
  const livePositions = Array.isArray(posCheckRes?.data)
    ? posCheckRes.data
    : (Array.isArray(posCheckRes?.data?.result) ? posCheckRes.data.result : []);
  const venuePos = findMatchingVenuePosition(livePositions, inst.underlying);

  if (!venuePos) {
    await verifyLiveAccountSafety();
    return {
      ok: true,
      openRfqId: openRes.data.rfq_id,
      closeRfqId: null,
      note: '진입 주문은 접수되었으나 1.5초 시점 포지션이 이미 0으로 확인되었습니다.',
      qty: finalQty,
      entryPrice,
      exitPrice: entryPrice,
      status: getPublicLiveStatus()
    };
  }

  const closeRes = await executeLiveStopHuntClose({
    symbol: inst.underlying,
    contract: inst.underlying,
    currentPriceUsd: entryPrice
  });

  await sleep(600);
  await verifyLiveAccountSafety();

  return {
    ok: true,
    openRfqId: openRes.data.rfq_id,
    closeRfqId: closeRes.rfqId || null,
    qty: finalQty,
    entryPrice,
    exitPrice: closeRes.exitPriceUsd,
    status: getPublicLiveStatus()
  };
}

module.exports = {
  cleanCookieHeader,
  getVariationalInstrument,
  formatQty,
  formatPrice,
  getPublicLiveStatus,
  isLiveTradingActive,
  verifyLiveAccountSafety,
  connectEdgeSession,
  toggleLiveMode,
  disconnectEdgeSession,
  executeLiveStopHuntEntry,
  executeLiveStopHuntClose,
  executeLiveRoundtripTest
};
