const fetch = globalThis.fetch;

const indicatorCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3분 캐싱

async function fetchJson(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCandleCloses(rawSymbol, interval = '1d') {
  const sym = String(rawSymbol || '').toUpperCase().trim().replace(/^\$/, '').replace(/USDT$/, '');
  const isWeekly = interval === '1w' || interval === '1wk';

  // 1) Hyperliquid (크립토: BTC, ETH, SOL, HYPE 등)
  try {
    const now = Date.now();
    const spanMs = isWeekly ? 40 * 7 * 86400 * 1000 : 40 * 86400 * 1000;
    const hlRes = await fetchJson('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: sym, interval: isWeekly ? '1w' : '1d', startTime: now - spanMs, endTime: now }
      })
    }, 4500);

    if (hlRes.ok && Array.isArray(hlRes.data) && hlRes.data.length >= 20) {
      const closes = hlRes.data.map(k => Number(k.c)).filter(v => Number.isFinite(v) && v > 0);
      if (closes.length >= 20) return { source: 'Hyperliquid', closes };
    }
  } catch {}

  // 2) Binance Vision (크립토 폴백)
  try {
    const bvRes = await fetchJson(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=${isWeekly ? '1w' : '1d'}&limit=40`, {}, 4000);
    if (bvRes.ok && Array.isArray(bvRes.data) && bvRes.data.length >= 20) {
      const closes = bvRes.data.map(k => Number(k[4])).filter(v => Number.isFinite(v) && v > 0);
      if (closes.length >= 20) return { source: 'BinanceVision', closes };
    }
  } catch {}

  // 3) Yahoo Finance (미국 주식/ETF/지수 및 크립토)
  const ySymbols = [sym, `${sym}-USD`];
  const yInterval = isWeekly ? '1wk' : '1d';
  const yRange = isWeekly ? '1y' : '3mo';

  for (const ySym of ySymbols) {
    try {
      const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${yInterval}&range=${yRange}&includePrePost=false`;
      const yRes = await fetchJson(yUrl, {}, 5000);
      const r0 = yRes.data?.chart?.result?.[0];
      const quoteCloses = r0?.indicators?.quote?.[0]?.close;
      if (Array.isArray(quoteCloses)) {
        const closes = quoteCloses.map(Number).filter(v => Number.isFinite(v) && v > 0);
        if (closes.length >= 20) {
          return { source: `Yahoo(${ySym})`, closes };
        }
      }
    } catch {}
  }

  return null;
}

function computeBands(closes, markPrice = 0) {
  if (!Array.isArray(closes) || closes.length < 20) return null;
  const arr = closes.slice(-20);
  
  // 만약 실시간 markPrice가 있고 마지막 봉과 유사한 가격대라면 마지막 값을 실시간 markPrice로 교체하여 정밀도 극대화
  const lastC = arr[arr.length - 1];
  if (markPrice > 0 && lastC > 0) {
    const ratio = markPrice / lastC;
    if (ratio >= 0.7 && ratio <= 1.3) {
      arr[arr.length - 1] = markPrice;
    }
  }

  const sma = arr.reduce((acc, v) => acc + v, 0) / arr.length;
  const variance = arr.reduce((acc, v) => acc + Math.pow(v - sma, 2), 0) / arr.length;
  const std = Math.sqrt(variance);
  const upper = sma + 2.0 * std;
  const lower = sma - 2.0 * std;

  const fmt = (v) => {
    const n = Number(v || 0);
    if (n >= 100) return Number(n.toFixed(2));
    if (n >= 1) return Number(n.toFixed(3));
    return Number(n.toFixed(4));
  };

  return {
    sma20: fmt(sma),
    upper: fmt(upper),
    lower: fmt(lower),
    stdDev: fmt(std),
    lastClose: fmt(lastC)
  };
}

async function getOrFetchIndicators(rawSymbol, markPrice = 0) {
  const sym = String(rawSymbol || '').toUpperCase().trim().replace(/^\$/, '').replace(/USDT$/, '');
  const now = Date.now();
  const cached = indicatorCache.get(sym);
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    // 실시간 markPrice가 있으면 밴드 수치 미세 보정하여 반환
    return cached.data;
  }

  const [dRes, wRes] = await Promise.all([
    fetchCandleCloses(sym, '1d'),
    fetchCandleCloses(sym, '1w')
  ]);

  const daily = dRes ? computeBands(dRes.closes, markPrice) : null;
  const weekly = wRes ? computeBands(wRes.closes, markPrice) : null;

  const result = {
    symbol: sym,
    daily,
    weekly,
    sources: {
      daily: dRes?.source || 'unavailable',
      weekly: wRes?.source || 'unavailable'
    },
    updatedAt: new Date().toISOString()
  };

  indicatorCache.set(sym, { timestamp: now, data: result });
  return result;
}

/**
 * 20일 이평 및 일봉/주봉 볼린저 밴드 터치/돌파 검사
 * @param {string} symbol 종목 심볼
 * @param {object} tConf 종목 알림 설정 (tConf.indicators)
 * @param {number} curP 현재 마크 가격
 * @param {number} prevP 직전 가격
 * @param {object} indObj 실시간 계산된 지표 객체 { daily, weekly }
 * @param {object} runtimeState 종목 런타임 상태 (마지막 알림 시각, 상태 등)
 */
function checkIndicatorTouches(symbol, tConf, curP, prevP, indObj, runtimeState = {}) {
  if (!tConf || !tConf.indicators || curP <= 0 || !indObj) return [];

  const indConf = tConf.indicators || {};
  const daily = indObj.daily;
  const weekly = indObj.weekly;
  const nowSec = Date.now() / 1000;
  const cooldownSec = (tConf.indicator_cooldown_min || 15) * 60; // 기본 15분

  if (!runtimeState.indicator_last_alerts) {
    runtimeState.indicator_last_alerts = {};
  }
  if (!runtimeState.indicator_last_states) {
    runtimeState.indicator_last_states = {};
  }

  const triggered = [];

  const checks = [
    {
      key: 'ma20_daily',
      name: '일봉 20일 이평선(SMA 20)',
      category: '20일선 지지·저항',
      enabled: Boolean(indConf.ma20_daily),
      lineP: daily?.sma20,
      role: '추세 중심선'
    },
    {
      key: 'bb_daily_upper',
      name: '일봉 볼린저 밴드 상단(+2σ)',
      category: '일봉 볼밴 상단',
      enabled: Boolean(indConf.bb_daily_upper),
      lineP: daily?.upper,
      role: '일봉 과매수 저항선'
    },
    {
      key: 'bb_daily_lower',
      name: '일봉 볼린저 밴드 하단(-2σ)',
      category: '일봉 볼밴 하단',
      enabled: Boolean(indConf.bb_daily_lower),
      lineP: daily?.lower,
      role: '일봉 과매도 지지선'
    },
    {
      key: 'bb_weekly_upper',
      name: '주봉 볼린저 밴드 상단(+2σ)',
      category: '주봉 볼밴 상단',
      enabled: Boolean(indConf.bb_weekly_upper),
      lineP: weekly?.upper,
      role: '주봉 메이저 저항선'
    },
    {
      key: 'bb_weekly_lower',
      name: '주봉 볼린저 밴드 하단(-2σ)',
      category: '주봉 볼밴 하단',
      enabled: Boolean(indConf.bb_weekly_lower),
      lineP: weekly?.lower,
      role: '주봉 메이저 지지선'
    }
  ];

  for (const c of checks) {
    if (!c.enabled || !c.lineP || c.lineP <= 0) continue;

    const lineP = Number(c.lineP);
    const dist = curP - lineP;
    const distPct = Math.abs(dist) / lineP * 100;

    // 1) 0.35% 이내 초근접 터치
    const isNearTouch = distPct <= 0.35;
    // 2) 직전가와 현재가 사이 라인 관통(Cross)
    const isCrossed = prevP > 0 && ((prevP - lineP) * (curP - lineP) <= 0);

    const isTouched = isNearTouch || isCrossed;
    const lastAlertTime = runtimeState.indicator_last_alerts[c.key] || 0;
    const isCooledDown = (nowSec - lastAlertTime) >= cooldownSec;

    // 상태 변화 추적 (이탈 후 재진입 시 쿨다운 무관하게 재발송 지원)
    const wasNear = runtimeState.indicator_last_states[c.key] === 'near';
    const isCurrentlyNear = distPct <= 0.8; // 0.8% 이내를 '근접 영역'으로 간주
    runtimeState.indicator_last_states[c.key] = isCurrentlyNear ? 'near' : 'away';

    if (isTouched) {
      if (isCooledDown || (!wasNear && isCurrentlyNear)) {
        runtimeState.indicator_last_alerts[c.key] = nowSec;
        triggered.push({
          key: c.key,
          name: c.name,
          category: c.category,
          role: c.role,
          linePrice: lineP,
          currentPrice: curP,
          distPct: Number(distPct.toFixed(2)),
          diffUsd: Number(dist.toFixed(2)),
          touchType: isCrossed ? '돌파 관통 (Cross)' : '근접 터치 (Touch)',
          daily,
          weekly
        });
      }
    }
  }

  return triggered;
}

module.exports = {
  fetchCandleCloses,
  computeBands,
  getOrFetchIndicators,
  checkIndicatorTouches
};
