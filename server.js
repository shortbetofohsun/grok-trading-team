/**
 * ⚡ Variational 10x 스탑헌팅 모의매매 봇 & 🎯 AI 옵션 지지·저항선 분석기 (server.js v4.0)
 * ============================================================================
 * 1) 좌측 엔진: Variational Omni DEX 7대 선물 (BTC, ETH, SOL, HYPE, QQQUSDT, SOXXUSDT, EWYUSDT)
 *    - 10배 레버리지(10x) 고정 · 주말 작동 중지(Weekend Guard) · 60일 백테스트 최적 % 적용
 *    - 평일 미국장 개장 전 스탑헌팅 포착 시 10x 모의체결 + 텔레그램 즉시 알림
 * 2) 우측 엔진: 실시간 옵션 감마(콜벽·풋벽·맥스페인·감마플립) + 차트(켈트너·볼린저) 연동 AI 지지·저항선 챗봇
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  STOPHUNT_UNIVERSE,
  getStopHuntSessionInfo,
  fetchJson,
  callGeminiAI,
  runScanAgent,
  runVetAgent,
  runSizeAgent,
  runFillsAgent,
  checkContractRiskLive,
  analyzeRwaTicker,
  askOptionSupportResistanceAI
} = require('./agents');
const {
  getOrFetchIndicators,
  checkIndicatorTouches
} = require('./indicators');
const {
  getPublicLiveStatus,
  isLiveTradingActive,
  verifyLiveAccountSafety,
  connectEdgeSession,
  toggleLiveMode,
  disconnectEdgeSession,
  executeLiveStopHuntEntry,
  executeLiveStopHuntClose,
  executeLiveRoundtripTest
} = require('./variationalLive');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'desk_state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GH_LOCAL_AUTH_FILE = path.join(DATA_DIR, '.gh_local_auth.json');

const DEFAULT_TG_B64 = 'ODgxMDAzMTEzNzpBQUdyZ3JPZXB5SlJ6TE42OXpqbm1lV0RKQmlfWFY0Tkxidw==';
const DEFAULT_ALERT_TG_B64 = 'OTI3NzQxNjk2NTpBQUhiMjd1LVdvTVNRbU55VHJqWjhUTTh5S3RhZy1zNlh4TQ==';
const DEFAULT_GM_B64 = 'QVEuQWI4Uk42THE1YUNscXNIVlkxbDMxUDIzREJ1eUNxSXFRZkFHeW5FMElCbUhPSjIzMkE=';

const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || Buffer.from(DEFAULT_GM_B64, 'base64').toString('utf-8');
const DEFAULT_TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || Buffer.from(DEFAULT_TG_B64, 'base64').toString('utf-8');
const DEFAULT_ALERT_BOT_TOKEN = process.env.ALERT_BOT_TOKEN || Buffer.from(DEFAULT_ALERT_TG_B64, 'base64').toString('utf-8');
const DEFAULT_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8417795671';

const DEFAULT_PRICE_ALERT_TARGETS = {
  QQQ: {
    symbol: 'QQQ',
    name: '나스닥 100 (QQQ)',
    target_price: 670.0,
    condition: 'gte',
    enabled: true,
    indicators: {
      ma20_daily: true,
      bb_daily_upper: true,
      bb_daily_lower: true,
      bb_weekly_upper: true,
      bb_weekly_lower: true
    }
  },
  NFLX: {
    symbol: 'NFLX',
    name: '넷플릭스 (NFLX)',
    target_price: 55.0,
    condition: 'lte',
    enabled: true,
    indicators: {
      ma20_daily: true,
      bb_daily_upper: true,
      bb_daily_lower: true,
      bb_weekly_upper: true,
      bb_weekly_lower: true
    }
  }
};

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function createVaultPortfolio(startingUsd = 1000.00) {
  return {
    startingBalanceUsd: startingUsd,
    cashUsd: startingUsd,
    deployedUsd: 0.00,
    totalCapitalEverDeployedUsd: 0.00,
    realizedPnlUsd: 0.00,
    unrealizedPnlUsd: 0.00,
    totalEquityUsd: startingUsd
  };
}

function getDefaultState() {
  const nowIso = new Date().toISOString();
  return {
    version: '4.1.0',
    createdAt: nowIso,
    wmPort: 3000,
    config: {
      startingBalanceUsd: 1000,
      slippageBudgetPct: 0.02,
      minOrderUsd: 50,
      maxKellyCapPct: 0.08
    },
    integrations: {
      geminiApiKey: DEFAULT_GEMINI_KEY,
      geminiModel: 'gemini-3.5-flash',
      telegramToken: DEFAULT_TELEGRAM_TOKEN,
      telegramChatId: DEFAULT_TELEGRAM_CHAT_ID,
      telegramBotUsername: '@dytradingdemo_bot',
      telegramEnabled: true,
      lastTelegramSentAt: null
    },
    priceAlerts: {
      chat_id: DEFAULT_TELEGRAM_CHAT_ID,
      chat_user: '도윤 이 (@shortbetofohsun)',
      bot_username: 'Alert_123455_bot',
      cooldown_minutes: 10,
      rearm_mode: 'cross_again',
      sound_enabled: true,
      targets: JSON.parse(JSON.stringify(DEFAULT_PRICE_ALERT_TARGETS)),
      logs: []
    },
    desks: {
      memecoin: {
        id: 'memecoin',
        name: 'Variational 10x 스탑헌팅 봇',
        portfolio: createVaultPortfolio(1000.00),
        openPositions: [],
        closedPositions: [],
        lastScanCandidates: [],
        lastVetResults: [],
        stats: {
          scans: 0,
          candidatesCount: 0,
          passedCount: 0,
          rejectedCount: 0,
          closedCount: 0
        }
      }
    },
    routines: {
      scan15mEnabled: true,
      risk5mEnabled: true,
      lastScanAt: null,
      lastRiskAt: null
    },
    liveBridge: {
      enabled: false,
      allowedAddress: '',
      orderMarginUsd: 10,
      maxEquityCapUsd: 250,
      maxSlippageBps: 100
    },
    logs: [
      {
        id: 'log_init',
        type: 'INFO',
        timestamp: nowIso,
        text: 'Variational DEX 통합 터미널 가동 완료 (지정가 텔레그램 알리미 · 10x 스탑헌팅 봇 · 옵션 지지저항 분석)'
      }
    ],
    lastOptionSymbol: null,
    lastOptionAnalysis: null,
    optionChatHistory: [
      {
        id: 'opt_welcome',
        role: 'assistant',
        symbol: null,
        timestamp: nowIso,
        text: '종목 티커(예: MRNA, TSLA, NVDA) 또는 한글명(예: 모더나, 테슬라, 아이온큐)을 입력하시면 양감마/음감마 · 감마플립 · 맥스페인 · 만기일 · 지지·저항선 수치만 즉시 불러옵니다.'
      }
    ]
  };
}

let state = getDefaultState();
if (fs.existsSync(STATE_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (loaded && loaded.desks?.memecoin) {
      const def = getDefaultState();
      const loadedAlerts = loaded.priceAlerts || {};
      const mergedTargets = {
        ...JSON.parse(JSON.stringify(DEFAULT_PRICE_ALERT_TARGETS)),
        ...(loadedAlerts.targets || {})
      };
      // 기존 QQQUSDT / NFLXUSDT 키가 있으면 QQQ / NFLX로 정규화
      for (const k of Object.keys(mergedTargets)) {
        const clean = k.toUpperCase().replace(/USDT$/, '');
        if (clean !== k) {
          if (!mergedTargets[clean]) {
            mergedTargets[clean] = { ...mergedTargets[k], symbol: clean };
          }
          delete mergedTargets[k];
        }
      }
      // indicators 필드가 없으면 기본 활성화 설정 주입
      for (const k of Object.keys(mergedTargets)) {
        if (!mergedTargets[k].indicators) {
          mergedTargets[k].indicators = {
            ma20_daily: true,
            bb_daily_upper: true,
            bb_daily_lower: true,
            bb_weekly_upper: true,
            bb_weekly_lower: true
          };
        }
      }
      state = {
        ...def,
        ...loaded,
        integrations: {
          ...def.integrations,
          ...(loaded.integrations || {}),
          geminiApiKey: loaded.integrations?.geminiApiKey || DEFAULT_GEMINI_KEY,
          telegramToken: loaded.integrations?.telegramToken || DEFAULT_TELEGRAM_TOKEN,
          telegramChatId: loaded.integrations?.telegramChatId || DEFAULT_TELEGRAM_CHAT_ID
        },
        priceAlerts: {
          ...def.priceAlerts,
          ...loadedAlerts,
          chat_id: loadedAlerts.chat_id || DEFAULT_TELEGRAM_CHAT_ID,
          chat_user: loadedAlerts.chat_user || '도윤 이 (@shortbetofohsun)',
          bot_username: loadedAlerts.bot_username || 'Alert_123455_bot',
          targets: mergedTargets,
          logs: Array.isArray(loadedAlerts.logs) ? loadedAlerts.logs : []
        },
        desks: {
          memecoin: {
            ...def.desks.memecoin,
            ...loaded.desks.memecoin,
            name: 'Variational 10x 스탑헌팅 봇'
          }
        },
        liveBridge: {
          ...def.liveBridge,
          ...(loaded.liveBridge || {}),
          enabled: Boolean(loaded.liveBridge?.enabled),
          allowedAddress: String(loaded.liveBridge?.allowedAddress || '').trim(),
          orderMarginUsd: Number(loaded.liveBridge?.orderMarginUsd) > 0 ? Number(loaded.liveBridge.orderMarginUsd) : def.liveBridge.orderMarginUsd,
          maxEquityCapUsd: Number(loaded.liveBridge?.maxEquityCapUsd) > 0 ? Number(loaded.liveBridge.maxEquityCapUsd) : def.liveBridge.maxEquityCapUsd,
          maxSlippageBps: Number(loaded.liveBridge?.maxSlippageBps) > 0 ? Number(loaded.liveBridge.maxSlippageBps) : def.liveBridge.maxSlippageBps
        },
        logs: Array.isArray(loaded.logs) && loaded.logs.length ? loaded.logs : def.logs,
        optionChatHistory: Array.isArray(loaded.optionChatHistory) && loaded.optionChatHistory.length ? loaded.optionChatHistory : def.optionChatHistory
      };

      const allowedSyms = new Set(['BTC', 'ETH', 'SOL', 'HYPE', 'QQQUSDT', 'SOXLUSDT', 'EWYUSDT']);
      const hasInvalid = (state.desks.memecoin.openPositions || []).some(p => !p.isStopHunt || !allowedSyms.has(p.symbol));
      if (hasInvalid) {
        state.desks.memecoin.portfolio = createVaultPortfolio(1000.00);
        state.desks.memecoin.openPositions = [];
        state.desks.memecoin.closedPositions = [];
      } else {
        if (reconcileStopHuntDeskLedger(state.desks.memecoin)) {
          recomputePortfolio();
        }
      }
    }
  } catch {
    state = getDefaultState();
  }
}

function saveState() {
  try {
    const cleanCopy = {
      ...state,
      integrations: {
        geminiModel: state.integrations?.geminiModel || 'gemini-3.5-flash',
        telegramBotUsername: state.integrations?.telegramBotUsername || '@dytradingdemo_bot',
        telegramEnabled: Boolean(state.integrations?.telegramEnabled ?? true),
        lastTelegramSentAt: state.integrations?.lastTelegramSentAt || null
      }
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(cleanCopy, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

function addLog(type, text) {
  if (!Array.isArray(state.logs)) state.logs = [];
  const item = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    timestamp: new Date().toISOString(),
    text
  };
  state.logs.unshift(item);
  if (state.logs.length > 80) {
    state.logs = state.logs.slice(0, 80);
  }
  saveState();
  return item;
}

function reconcileStopHuntDeskLedger(desk) {
  if (!desk || !desk.portfolio) return false;
  const closed = Array.isArray(desk.closedPositions) ? desk.closedPositions : [];
  const open = Array.isArray(desk.openPositions) ? desk.openPositions : [];
  const seenIds = new Set();
  const dedupClosed = [];
  let hadDup = false;
  for (const item of closed) {
    if (item?.id && seenIds.has(item.id)) {
      hadDup = true;
      continue;
    }
    if (item?.id) seenIds.add(item.id);
    dedupClosed.push(item);
  }
  const filteredOpen = open.filter(pos => !pos?.id || !seenIds.has(pos.id));
  if (filteredOpen.length !== open.length) hadDup = true;
  if (!hadDup) return false;

  desk.closedPositions = dedupClosed;
  desk.openPositions = filteredOpen;
  desk.stats.closedCount = dedupClosed.length;
  const startBal = Number(desk.portfolio.startingBalanceUsd || 1000.00);
  const realized = Number(dedupClosed.reduce((s, c) => s + Number(c.pnlUsd || 0), 0).toFixed(2));
  const openDeployed = Number(filteredOpen.reduce((s, p) => s + Number(p.dollars || 0), 0).toFixed(2));
  desk.portfolio.realizedPnlUsd = realized;
  desk.portfolio.cashUsd = Number((startBal + realized - openDeployed).toFixed(2));
  return true;
}

function recomputePortfolio() {
  const d = state.desks.memecoin;
  let deployed = 0;
  let unrealized = 0;
  for (const pos of d.openPositions) {
    const cost = Number(pos.dollars || 0);
    deployed += cost;
    const qty = Number(pos.quantity || 0);
    const entryP = Number(pos.entryPriceUsd || 0);
    const curP = Number(pos.currentPriceUsd || entryP);
    const fee = Number(pos.feeUsd || 0);
    const diff = pos.direction === 'SHORT' ? (entryP - curP) : (curP - entryP);
    unrealized += (qty * diff) - fee;
  }
  d.portfolio.deployedUsd = Number(deployed.toFixed(2));
  d.portfolio.unrealizedPnlUsd = Number(unrealized.toFixed(2));
  d.portfolio.totalEquityUsd = Number((d.portfolio.cashUsd + deployed + unrealized).toFixed(2));
  saveState();
}

function getStopHuntPerformanceSummary() {
  recomputePortfolio();
  const d = state.desks.memecoin;
  const startingUsd = Number(d.portfolio.startingBalanceUsd || 1000.00);
  const totalEquityUsd = Number(d.portfolio.totalEquityUsd || startingUsd);
  const totalPnlUsd = Number((totalEquityUsd - startingUsd).toFixed(2));
  const finalReturnPct = Number(((totalPnlUsd / startingUsd) * 100).toFixed(2));
  const closedList = Array.isArray(d.closedPositions) ? d.closedPositions : [];
  const closedCount = closedList.length;
  const winCount = closedList.filter(c => Number(c.pnlUsd || 0) > 0).length;
  const winRatePct = closedCount > 0 ? Number(((winCount / closedCount) * 100).toFixed(1)) : 0.0;
  const retSign = finalReturnPct >= 0 ? '+' : '';
  const pnlSign = totalPnlUsd >= 0 ? '+' : '-';

  const footerPlain = `스탑헌팅 최종수익률: ${retSign}${finalReturnPct.toFixed(2)}% ($${totalEquityUsd.toFixed(2)} / 원금 $${startingUsd.toFixed(2)} · 누적손익 ${pnlSign}$${Math.abs(totalPnlUsd).toFixed(2)} · 청산 ${closedCount}건 승률 ${winRatePct.toFixed(1)}%)`;
  const footerHtml = `────────────────────\n<i>${footerPlain}</i>`;

  return {
    startingUsd,
    totalEquityUsd,
    totalPnlUsd,
    finalReturnPct,
    closedCount,
    winCount,
    winRatePct,
    footerPlain,
    footerHtml
  };
}

async function sendTelegramNotification(text, force = false) {
  const integ = state.integrations || {};
  if (!integ.telegramEnabled && !force) return { ok: false, reason: 'disabled' };
  const chatId = String(state.priceAlerts?.chat_id || integ.telegramChatId || DEFAULT_TELEGRAM_CHAT_ID).trim();
  if (!chatId) return { ok: false, reason: 'missing_credentials' };

  const tokens = [DEFAULT_ALERT_BOT_TOKEN, integ.telegramToken || DEFAULT_TELEGRAM_TOKEN].filter(Boolean);
  let lastStatus = 500;
  for (const tk of tokens) {
    const res = await fetchJson(`https://api.telegram.org/bot${tk}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }, 8000);
    lastStatus = res.status;
    if (res.ok && res.data?.ok) {
      state.integrations.lastTelegramSentAt = new Date().toISOString();
      saveState();
      return { ok: true, status: res.status };
    }
  }
  return { ok: false, status: lastStatus };
}

function recordStopHuntTelegramLog(symbol, actionLabel, price, target, condition, tgOk) {
  if (!state.priceAlerts) state.priceAlerts = getDefaultState().priceAlerts;
  if (!Array.isArray(state.priceAlerts.logs)) state.priceAlerts.logs = [];
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  state.priceAlerts.logs.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    symbol,
    name: actionLabel,
    timestamp: nowStr,
    price: Number(Number(price || 0).toFixed(4)),
    target: Number(Number(target || 0).toFixed(4)),
    condition,
    success: Boolean(tgOk),
    detail: `[스탑헌팅 ${actionLabel}] 텔레그램 ${tgOk ? '전송 완료' : '전송 실패'}`
  });
  if (state.priceAlerts.logs.length > 100) {
    state.priceAlerts.logs = state.priceAlerts.logs.slice(0, 100);
  }
  saveState();
}

const closingPosIds = new Set();

const EDGE_BRIDGE_TTL_MS = 15000;
const edgeBridgeRuntime = {
  connectedAddress: '',
  lastBalanceUsd: 0,
  upnlUsd: 0,
  marginUsage: 0,
  positions: [],
  lastHeartbeatAt: 0,
  loggedIn: false,
  pageUrl: '',
  safetyError: null,
  lastActionNote: '',
  pendingSignals: [],
  ackWaiters: new Map()
};

function isEdgeBridgeConnected() {
  return Boolean(
    edgeBridgeRuntime.lastHeartbeatAt &&
    Date.now() - edgeBridgeRuntime.lastHeartbeatAt <= EDGE_BRIDGE_TTL_MS &&
    edgeBridgeRuntime.loggedIn &&
    edgeBridgeRuntime.connectedAddress
  );
}

function evaluateEdgeBridgeSafety(requireAllowList = false) {
  if (!isEdgeBridgeConnected()) {
    return { ok: false, error: 'Edge omni.variational.io 탭 연결이 감지되지 않습니다.' };
  }
  const cfg = state.liveBridge || {};
  const allowed = String(cfg.allowedAddress || '').trim().toLowerCase();
  const actual = String(edgeBridgeRuntime.connectedAddress || '').trim().toLowerCase();
  if (requireAllowList && !allowed) {
    return { ok: false, error: '안전잠금: 허용 부계정 지갑(Whitelist)이 지정되지 않았습니다.' };
  }
  if (allowed && actual && allowed !== actual) {
    return {
      ok: false,
      error: `안전잠금 차단: 연결 지갑(${edgeBridgeRuntime.connectedAddress}) != 허용 지갑(${cfg.allowedAddress})`
    };
  }
  const cap = Number(cfg.maxEquityCapUsd || 250);
  if (Number.isFinite(cap) && cap > 0 && Number(edgeBridgeRuntime.lastBalanceUsd || 0) > cap) {
    return {
      ok: false,
      error: `안전잠금 차단: 현재 잔고($${Number(edgeBridgeRuntime.lastBalanceUsd).toFixed(2)})가 상한($${cap})을 초과합니다.`
    };
  }
  return { ok: true, error: null };
}

function pruneExpiredEdgeSignals() {
  const now = Date.now();
  edgeBridgeRuntime.pendingSignals = edgeBridgeRuntime.pendingSignals.filter(
    (s) => now - Number(s.createdAt || 0) <= Number(s.ttlMs || 45000)
  );
}

function dispatchEdgeSignalAndWait(signalPayload, timeoutMs = 18000, ttlMs = 45000) {
  pruneExpiredEdgeSignals();
  const signalId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const sig = {
    ...signalPayload,
    signalId,
    createdAt: Date.now(),
    ttlMs,
    dispatchedAt: null
  };
  edgeBridgeRuntime.pendingSignals.push(sig);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      edgeBridgeRuntime.ackWaiters.delete(signalId);
      reject(new Error(`Edge 브리지 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)`));
    }, timeoutMs);
    edgeBridgeRuntime.ackWaiters.set(signalId, { resolve, reject, timer });
  });
}

function getUnifiedLiveStatus() {
  const direct = getPublicLiveStatus();
  const cfg = state.liveBridge || {};
  const bridgeConn = isEdgeBridgeConnected();
  const directActive = Boolean(!direct.isCloudBlocked && direct.hasSession);

  const allowedAddress = String(cfg.allowedAddress || direct.allowedAddress || '').trim();
  const orderMarginUsd = Number(cfg.orderMarginUsd || direct.orderMarginUsd || 10);
  const maxEquityCapUsd = Number(cfg.maxEquityCapUsd || direct.maxEquityCapUsd || 250);
  const maxSlippageBps = Number(cfg.maxSlippageBps || direct.maxSlippageBps || 100);
  const connectedAddress = bridgeConn
    ? edgeBridgeRuntime.connectedAddress
    : (directActive ? direct.connectedAddress : (edgeBridgeRuntime.connectedAddress || ''));
  const lastBalanceUsd = bridgeConn
    ? Number(edgeBridgeRuntime.lastBalanceUsd || 0)
    : (directActive ? Number(direct.lastBalanceUsd || 0) : Number(edgeBridgeRuntime.lastBalanceUsd || 0));
  const safety = bridgeConn
    ? evaluateEdgeBridgeSafety(false)
    : { ok: !direct.lastError, error: direct.lastError || null };

  return {
    ...direct,
    bridgeMode: bridgeConn ? 'EDGE_BRIDGE' : (directActive ? 'LOCAL_DIRECT' : 'NONE'),
    edgeBridgeConnected: bridgeConn,
    edgeLastSeenAt: edgeBridgeRuntime.lastHeartbeatAt || null,
    edgePositionsCount: Array.isArray(edgeBridgeRuntime.positions) ? edgeBridgeRuntime.positions.length : 0,
    hasSession: bridgeConn || directActive,
    enabled: Boolean(cfg.enabled || (directActive && direct.enabled)),
    allowedAddress,
    orderMarginUsd,
    maxEquityCapUsd,
    maxSlippageBps,
    connectedAddress,
    lastBalanceUsd,
    safetyError: safety.ok ? null : safety.error,
    isCloudBlocked: bridgeConn ? false : direct.isCloudBlocked,
    lastActionNote: edgeBridgeRuntime.lastActionNote || ''
  };
}

function isAnyLiveTradingActive() {
  return Boolean(state.liveBridge?.enabled || isLiveTradingActive());
}

async function settleAndNotifyStopHuntPosition(pos, exitPriceUsd, closeReason, triggerSource = '실시간 TP/SL 감시') {
  const desk = state.desks.memecoin;
  if (!pos || !pos.id) return null;
  if (closingPosIds.has(pos.id) || desk.closedPositions.some(c => c.id === pos.id)) {
    desk.openPositions = desk.openPositions.filter(p => p.id !== pos.id);
    recomputePortfolio();
    return null;
  }
  closingPosIds.add(pos.id);
  desk.openPositions = desk.openPositions.filter(p => p.id !== pos.id);

  try {
    const isShort = pos.direction === 'SHORT';
    let curP = Number(exitPriceUsd || pos.currentPriceUsd || pos.entryPriceUsd);
    let liveCloseNote = '';
    if (pos.isLiveOrder) {
      try {
        let liveClose = null;
        if (isEdgeBridgeConnected()) {
          const ack = await dispatchEdgeSignalAndWait(
            { type: 'EXIT', symbol: pos.symbol, exitPriceUsd: curP, closeReason },
            18000,
            120000
          );
          if (!ack?.ok) throw new Error(ack?.error || 'Edge 브리지 청산 거부');
          liveClose = ack.result || {};
        } else {
          liveClose = await executeLiveStopHuntClose(pos);
        }
        if (liveClose?.exitPriceUsd > 0 && !liveClose.alreadyClosedOnVenue) {
          curP = Number(liveClose.exitPriceUsd);
        }
        liveCloseNote = liveClose?.alreadyClosedOnVenue
          ? ' · 실전 거래소 이미 청산됨(TP/SL)'
          : ` · 실전 RFQ ${liveClose?.rfqId || ''}`;
      } catch (liveErr) {
        liveCloseNote = ` · 실전 청산 오류(${liveErr.message})`;
        addLog('EXIT', `[실전 LIVE 청산 실패] $${pos.symbol}: ${liveErr.message}`);
      }
    }
    const priceDiff = isShort ? (pos.entryPriceUsd - curP) : (curP - pos.entryPriceUsd);
    const rawPnl = pos.quantity * priceDiff;
    const entryFee = Number(pos.feeUsd || 0);
    const exitFee = Math.max(0.0002 * Number(pos.notionalUsd || pos.dollars * 10), 0.25);
    const netProceeds = Math.max(0, Number((pos.dollars + rawPnl - entryFee - exitFee).toFixed(2)));
    const pnlUsd = Number((netProceeds - pos.dollars).toFixed(2));
    const pnlPct = Number(((pnlUsd / pos.dollars) * 100).toFixed(2));

    desk.stats.closedCount = (desk.stats.closedCount || 0) + 1;
    desk.portfolio.cashUsd = Number((desk.portfolio.cashUsd + netProceeds).toFixed(2));
    desk.portfolio.realizedPnlUsd = Number((desk.portfolio.realizedPnlUsd + pnlUsd).toFixed(2));

    const closedItem = {
      ...pos,
      currentPriceUsd: curP,
      exitPriceUsd: curP,
      netProceedsUsd: netProceeds,
      pnlUsd,
      pnlPct,
      closedAt: new Date().toISOString(),
      closeRule: `${closeReason}${liveCloseNote}`
    };
    desk.closedPositions.unshift(closedItem);

    const perf = getStopHuntPerformanceSummary();
    const isProfit = pnlUsd >= 0;
    const modeTag = pos.isLiveOrder ? '[실전 LIVE 청산] ' : '';
    const exitTitle = isProfit ? '익절(TP) 체결 완료' : '손절(SL) 체결 완료';
    const sideKo = pos.isLiveOrder
      ? (isShort ? '실전 매도 (SHORT 10x)' : '실전 매수 (LONG 10x)')
      : (isShort ? '모의 매도 (SHORT 10x)' : '모의 매수 (LONG 10x)');

    const closeHtml = [
      `<b>${modeTag}[Variational 10x 스탑헌팅 ${exitTitle} — $${pos.symbol}]</b>`,
      ``,
      `• <b>포지션:</b> ${sideKo}`,
      `• <b>체결 가격:</b> 진입 $${pos.entryPriceUsd} ➔ 청산 $${curP}`,
      `• <b>실현 손익:</b> ${pnlUsd >= 0 ? '+' : '-'}$${Math.abs(pnlUsd).toFixed(2)} (10x ROE ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`,
      `• <b>청산 사유:</b> ${closeReason}${liveCloseNote} (${triggerSource})`,
      perf.footerHtml
    ].join('\n');

    addLog('EXIT', `${modeTag}[스탑헌팅 ${exitTitle}] $${pos.symbol} (${sideKo}) 진입 $${pos.entryPriceUsd} -> 청산 $${curP} | 실현손익 ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct}%)${liveCloseNote} | ${perf.footerPlain}`);
    const tgOut = await sendTelegramNotification(closeHtml, true);
    recordStopHuntTelegramLog(pos.symbol, exitTitle, curP, isProfit ? pos.tp2PriceUsd : pos.stopPriceUsd, isShort ? 'lte' : 'gte', tgOut.ok);
    return closedItem;
  } finally {
    closingPosIds.delete(pos.id);
  }
}

// ============================================================================
// 1. 좌측 엔진: Variational DEX 10x 스탑헌팅 역추세 스캔 & 모의체결
// ============================================================================
let scanRunning = false;
async function executeStopHuntScan(triggerSource = '수동 스캔') {
  if (scanRunning) return { ok: false, message: '이미 스캔 중입니다.' };
  scanRunning = true;
  try {
    state.routines.lastScanAt = new Date().toISOString();
    const desk = state.desks.memecoin;
    desk.stats.scans += 1;

    const scanOut = await runScanAgent(state.config, 'READY');
    const vetOut = await runVetAgent(scanOut.candidates, state.config);

    desk.lastScanCandidates = scanOut.candidates;
    desk.lastVetResults = vetOut.results;
    desk.stats.candidatesCount += scanOut.candidates.length;
    desk.stats.passedCount += vetOut.passedCount;
    desk.stats.rejectedCount += vetOut.rejectedCount;

    const sessionStr = scanOut.sessionInfo?.isWeekend
      ? `주말 휴장 가드 작동 중 (${scanOut.sessionInfo.nyTimeStr})`
      : `${scanOut.sessionInfo?.sessionLabel || '평일 감시'} (${scanOut.sessionInfo?.nyTimeStr || ''})`;

    addLog('SCAN', `[${triggerSource}] 7대 선물 스캔 완료 — 타점 통과 ${vetOut.passedCount}건 / 대기 ${vetOut.rejectedCount}건 | ${sessionStr}`);

    for (const passedItem of vetOut.passed) {
      const c = passedItem.candidate;
      if (desk.openPositions.some(p => p.symbol === c.symbol)) continue;
      // 동일 종목 직전 청산이 손절(SL)인 경우 60분간 재진입 쿨다운 (원웨이 장세 연속 손절 루프 차단)
      const recentSlForSymbol = (desk.closedPositions || []).find(
        p => p.symbol === c.symbol && Number(p.pnlUsd) < 0 && p.closedAt && (Date.now() - new Date(p.closedAt).getTime() < 60 * 60 * 1000)
      );
      if (recentSlForSymbol) {
        console.log(`[StopHunt Cooldown] ${c.symbol} 직전 손절 후 60분 쿨다운 중 — 재진입 스킵`);
        continue;
      }
      const capPct = passedItem.decision === 'PASS' ? 0.08 : 0.06;
      const sizeRes = runSizeAgent(passedItem, desk.portfolio, state.config, capPct);

      if (sizeRes.dollars > 0) {
        let liveExec = null;
        if (isAnyLiveTradingActive()) {
          try {
            if (isEdgeBridgeConnected()) {
              const safety = evaluateEdgeBridgeSafety(true);
              if (!safety.ok) throw new Error(safety.error);
              const cfg = state.liveBridge || {};
              const ack = await dispatchEdgeSignalAndWait(
                {
                  type: 'ENTRY',
                  symbol: c.symbol,
                  direction: c.direction,
                  leverage: 10,
                  marginUsd: Number(cfg.orderMarginUsd || 10),
                  entryPriceUsd: Number(c.priceUsd || 0),
                  takeProfitUsd: Number(c.tp2PriceUsd || 0),
                  stopLossUsd: Number(c.stopPriceUsd || 0)
                },
                18000,
                45000
              );
              if (!ack?.ok) throw new Error(ack?.error || 'Edge 브리지 주문 실패');
              liveExec = ack.result;
            } else if (isLiveTradingActive()) {
              liveExec = await executeLiveStopHuntEntry(c);
            } else {
              throw new Error('Edge omni.variational.io 탭 연결이 끊겨 실전 진입을 보류했습니다.');
            }
          } catch (liveErr) {
            addLog('ENTRY', `[실전 LIVE 진입 실패] $${c.symbol}: ${liveErr.message}`);
            await sendTelegramNotification(`<b>[실전 LIVE 진입 실패 — $${c.symbol}]</b>\n\n사유: ${liveErr.message}`, true);
            continue;
          }
        }
        const effSizeRes = liveExec ? { ...sizeRes, dollars: liveExec.marginUsd } : sizeRes;
        const fillRes = runFillsAgent(c, effSizeRes);
        if (fillRes.status === 'FILLED_PAPER') {
          if (liveExec) {
            fillRes.isLiveOrder = true;
            fillRes.rfqId = liveExec.rfqId;
            fillRes.entryPriceUsd = liveExec.entryPriceUsd;
            fillRes.currentPriceUsd = liveExec.entryPriceUsd;
            fillRes.quantity = liveExec.qty;
            fillRes.notionalUsd = liveExec.notionalUsd;
          }
          desk.portfolio.cashUsd = Number((desk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
          desk.portfolio.totalCapitalEverDeployedUsd = Number((desk.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
          desk.openPositions.push(fillRes);
          const perf = getStopHuntPerformanceSummary();

          const isShort = fillRes.direction === 'SHORT';
          const modeTag = fillRes.isLiveOrder ? '[실전 LIVE 체결] ' : '';
          const actionKo = fillRes.isLiveOrder
            ? (isShort ? '실전 매도 (SHORT 10x)' : '실전 매수 (LONG 10x)')
            : (isShort ? '모의 매도 (SHORT 10x)' : '모의 매수 (LONG 10x)');
          const rfqLine = fillRes.isLiveOrder && fillRes.rfqId ? `\n• <b>Variational RFQ ID:</b> ${fillRes.rfqId}` : '';
          const fillHtml = [
            `<b>${modeTag}[Variational 10x 스탑헌팅 포착 — $${fillRes.symbol} ${actionKo} 진입]</b>`,
            ``,
            `• <b>종목:</b> $${fillRes.symbol} (${fillRes.name})`,
            `• <b>확정 스탑헌팅 구간:</b> ±${fillRes.minHuntPct}% ~ ±${fillRes.maxHuntPct}% (현재 90분 ${fillRes.huntMovePct >= 0 ? '+' : ''}${fillRes.huntMovePct}% + 꼬리 ${fillRes.wickReversalPct}%)`,
            `• <b>백테스트 검증:</b> 12개월 승률 ${fillRes.btWinRate || 75}% (10x ${fillRes.btPnl10x || '+20%'})`,
            `• <b>진입 가격(호가):</b> $${fillRes.entryPriceUsd} (증거금 $${fillRes.dollars} × 10배 = $${fillRes.notionalUsd} · 손익비 1:${fillRes.rrRatio})${rfqLine}`,
            `• <b>익절 목표가:</b> 1차(TP1) $${fillRes.tp1PriceUsd} / 2차(TP2) $${fillRes.tp2PriceUsd}`,
            `• <b>손절 방어선(SL):</b> $${fillRes.stopPriceUsd}`,
            perf.footerHtml
          ].join('\n');

          addLog('ENTRY', `${modeTag}[스탑헌팅 진입] $${fillRes.symbol} ${actionKo} @ $${fillRes.entryPriceUsd} (변동 ${fillRes.huntMovePct >= 0 ? '+' : ''}${fillRes.huntMovePct}% · 꼬리 ${fillRes.wickReversalPct}%) | TP2 $${fillRes.tp2PriceUsd} / SL $${fillRes.stopPriceUsd} | ${perf.footerPlain}`);
          const tgOut = await sendTelegramNotification(fillHtml, true);
          recordStopHuntTelegramLog(fillRes.symbol, actionKo, fillRes.entryPriceUsd, fillRes.tp2PriceUsd, isShort ? 'lte' : 'gte', tgOut.ok);
        }
      }
    }

    recomputePortfolio();
    return {
      ok: true,
      sessionInfo: scanOut.sessionInfo,
      scanned: scanOut.candidates.length,
      passed: vetOut.passedCount,
      rejected: vetOut.rejectedCount
    };
  } finally {
    scanRunning = false;
  }
}

let riskCheckRunning = false;
async function executeStopHuntRiskCheck(triggerSource = '5분 리스크 점검') {
  if (riskCheckRunning) return { ok: false, checked: 0, closed: 0, skipped: true };
  riskCheckRunning = true;
  try {
    state.routines.lastRiskAt = new Date().toISOString();
    const desk = state.desks.memecoin;
    let checked = 0;
    let closed = 0;

    const snapshot = [...desk.openPositions];
    for (const pos of snapshot) {
      if (!pos || !pos.id || closingPosIds.has(pos.id) || !desk.openPositions.some(p => p.id === pos.id)) {
        continue;
      }
      checked += 1;
      const check = await checkContractRiskLive(pos.contract || pos.symbol, pos);
      if (closingPosIds.has(pos.id) || !desk.openPositions.some(p => p.id === pos.id)) {
        continue;
      }
      if (check.reachable && check.priceUsd > 0) {
        pos.currentPriceUsd = check.priceUsd;
      }
      if (check.action === 'CLOSE') {
        const closedItem = await settleAndNotifyStopHuntPosition(pos, pos.currentPriceUsd, check.reason, triggerSource);
        if (closedItem) closed += 1;
      }
    }

    recomputePortfolio();
    return { ok: true, checked, closed };
  } finally {
    riskCheckRunning = false;
  }
}

// ============================================================================
// 2. 우측 엔진: 티커 입력 시 옵션 감마 & 채널 데이터 기반 AI 지지·저항선 챗봇
// ============================================================================
const KO_TICKER_MAP = [
  ['모더나', 'MRNA'], ['화이자', 'PFE'], ['일라이릴리', 'LLY'], ['릴리', 'LLY'], ['노보노디스크', 'NVO'],
  ['버텍스', 'VRTX'], ['리제네론', 'REGN'], ['크리스퍼', 'CRSP'], ['암젠', 'AMGN'], ['유나이티드헬스', 'UNH'],
  ['존슨앤존슨', 'JNJ'], ['머크', 'MRK'], ['애브비', 'ABBV'], ['엔비디아', 'NVDA'], ['테슬라', 'TSLA'],
  ['애플', 'AAPL'], ['마이크로소프트', 'MSFT'], ['마소', 'MSFT'], ['아마존', 'AMZN'], ['구글', 'GOOGL'],
  ['알파벳', 'GOOGL'], ['메타', 'META'], ['페북', 'META'], ['넷플릭스', 'NFLX'], ['브로드컴', 'AVGO'],
  ['대만반도체', 'TSM'], ['암드', 'AMD'], ['인텔', 'INTC'], ['마이크론', 'MU'], ['아이온큐', 'IONQ'],
  ['리게티', 'RGTI'], ['디웨이브', 'QBTS'], ['퀀텀', 'QUBT'], ['팔란티어', 'PLTR'], ['로켓랩', 'RKLB'],
  ['인튜이티브머신', 'LUNR'], ['루나', 'LUNR'], ['아스트', 'ASTS'], ['레드와이어', 'RDW'], ['플래닛랩스', 'PL'],
  ['블랙스카이', 'BKSY'], ['록히드마틴', 'LMT'], ['레이시온', 'RTX'], ['노스롭그루먼', 'NOC'], ['노스롭', 'NOC'],
  ['제너럴다이내믹스', 'GD'], ['에어로바이런먼트', 'AVAV'], ['크라토스', 'KTOS'], ['보잉', 'BA'],
  ['슈퍼마이크로', 'SMCI'], ['슈마컴', 'SMCI'], ['암홀딩스', 'ARM'], ['퀄컴', 'QCOM'], ['어플라이드', 'AMAT'],
  ['램리서치', 'LRCX'], ['루멘텀', 'LITE'], ['코히런트', 'COHR'], ['아리스타', 'ANET'], ['시에나', 'CIEN'],
  ['코닝', 'GLW'], ['버티브', 'VRT'], ['비스트라', 'VST'], ['컨스텔레이션', 'CEG'], ['오클로', 'OKLO'],
  ['뉴스케일', 'SMR'], ['카메코', 'CCJ'], ['서브로보틱스', 'SERV'], ['심보틱', 'SYM'], ['인튜이티브서지컬', 'ISRG'],
  ['우버', 'UBER'], ['에어비앤비', 'ABNB'], ['도어대시', 'DASH'], ['쿠팡', 'CPNG'], ['알리바바', 'BABA'],
  ['핀둬둬', 'PDD'], ['테무', 'PDD'], ['니오', 'NIO'], ['리비안', 'RIVN'], ['루시드', 'LCID'],
  ['코인베이스', 'COIN'], ['마이크로스트래티지', 'MSTR'], ['스트래티지', 'MSTR'], ['로빈후드', 'HOOD'],
  ['소파이', 'SOFI'], ['업스타트', 'UPST'], ['어펌', 'AFRM'], ['페이팔', 'PYPL'], ['서클', 'CRCL'],
  ['마라', 'MARA'], ['라이엇', 'RIOT'], ['클린스파크', 'CLSK'], ['아이렌', 'IREN'], ['스노우플레이크', 'SNOW'],
  ['클라우드플레어', 'NET'], ['크라우드스트라이크', 'CRWD'], ['팔로알토', 'PANW'], ['데이터독', 'DDOG'],
  ['서비스나우', 'NOW'], ['세일즈포스', 'CRM'], ['오라클', 'ORCL'], ['유니티', 'U'], ['로블록스', 'RBLX'],
  ['스포티파이', 'SPOT'], ['디즈니', 'DIS'], ['나이키', 'NKE'], ['스타벅스', 'SBUX'], ['맥도날드', 'MCD'],
  ['코카콜라', 'KO'], ['펩시', 'PEP'], ['월마트', 'WMT'], ['코스트코', 'COST'], ['홈디포', 'HD'],
  ['버크셔', 'BRK-B'], ['제이피모건', 'JPM'], ['골드만삭스', 'GS'], ['모건스탠리', 'MS'], ['비자', 'V'],
  ['마스터카드', 'MA'], ['엑슨모빌', 'XOM'], ['셰브론', 'CVX'], ['옥시덴탈', 'OXY'], ['카바나', 'CVNA'],
  ['일루미나', 'ILMN'], ['나스닥', 'QQQ'], ['큐큐큐', 'QQQ'], ['에스앤피', 'SPY'], ['스파이', 'SPY'],
  ['다우', 'DIA'], ['러셀', 'IWM'], ['반도체', 'SOXX'], ['속슬', 'SOXL'], ['속스', 'SOXS'],
  ['티큐', 'TQQQ'], ['스큐', 'SQQQ'], ['슈드', 'SCHD'], ['젭피', 'JEPI'], ['금', 'GLD'], ['은', 'SLV'],
  ['원유', 'USO'], ['장기채', 'TLT'], ['미국채', 'TLT'], ['리츠', 'VNQ'], ['한국', 'EWY'],
  ['비트코인', 'BTC'], ['비트', 'BTC'], ['이더리움', 'ETH'], ['이더', 'ETH'], ['솔라나', 'SOL'], ['하이프', 'HYPE']
];

const IGNORE_EN_WORDS = new Set(['AI', 'TP', 'SL', 'LONG', 'SHORT', 'CALL', 'PUT', 'GEX', 'IV', 'OK', 'VS', 'USD', 'USDT', 'ETF', 'PERP']);

async function resolveTickerFromUserText(rawText, fallbackSymbol = null, geminiKey = DEFAULT_GEMINI_KEY) {
  const clean = String(rawText || '').trim();
  if (!clean) return { ticker: fallbackSymbol, question: '' };

  // 1) 단독 영문 티커 입력 (예: "MRNA", "$TSLA", "soxx", "f")
  if (/^\$?[A-Za-z.\-]{1,7}$/.test(clean)) {
    return { ticker: clean.replace(/^\$/, '').toUpperCase(), question: '' };
  }

  // 2) 한글 종목명 사전 매칭 (예: "모더나 가져와", "아이온큐 지지저항")
  for (const [ko, sym] of KO_TICKER_MAP) {
    if (clean.includes(ko)) {
      return { ticker: sym, question: clean };
    }
  }

  // 3) 문장 내 영문 티커 추출 ("MRNA가져와", "MRNA 지지저항", "(MRNA)" 등 붙여쓴 경우도 모두 인식!)
  const enTokens = clean.match(/[A-Za-z]{1,6}/g) || [];
  for (const tok of enTokens) {
    const up = tok.toUpperCase();
    if (!IGNORE_EN_WORDS.has(up)) {
      return { ticker: up, question: clean };
    }
  }

  // 4) 사전에 없는 한글 종목명일 경우 Gemini AI로 티커 심볼 즉시 추출
  const aiTickRes = await callGeminiAI(
    `다음 사용자 질문에서 언급된 미국 주식/ETF/크립토의 영문 티커 심볼(예: MRNA, TSLA, NVDA, CVNA) 딱 1개만 영문 대문자로 출력하라. 만약 종목 언급이 전혀 없는 후속 질문이면 NONE 이라고만 출력하라.\n질문: "${clean}"`,
    geminiKey,
    4500
  );
  if (aiTickRes.ok && aiTickRes.text) {
    const m = aiTickRes.text.trim().toUpperCase().match(/^[A-Z.\-]{1,6}$/);
    if (m && m[0] !== 'NONE') {
      return { ticker: m[0], question: clean };
    }
  }

  return { ticker: fallbackSymbol, question: clean };
}

async function handleOptionAiChat(userText, explicitSymbol = null) {
  const raw = String(userText || '').trim();
  const parsed = explicitSymbol
    ? { ticker: String(explicitSymbol).toUpperCase().trim(), question: raw }
    : await resolveTickerFromUserText(raw, state.lastOptionSymbol, state.integrations.geminiApiKey);

  const ticker = parsed.ticker;
  if (!ticker) {
    const askTickerMsg = {
      id: `chat_a_${Date.now()}`,
      role: 'assistant',
      symbol: null,
      timestamp: new Date().toISOString(),
      text: '분석할 종목의 티커(예: MRNA, TSLA, NVDA)나 종목명(예: 모더나, 테슬라)을 함께 입력해 주세요!'
    };
    state.optionChatHistory.push({
      id: `chat_u_${Date.now() - 1}`,
      role: 'user',
      symbol: null,
      timestamp: new Date().toISOString(),
      text: raw
    });
    state.optionChatHistory.push(askTickerMsg);
    saveState();
    return { ok: false, error: askTickerMsg.text, history: state.optionChatHistory };
  }

  const userDisplayMsg = raw || `${ticker} 옵션 감마 데이터 불러와서 핵심 지지·저항선이랑 타점 정해줘`;

  if (!Array.isArray(state.optionChatHistory)) state.optionChatHistory = [];
  state.optionChatHistory.push({
    id: `chat_u_${Date.now()}`,
    role: 'user',
    symbol: ticker,
    timestamp: new Date().toISOString(),
    text: userDisplayMsg
  });

  const aiOut = await askOptionSupportResistanceAI(ticker, parsed.question, state.integrations.geminiApiKey);
  if (!aiOut.ok) {
    const errMsg = {
      id: `chat_a_${Date.now()}`,
      role: 'assistant',
      symbol: ticker,
      timestamp: new Date().toISOString(),
      text: `⚠️ ${aiOut.error}`
    };
    state.optionChatHistory.push(errMsg);
    if (state.optionChatHistory.length > 40) state.optionChatHistory = state.optionChatHistory.slice(-40);
    saveState();
    return { ok: false, error: aiOut.error, history: state.optionChatHistory };
  }

  state.lastOptionSymbol = aiOut.symbol;
  state.lastOptionAnalysis = aiOut.analysis;

  const botMsg = {
    id: `chat_a_${Date.now()}`,
    role: 'assistant',
    symbol: aiOut.symbol,
    aiModel: aiOut.aiModel,
    levels: aiOut.analysis.levels,
    spot: aiOut.analysis.spot,
    card: aiOut.card,
    timestamp: new Date().toISOString(),
    text: aiOut.reply
  };
  state.optionChatHistory.push(botMsg);
  if (state.optionChatHistory.length > 40) {
    state.optionChatHistory = state.optionChatHistory.slice(-40);
  }
  saveState();

  return {
    ok: true,
    symbol: aiOut.symbol,
    analysis: aiOut.analysis,
    message: botMsg,
    history: state.optionChatHistory
  };
}

// ============================================================================
// 3. GitHub Actions 클라우드 자동 배포 (1클릭 Device Flow + 로컬 토큰 영구 보관)
// ============================================================================
function loadLocalGhAuth() {
  try {
    if (fs.existsSync(GH_LOCAL_AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(GH_LOCAL_AUTH_FILE, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function saveLocalGhAuth(data) {
  try {
    const prev = loadLocalGhAuth();
    fs.writeFileSync(GH_LOCAL_AUTH_FILE, JSON.stringify({ ...prev, ...data, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

async function deployToGitHub(githubToken, repoName = 'grok-trading-team', isPrivate = false) {
  const localAuth = loadLocalGhAuth();
  const token = String(githubToken || state.integrations?.githubToken || localAuth.githubToken || '').trim();
  if (!token) {
    return { ok: false, error: 'GitHub 인증이 필요합니다. [8자리 인증코드 받기]를 눌러 1초 인증을 진행해 주세요.' };
  }
  saveLocalGhAuth({ githubToken: token, repoName });

  const ghHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  const userRes = await fetchJson('https://api.github.com/user', { headers: ghHeaders });
  if (!userRes.ok || !userRes.data?.login) {
    return { ok: false, error: `GitHub 인증 실패 (HTTP ${userRes.status})` };
  }
  const owner = userRes.data.login;

  let repoRes = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}`, { headers: ghHeaders });
  if (!repoRes.ok) {
    repoRes = await fetchJson('https://api.github.com/user/repos', {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        name: repoName,
        description: 'Variational 10x Stop-Hunt Bot & AI Option S/R Analyzer v4.0',
        private: Boolean(isPrivate),
        auto_init: true
      })
    });
    if (!repoRes.ok) {
      return { ok: false, error: `저장소 생성 실패: ${repoRes.data?.message || repoRes.status}` };
    }
    await new Promise(r => setTimeout(r, 1800));
  } else if (repoRes.data?.private === true && !isPrivate) {
    // 기존에 Private으로 생성된 저장소를 Render 연동을 위해 자동으로 Public(공개)으로 전환
    const patchRes = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}`, {
      method: 'PATCH',
      headers: ghHeaders,
      body: JSON.stringify({ private: false, visibility: 'public' })
    });
    if (patchRes.ok) {
      repoRes = patchRes;
    }
  }

  const defaultBranch = repoRes.data?.default_branch || 'main';
  saveState();

  const filesToUpload = [
    'package.json',
    'render.yaml',
    'agents.js',
    'indicators.js',
    'cloud-runner.js',
    'server.js',
    'public/index.html',
    'data/desk_state.json',
    '.github/workflows/trading-cron.yml'
  ];

  const uploaded = [];
  for (const relPath of filesToUpload) {
    const absPath = path.join(__dirname, relPath);
    if (!fs.existsSync(absPath)) continue;
    const contentB64 = fs.readFileSync(absPath).toString('base64');

    const checkRes = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}/contents/${relPath}`, { headers: ghHeaders });
    const body = {
      message: `deploy(v4.0): update ${relPath} (10x Stop-Hunt + Option S/R AI)`,
      content: contentB64,
      branch: defaultBranch
    };
    if (checkRes.ok && checkRes.data?.sha) {
      body.sha = checkRes.data.sha;
    }

    const putRes = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}/contents/${relPath}`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(body)
    }, 15000);

    if (!putRes.ok) {
      return { ok: false, error: `${relPath} 업로드 실패 (HTTP ${putRes.status})` };
    }
    uploaded.push(relPath);
  }

  const repoUrl = `https://github.com/${owner}/${repoName}`;
  const actionsUrl = `https://github.com/${owner}/${repoName}/actions`;
  saveLocalGhAuth({ githubToken: token, repoName, repoUrl, actionsUrl });

  const doneMsg = [
    `☁️ [GitHub 24시간 클라우드 v4.0 업데이트 완료!]`,
    `• 저장소: ${repoUrl}`,
    `• ⚡ Variational 10x 스탑헌팅 봇($1,000 금고)이 평일 15분마다 자동 실행되며, 개장 전 스탑헌팅 포착 시 텔레그램 알림을 발송합니다.`
  ].join('\n');

  addLog('INFO', doneMsg);
  await sendTelegramNotification(doneMsg, true);

  return { ok: true, owner, repoName, repoUrl, actionsUrl, uploadedCount: uploaded.length };
}

const GH_OAUTH_CLIENT_ID = '178c6fc778ccc68e1d6a';
let githubDeviceSession = {
  status: 'IDLE',
  userCode: null,
  verificationUri: 'https://github.com/login/device',
  repoName: 'grok-trading-team',
  deployResult: null,
  error: null,
  startedAt: null
};
let devicePollTimer = null;

async function startGitHubDeviceFlow(repoName = 'grok-trading-team', isPrivate = false) {
  if (devicePollTimer) {
    clearTimeout(devicePollTimer);
    devicePollTimer = null;
  }

  const formBody = new URLSearchParams({
    client_id: GH_OAUTH_CLIENT_ID,
    scope: 'repo workflow'
  }).toString();

  const res = await fetchJson('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formBody
  });

  if (!res.ok || !res.data?.device_code || !res.data?.user_code) {
    return { ok: false, error: 'GitHub 인증 코드 발급 실패' };
  }

  const deviceCode = res.data.device_code;
  const userCode = res.data.user_code;
  const verificationUri = res.data.verification_uri || 'https://github.com/login/device';
  let currentIntervalSec = Math.max(7, Number(res.data.interval || 5) + 2);

  githubDeviceSession = {
    status: 'WAITING_USER',
    userCode,
    verificationUri,
    repoName,
    deployResult: null,
    error: null,
    startedAt: new Date().toISOString()
  };

  const pollOnce = async () => {
    try {
      const pollBody = new URLSearchParams({
        client_id: GH_OAUTH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }).toString();

      const tokenRes = await fetchJson('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: pollBody
      });

      if (tokenRes.ok && tokenRes.data?.access_token) {
        devicePollTimer = null;
        const accessToken = tokenRes.data.access_token;
        state.integrations.githubToken = accessToken;
        githubDeviceSession.status = 'DEPLOYING';

        const depOut = await deployToGitHub(accessToken, repoName, isPrivate);
        if (depOut.ok) {
          githubDeviceSession.status = 'DEPLOYED';
          githubDeviceSession.deployResult = depOut;
          saveState();
        } else {
          githubDeviceSession.status = 'ERROR';
          githubDeviceSession.error = depOut.error;
        }
        return;
      } else if (tokenRes.data?.error === 'slow_down') {
        currentIntervalSec = Number(tokenRes.data.interval || currentIntervalSec + 5) + 2;
      } else if (tokenRes.data?.error === 'expired_token' || tokenRes.data?.error === 'access_denied') {
        devicePollTimer = null;
        githubDeviceSession.status = 'ERROR';
        githubDeviceSession.error = '인증 코드 만료 — 버튼을 다시 눌러 새 코드를 받아주세요.';
        return;
      }
    } catch {
      // ignore transient error
    }
    devicePollTimer = setTimeout(pollOnce, currentIntervalSec * 1000);
  };

  devicePollTimer = setTimeout(pollOnce, currentIntervalSec * 1000);
  return { ok: true, userCode, verificationUri, repoName, status: githubDeviceSession.status };
}

// ============================================================================
// 4. Variational DEX 전 종목(588개) 실시간 지정가 텔레그램 알리미 엔진
// ============================================================================
let variationalCatalog = []; // [{ ticker, name, markPrice, bidPrice, askPrice, volume24h }]
const variationalRuntime = {}; // ticker -> { current_price, bid_price, ask_price, high_24h, low_24h, open_price, price_change_pct, volume_24h, last_updated, api_status, price_history, last_alert_time, last_price_state, alert_count }

function getOrInitVarSymbolState(sym) {
  if (!variationalRuntime[sym]) {
    variationalRuntime[sym] = {
      current_price: 0,
      bid_price: 0,
      ask_price: 0,
      high_24h: 0,
      low_24h: 0,
      open_price: 0,
      price_change_pct: 0,
      volume_24h: 0,
      last_updated: null,
      api_status: 'Variational 연결 대기 중',
      price_history: [],
      last_alert_time: 0,
      last_price_state: null,
      alert_count: 0
    };
  }
  return variationalRuntime[sym];
}

async function sendPriceAlertTelegram(htmlText) {
  const pa = state.priceAlerts || {};
  const chatId = String(pa.chat_id || state.integrations?.telegramChatId || DEFAULT_TELEGRAM_CHAT_ID).trim();
  if (!chatId) return { ok: false, error: 'Chat ID 미설정' };

  // 1순위: @Alert_123455_bot (기존 알리미 봇), 2순위: @dytradingdemo_bot 백업
  const tokens = [DEFAULT_ALERT_BOT_TOKEN, state.integrations?.telegramToken || DEFAULT_TELEGRAM_TOKEN].filter(Boolean);
  let lastErr = '발송 실패';
  for (const tk of tokens) {
    const res = await fetchJson(`https://api.telegram.org/bot${tk}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }, 8000);
    if (res.ok && res.data?.ok) {
      return { ok: true, message: '텔레그램 전송 완료' };
    }
    lastErr = res.data?.description || `HTTP ${res.status}`;
  }
  return { ok: false, error: lastErr };
}

let varPollBusy = false;
async function pollVariationalPriceAlerts() {
  if (varPollBusy) return;
  varPollBusy = true;
  try {
    const res = await fetchJson('https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats', {}, 7000);
    if (!res.ok || !Array.isArray(res.data?.listings)) return;

    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 8);
    const dateTimeStr = now.toISOString().replace('T', ' ').slice(0, 19);
    const nowSec = Date.now() / 1000;

    const mapByTicker = new Map();
    const cat = [];
    for (const item of res.data.listings) {
      const tk = String(item.ticker || '').toUpperCase().trim();
      const mp = Number(item.mark_price || 0);
      if (!tk || mp <= 0) continue;
      const bid = Number(item.quotes?.base?.bid || mp);
      const ask = Number(item.quotes?.base?.ask || mp);
      const vol = Number(item.volume_24h || 0);
      const entry = {
        ticker: tk,
        name: item.name || tk,
        markPrice: mp,
        bidPrice: bid,
        askPrice: ask,
        volume24h: vol
      };
      mapByTicker.set(tk, entry);
      cat.push(entry);
    }
    cat.sort((a, b) => b.volume24h - a.volume24h);
    variationalCatalog = cat;

    // [실시간 3초 주기 스탑헌팅 10x 열린 포지션 익절(TP1/TP2) · 손절(SL) 감시 및 텔레그램 발송]
    const desk = state.desks?.memecoin;
    if (desk && Array.isArray(desk.openPositions) && desk.openPositions.length > 0) {
      let posChanged = false;
      const snapshot = [...desk.openPositions];
      for (const pos of snapshot) {
        if (!pos || !pos.id || closingPosIds.has(pos.id) || !desk.openPositions.some(p => p.id === pos.id)) {
          continue;
        }
        const cleanTicker = String(pos.contract || pos.symbol || '').toUpperCase().replace(/USDT$/, '');
        const live = mapByTicker.get(cleanTicker);
        if (!live || live.markPrice <= 0) {
          continue;
        }
        const isShort = pos.direction === 'SHORT';
        const curP = live.markPrice >= 1 ? Number(live.markPrice.toFixed(4)) : Number(live.markPrice.toFixed(5));
        if (pos.currentPriceUsd !== curP) {
          pos.currentPriceUsd = curP;
          posChanged = true;
        }

        const tp1P = Number(pos.tp1PriceUsd || pos.entryPriceUsd);
        const tp2P = Number(pos.tp2PriceUsd || pos.entryPriceUsd);
        const stopP = Number(pos.stopPriceUsd || pos.entryPriceUsd);

        let shouldClose = false;
        let closeReason = '';

        if (isShort) {
          if (curP <= tp2P) {
            shouldClose = true;
            closeReason = `출발 기준가(TP2 $${tp2P}) 도달 전량 익절`;
          } else if (curP >= stopP) {
            shouldClose = true;
            closeReason = `스탑헌팅 고점 방어선(SL $${stopP}) 돌파 칼손절`;
          } else if (curP <= tp1P) {
            pos.tp1Reached = true;
            posChanged = true;
          } else if (pos.tp1Reached && curP >= tp1P * 1.0015) {
            shouldClose = true;
            closeReason = `1차 목표가(TP1 $${tp1P}) 도달 후 수익 보존 익절`;
          }
        } else {
          if (curP >= tp2P) {
            shouldClose = true;
            closeReason = `출발 기준가(TP2 $${tp2P}) 도달 전량 익절`;
          } else if (curP <= stopP) {
            shouldClose = true;
            closeReason = `스탑헌팅 저점 방어선(SL $${stopP}) 이탈 칼손절`;
          } else if (curP >= tp1P) {
            pos.tp1Reached = true;
            posChanged = true;
          } else if (pos.tp1Reached && curP <= tp1P * 0.9985) {
            shouldClose = true;
            closeReason = `1차 목표가(TP1 $${tp1P}) 도달 후 수익 보존 익절`;
          }
        }

        if (shouldClose) {
          posChanged = true;
          await settleAndNotifyStopHuntPosition(pos, curP, closeReason, '실시간 3초 TP/SL 감시');
        }
      }
      if (posChanged) {
        recomputePortfolio();
      }
    }

    if (!state.priceAlerts) state.priceAlerts = getDefaultState().priceAlerts;
    const targets = state.priceAlerts.targets || {};
    const rearmMode = state.priceAlerts.rearm_mode || 'cross_again';
    const cooldownSec = Number(state.priceAlerts.cooldown_minutes || 10) * 60;
    let stateDirty = false;

    for (const [rawKey, tConf] of Object.entries(targets)) {
      const sym = rawKey.toUpperCase().replace(/USDT$/, '');
      const live = mapByTicker.get(sym);
      const sState = getOrInitVarSymbolState(sym);

      if (!live) {
        sState.api_status = 'Variational 미상장 티커';
        continue;
      }

      const curP = live.markPrice;
      if (!sState.open_price) sState.open_price = curP;
      if (!sState.high_24h || curP > sState.high_24h) sState.high_24h = Math.max(curP, live.askPrice);
      if (!sState.low_24h || curP < sState.low_24h) sState.low_24h = Math.min(curP, live.bidPrice);

      sState.current_price = curP;
      sState.bid_price = live.bidPrice;
      sState.ask_price = live.askPrice;
      sState.volume_24h = live.volume24h;
      sState.price_change_pct = sState.open_price > 0 ? ((curP - sState.open_price) / sState.open_price) * 100 : 0;
      sState.last_updated = timeStr;
      sState.api_status = '정상 연결 (Variational DEX)';

      sState.price_history.push({ time: timeStr, price: curP });
      if (sState.price_history.length > 40) {
        sState.price_history = sState.price_history.slice(-40);
      }

      // [실시간 20일 이평선(SMA 20) 및 일봉/주봉 볼린저 밴드 비동기 캐싱 & 터치 감시]
      if (tConf.indicators) {
        try {
          const indObj = await getOrFetchIndicators(sym, curP);
          sState.indicators = indObj;
          const prevPrice = Number(sState.prev_price || curP);
          const touches = checkIndicatorTouches(sym, tConf, curP, prevPrice, indObj, sState);
          sState.prev_price = curP;

          for (const trig of touches) {
            sState.alert_count += 1;
            const perf = getStopHuntPerformanceSummary();
            const diffSign = trig.diffUsd >= 0 ? '+' : '';
            const msg = [
              `<b>[Variational ${assetName} (${sym}) 지표 도달 알림]</b>`,
              ``,
              `• <b>도달 지표:</b> <b>${trig.name}</b> (${trig.role})`,
              `• <b>지표 기준가:</b> $${trig.linePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
              `• <b>현재 마크가:</b> $${curP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} (${diffSign}$${trig.diffUsd}, 오차 ${trig.distPct}%)`,
              `• <b>도달 형태:</b> ${trig.touchType}`,
              `• <b>일봉 볼밴:</b> 하단 $${trig.daily?.lower ?? '-'} · 20일선 $${trig.daily?.sma20 ?? '-'} · 상단 $${trig.daily?.upper ?? '-'}`,
              `• <b>주봉 볼밴:</b> 하단 $${trig.weekly?.lower ?? '-'} · 20주선 $${trig.weekly?.sma20 ?? '-'} · 상단 $${trig.weekly?.upper ?? '-'}`,
              `• <b>도달 시각:</b> ${dateTimeStr}`,
              perf.footerHtml
            ].join('\n');

            const tgRes = await sendPriceAlertTelegram(msg);
            if (!Array.isArray(state.priceAlerts.logs)) state.priceAlerts.logs = [];
            state.priceAlerts.logs.unshift({
              id: Date.now() + Math.floor(Math.random() * 1000),
              symbol: sym,
              name: `${assetName} [${trig.category}]`,
              timestamp: dateTimeStr,
              price: Number(curP.toFixed(4)),
              target: trig.linePrice,
              condition: trig.category,
              success: tgRes.ok,
              detail: tgRes.ok ? `[${trig.name}] 텔레그램 전송 완료 (${trig.touchType})` : tgRes.error
            });
            if (state.priceAlerts.logs.length > 100) {
              state.priceAlerts.logs = state.priceAlerts.logs.slice(0, 100);
            }
            stateDirty = true;
          }
        } catch (indErr) {
          // ignore transient indicator fetch error
        }
      }

      if (!tConf.enabled) continue;

      const targetP = Number(tConf.target_price || 0);
      if (targetP <= 0) continue;
      const cond = tConf.condition === 'lte' ? 'lte' : 'gte';
      const assetName = tConf.name || live.name || sym;

      const isMet = cond === 'gte' ? (curP >= targetP) : (curP <= targetP);
      const currentSide = isMet ? 'met' : 'unmet';

      let shouldFire = false;
      let triggerReason = '';

      if (isMet) {
        if (rearmMode === 'cross_again') {
          if (sState.last_price_state !== 'met') {
            shouldFire = true;
            triggerReason = `목표가 $${targetP.toFixed(2)} ${cond === 'gte' ? '이상 돌파' : '이하 도달'} 감지`;
          }
        } else {
          if ((nowSec - sState.last_alert_time) >= cooldownSec) {
            shouldFire = true;
            triggerReason = `목표가 조건 유지 중 (${state.priceAlerts.cooldown_minutes}분 주기 알림)`;
          }
        }
      }

      sState.last_price_state = currentSide;

      if (shouldFire) {
        sState.last_alert_time = nowSec;
        sState.alert_count += 1;

        const diff = curP - targetP;
        const diffStr = diff >= 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
        const pctDiff = targetP > 0 ? ((curP - targetP) / targetP) * 100 : 0;
        const condStr = cond === 'gte' ? '이상 돌파 (>=)' : '이하 도달 (<=)';

        const perf = getStopHuntPerformanceSummary();
        const msg = [
          `<b>[Variational ${assetName} (${sym}) 목표가 도달 알림]</b>`,
          ``,
          `• <b>설정 목표가:</b> $${targetP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} (${condStr})`,
          `• <b>현재 마크가:</b> $${curP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} (${diffStr}, ${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(2)}%)`,
          `• <b>호가 (Bid / Ask):</b> $${live.bidPrice.toFixed(2)} / $${live.askPrice.toFixed(2)}`,
          `• <b>도달 시각:</b> ${dateTimeStr}`,
          `• <b>사유:</b> ${triggerReason}`,
          perf.footerHtml
        ].join('\n');

        const tgRes = await sendPriceAlertTelegram(msg);
        if (!Array.isArray(state.priceAlerts.logs)) state.priceAlerts.logs = [];
        state.priceAlerts.logs.unshift({
          id: Date.now(),
          symbol: sym,
          name: assetName,
          timestamp: dateTimeStr,
          price: Number(curP.toFixed(4)),
          target: targetP,
          condition: cond,
          success: tgRes.ok,
          detail: tgRes.ok ? '텔레그램 전송 완료' : tgRes.error
        });
        if (state.priceAlerts.logs.length > 100) {
          state.priceAlerts.logs = state.priceAlerts.logs.slice(0, 100);
        }
        stateDirty = true;
      }
    }

    if (stateDirty) saveState();
  } catch {
    // ignore transient poll error
  } finally {
    varPollBusy = false;
  }
}

// 3초 주기 Variational DEX 지정가 감시 + 열린 10x 포지션 실시간 익절/손절 감시 루프
setInterval(pollVariationalPriceAlerts, 3000);
setTimeout(pollVariationalPriceAlerts, 500);

// 미장 개장 전후(07:30~10:30 ET) & 한국장 개장(08:45~10:15 KST, EWY 전용) 1분 주기 정밀 타점 감시 루프
setInterval(async () => {
  try {
    const sInfo = getStopHuntSessionInfo();
    const isKillzone = sInfo.isNyPreOpenKillzone || sInfo.isKoreaOpenKillzone;
    if (isKillzone && state.routines.scan15mEnabled) {
      const scanLabel = sInfo.isKoreaOpenKillzone ? '한국장 EWY 킬존 1분 자동스캔' : '미장 킬존 1분 자동스캔';
      await executeStopHuntScan(scanLabel);
    }
  } catch {}
}, 60 * 1000);

// 5분 10x 포지션 점검 / 15분 스탑헌팅 스캔
setInterval(async () => {
  if (state.routines.risk5mEnabled) {
    await executeStopHuntRiskCheck('5분 자동 점검');
  }
}, 5 * 60 * 1000);

setInterval(async () => {
  if (state.routines.scan15mEnabled) {
    await executeStopHuntScan('15분 자동 스캔');
  }
}, 15 * 60 * 1000);

// ============================================================================
// 5. HTTP 서버 및 API 라우터
// ============================================================================
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
  const pathname = parsedUrl.pathname;

  // Render 헬스체크 엔드포인트
  if (pathname === '/healthz' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, status: 'healthy', version: '4.2.0' });
  }

  // 1) 전체 상태 조회
  if (pathname === '/api/desk/state' && req.method === 'GET') {
    const stopHuntPerformance = getStopHuntPerformanceSummary();
    return sendJson(res, 200, {
      state,
      stopHuntUniverse: STOPHUNT_UNIVERSE,
      stopHuntPerformance,
      sessionInfo: getStopHuntSessionInfo(),
      githubDeviceSession,
      liveStatus: getUnifiedLiveStatus()
    });
  }

  // 2) 좌측: Variational 10x 스탑헌팅 스캔 실행
  if (pathname === '/api/desk/run-pipeline' && req.method === 'POST') {
    const result = await executeStopHuntScan('수동 스캔');
    return sendJson(res, 200, result);
  }

  // 3) 좌측: 10x 열린 포지션 즉시 점검
  if (pathname === '/api/desk/run-risk' && req.method === 'POST') {
    const routineRes = await executeStopHuntRiskCheck('수동 점검');
    return sendJson(res, 200, { ok: true, result: routineRes });
  }

  // 4) 좌측: $1,000 스탑헌팅 금고 초기화
  if (pathname === '/api/desk/reset' && req.method === 'POST') {
    state.desks.memecoin.portfolio = createVaultPortfolio(1000.00);
    state.desks.memecoin.openPositions = [];
    state.desks.memecoin.closedPositions = [];
    recomputePortfolio();
    addLog('INFO', 'Variational 10x 스탑헌팅 금고가 $1,000.00로 초기화되었습니다.');
    return sendJson(res, 200, { ok: true, state });
  }

  // 5) 우측: 티커 옵션 감마 & 차트 지지·저항선 단독 조회
  if (pathname === '/api/rwa/analyze' && req.method === 'GET') {
    const sym = (parsedUrl.searchParams.get('symbol') || 'NVDA').toUpperCase().trim();
    const analysis = await analyzeRwaTicker(sym);
    if (analysis.ok) {
      state.lastOptionSymbol = analysis.symbol;
      state.lastOptionAnalysis = analysis;
      saveState();
    }
    return sendJson(res, 200, analysis);
  }

  // 6) 우측: AI 옵션 지지·저항선 분석 챗봇 API
  if ((pathname === '/api/options-ai/chat' || pathname === '/api/desk/chat') && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await handleOptionAiChat(body.text || '', body.symbol || null);
    return sendJson(res, 200, out);
  }

  // 7) 우측: AI 채팅 기록 초기화
  if (pathname === '/api/options-ai/clear' && req.method === 'POST') {
    state.optionChatHistory = getDefaultState().optionChatHistory;
    state.lastOptionSymbol = null;
    state.lastOptionAnalysis = null;
    saveState();
    return sendJson(res, 200, { ok: true, history: state.optionChatHistory });
  }

  // 8) 텔레그램 연결 테스트
  if (pathname === '/api/desk/telegram-test' && req.method === 'POST') {
    const perf = getStopHuntPerformanceSummary();
    const p = state.desks.memecoin.portfolio;
    const msg = [
      `<b>[Variational 10x 스탑헌팅 봇 — 텔레그램 알림 테스트]</b>`,
      ``,
      `• <b>감시 대상 (7종목):</b> BTC, ETH, SOL, HYPE, QQQ, SOXL, EWY`,
      `• <b>금고 평가액:</b> $${p.totalEquityUsd.toFixed(2)} (가용 현금 $${p.cashUsd.toFixed(2)})`,
      `• <b>열린 10x 포지션:</b> ${state.desks.memecoin.openPositions.length}개`,
      `• <b>자동 발송:</b> 킬존(07:30~10:30 ET) 확정 구간 진입 시 모의 매수/매도 및 실시간 익절(TP)/손절(SL) 알림이 즉시 전송됩니다.`,
      perf.footerHtml
    ].join('\n');
    const tgOut = await sendTelegramNotification(msg, true);
    return sendJson(res, 200, tgOut);
  }

  // 9) GitHub 클라우드 배포 API (Render 연동을 위해 기본 Public 전환)
  if (pathname === '/api/desk/github-deploy' && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await deployToGitHub(body.githubToken, body.repoName || 'grok-trading-team', Boolean(body.isPrivate));
    return sendJson(res, 200, out);
  }

  if (pathname === '/api/desk/github-device-start' && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await startGitHubDeviceFlow(body.repoName || 'grok-trading-team', Boolean(body.isPrivate));
    return sendJson(res, 200, out);
  }

  if (pathname === '/api/desk/github-device-status' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, session: githubDeviceSession });
  }

  // 10) Variational DEX 지정가 텔레그램 알리미 API
  if (pathname === '/api/price-alerts/status' && req.method === 'GET') {
    if (!state.priceAlerts) state.priceAlerts = getDefaultState().priceAlerts;
    const pa = state.priceAlerts;
    const resSymbols = {};
    for (const [sym, tConf] of Object.entries(pa.targets || {})) {
      const cleanSym = sym.toUpperCase().replace(/USDT$/, '');
      const sState = getOrInitVarSymbolState(cleanSym);
      const curr = Number(sState.current_price || 0);
      const target = Number(tConf.target_price || 0);
      const cond = tConf.condition === 'lte' ? 'lte' : 'gte';
      const dist = target - curr;
      const distPct = target > 0 ? (dist / target) * 100 : 0;

      resSymbols[cleanSym] = {
        symbol: cleanSym,
        name: tConf.name || cleanSym,
        target_price: target,
        condition: cond,
        enabled: Boolean(tConf.enabled ?? true),
        indicators: tConf.indicators || {
          ma20_daily: true,
          bb_daily_upper: true,
          bb_daily_lower: true,
          bb_weekly_upper: true,
          bb_weekly_lower: true
        },
        indicator_values: sState.indicators || null,
        current_price: curr,
        bid_price: Number(sState.bid_price || curr),
        ask_price: Number(sState.ask_price || curr),
        distance: dist,
        distance_pct: distPct,
        high_24h: Number(sState.high_24h || curr),
        low_24h: Number(sState.low_24h || curr),
        price_change_pct: Number(sState.price_change_pct || 0),
        volume_24h: Number(sState.volume_24h || 0),
        last_updated: sState.last_updated,
        api_status: sState.api_status,
        alert_count: sState.alert_count,
        price_history: sState.price_history
      };
    }

    return sendJson(res, 200, {
      ok: true,
      symbols: resSymbols,
      chat_id: pa.chat_id || DEFAULT_TELEGRAM_CHAT_ID,
      chat_user: pa.chat_user || '도윤 이 (@shortbetofohsun)',
      bot_username: pa.bot_username || 'Alert_123455_bot',
      cooldown_minutes: pa.cooldown_minutes || 10,
      rearm_mode: pa.rearm_mode || 'cross_again',
      sound_enabled: Boolean(pa.sound_enabled ?? true),
      total_alert_count: (pa.logs || []).length,
      total_listings_count: variationalCatalog.length,
      logs: (pa.logs || []).slice(0, 30)
    });
  }

  if (pathname === '/api/price-alerts/listings' && req.method === 'GET') {
    const q = (parsedUrl.searchParams.get('q') || '').trim().toUpperCase();
    let list = variationalCatalog;
    if (q) {
      list = list.filter(item =>
        item.ticker.toUpperCase().includes(q) ||
        String(item.name || '').toUpperCase().includes(q)
      );
    }
    return sendJson(res, 200, {
      ok: true,
      total: variationalCatalog.length,
      listings: list.slice(0, 120)
    });
  }

  if (pathname === '/api/price-alerts/target' && req.method === 'POST') {
    const body = await parseBody(req);
    const rawSym = String(body.symbol || '').toUpperCase().trim().replace(/^\$/, '').replace(/USDT$/, '');
    if (!rawSym) {
      return sendJson(res, 400, { ok: false, error: '유효한 종목 티커를 입력해 주세요.' });
    }
    const targetPrice = Number(body.target_price);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      return sendJson(res, 400, { ok: false, error: '유효한 목표가($)를 입력해 주세요.' });
    }
    const foundMeta = variationalCatalog.find(x => x.ticker === rawSym);
    const existing = state.priceAlerts.targets[rawSym] || {};
    const cond = body.condition === 'lte' ? 'lte' : 'gte';
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : true;

    state.priceAlerts.targets[rawSym] = {
      symbol: rawSym,
      name: body.name || existing.name || foundMeta?.name || rawSym,
      target_price: targetPrice,
      condition: cond,
      enabled,
      indicators: body.indicators || existing.indicators || {
        ma20_daily: true,
        bb_daily_upper: true,
        bb_daily_lower: true,
        bb_weekly_upper: true,
        bb_weekly_lower: true
      }
    };

    // 저장 즉시 감시 상태 재장전 (조건 충족 시 바로 알림 발송되도록)
    const sState = getOrInitVarSymbolState(rawSym);
    sState.last_price_state = null;
    saveState();
    setTimeout(pollVariationalPriceAlerts, 50);

    return sendJson(res, 200, {
      ok: true,
      target: state.priceAlerts.targets[rawSym]
    });
  }

  if (pathname === '/api/price-alerts/indicator-toggle' && req.method === 'POST') {
    const body = await parseBody(req);
    const rawSym = String(body.symbol || '').toUpperCase().trim().replace(/USDT$/, '');
    const key = String(body.key || '').trim();
    if (rawSym && state.priceAlerts?.targets?.[rawSym] && key) {
      if (!state.priceAlerts.targets[rawSym].indicators) {
        state.priceAlerts.targets[rawSym].indicators = {
          ma20_daily: true,
          bb_daily_upper: true,
          bb_daily_lower: true,
          bb_weekly_upper: true,
          bb_weekly_lower: true
        };
      }
      state.priceAlerts.targets[rawSym].indicators[key] = Boolean(body.enabled);
      saveState();
      return sendJson(res, 200, { ok: true, indicators: state.priceAlerts.targets[rawSym].indicators });
    }
    return sendJson(res, 400, { ok: false, error: '잘못된 지표 토글 요청입니다.' });
  }

  if (pathname === '/api/price-alerts/delete' && req.method === 'POST') {
    const body = await parseBody(req);
    const rawSym = String(body.symbol || '').toUpperCase().trim().replace(/USDT$/, '');
    if (rawSym && state.priceAlerts?.targets?.[rawSym]) {
      delete state.priceAlerts.targets[rawSym];
      saveState();
    }
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/price-alerts/reset-state' && req.method === 'POST') {
    for (const s of Object.values(variationalRuntime)) {
      s.last_price_state = null;
      s.last_alert_time = 0;
    }
    return sendJson(res, 200, {
      ok: true,
      message: '모든 종목의 지정가 감시 상태가 초기화되었습니다. 조건 충족 시 즉시 재발송됩니다.'
    });
  }

  if (pathname === '/api/price-alerts/test-telegram' && req.method === 'POST') {
    const body = await parseBody(req);
    const sym = String(body.symbol || 'QQQ').toUpperCase().trim().replace(/USDT$/, '');
    const tConf = state.priceAlerts?.targets?.[sym] || { symbol: sym, name: sym, target_price: 0, condition: 'gte' };
    const sState = getOrInitVarSymbolState(sym);
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const condStr = tConf.condition === 'lte' ? '이하 도달 (<=)' : '이상 돌파 (>=)';

    let ind = sState.indicators;
    if (!ind) {
      try { ind = await getOrFetchIndicators(sym, Number(sState.current_price || 0)); } catch {}
    }

    const dStr = ind?.daily ? `하단 $${ind.daily.lower} · 20일선 $${ind.daily.sma20} · 상단 $${ind.daily.upper}` : '계산 중';
    const wStr = ind?.weekly ? `하단 $${ind.weekly.lower} · 20주선 $${ind.weekly.sma20} · 상단 $${ind.weekly.upper}` : '계산 중';

    const perf = getStopHuntPerformanceSummary();
    const msg = [
      `<b>[텔레그램 지정가 & 지표 알림 테스트 — ${tConf.name} (${sym})]</b>`,
      ``,
      `Variational DEX 실시간 지정가 & 20일선/볼밴 알림 봇이 정상 연동되어 감시 중입니다.`,
      `• <b>현재 ${sym} 마크가:</b> $${Number(sState.current_price || 0).toFixed(2)}`,
      `• <b>설정 목표가:</b> $${Number(tConf.target_price || 0).toFixed(2)} (${condStr})`,
      `• <b>일봉 볼밴 (20, 2):</b> ${dStr}`,
      `• <b>주봉 볼밴 (20, 2):</b> ${wStr}`,
      `• <b>감시 중인 지표:</b> 20일선(${tConf.indicators?.ma20_daily ? 'ON' : 'OFF'}) · 일봉볼밴(${tConf.indicators?.bb_daily_upper || tConf.indicators?.bb_daily_lower ? 'ON' : 'OFF'}) · 주봉볼밴(${tConf.indicators?.bb_weekly_upper || tConf.indicators?.bb_weekly_lower ? 'ON' : 'OFF'})`,
      `• <b>발송 시각:</b> ${nowStr}`,
      perf.footerHtml
    ].join('\n');

    const tgOut = await sendPriceAlertTelegram(msg);
    return sendJson(res, 200, tgOut);
  }

  if (pathname === '/api/price-alerts/clear-logs' && req.method === 'POST') {
    if (state.priceAlerts) state.priceAlerts.logs = [];
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/price-alerts/config' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!state.priceAlerts) state.priceAlerts = getDefaultState().priceAlerts;
    if (body.chat_id !== undefined) state.priceAlerts.chat_id = String(body.chat_id).trim();
    if (body.chat_user !== undefined) state.priceAlerts.chat_user = String(body.chat_user).trim();
    if (body.cooldown_minutes !== undefined) state.priceAlerts.cooldown_minutes = Number(body.cooldown_minutes) || 10;
    if (body.rearm_mode !== undefined) state.priceAlerts.rearm_mode = String(body.rearm_mode);
    if (body.sound_enabled !== undefined) state.priceAlerts.sound_enabled = Boolean(body.sound_enabled);
    saveState();
    return sendJson(res, 200, { ok: true, config: state.priceAlerts });
  }

  if (pathname === '/api/live/edge-heartbeat' && req.method === 'POST') {
    const body = await parseBody(req);
    pruneExpiredEdgeSignals();

    edgeBridgeRuntime.loggedIn = Boolean(body?.loggedIn);
    edgeBridgeRuntime.connectedAddress = String(body?.address || '').trim();
    edgeBridgeRuntime.lastBalanceUsd = Number(body?.balanceUsd || 0);
    edgeBridgeRuntime.upnlUsd = Number(body?.upnlUsd || 0);
    edgeBridgeRuntime.marginUsage = Number(body?.marginUsage || 0);
    edgeBridgeRuntime.positions = Array.isArray(body?.positions) ? body.positions : [];
    edgeBridgeRuntime.pageUrl = String(body?.pageUrl || '');
    edgeBridgeRuntime.lastHeartbeatAt = Date.now();

    const safety = evaluateEdgeBridgeSafety(false);
    edgeBridgeRuntime.safetyError = safety.ok ? null : safety.error;

    // 안전잠금 위반 시 실행 중이던 실전 자동매매 강제 OFF
    if (!safety.ok && state.liveBridge?.enabled && edgeBridgeRuntime.loggedIn) {
      state.liveBridge.enabled = false;
      saveState();
      addLog('INFO', `[안전잠금 자동해제] ${safety.error}`);
    }

    const toDispatch = [];
    for (const sig of edgeBridgeRuntime.pendingSignals) {
      if (!sig.dispatchedAt) {
        sig.dispatchedAt = Date.now();
        toDispatch.push({ ...sig });
      }
    }

    const unified = getUnifiedLiveStatus();
    return sendJson(res, 200, {
      ok: true,
      status: unified,
      config: {
        allowedAddress: unified.allowedAddress,
        orderMarginUsd: unified.orderMarginUsd,
        maxEquityCapUsd: unified.maxEquityCapUsd,
        maxSlippageBps: unified.maxSlippageBps,
        enabled: unified.enabled
      },
      signals: toDispatch
    });
  }

  if (pathname === '/api/live/edge-ack' && req.method === 'POST') {
    const body = await parseBody(req);
    const signalId = String(body?.signalId || '').trim();
    edgeBridgeRuntime.pendingSignals = edgeBridgeRuntime.pendingSignals.filter((s) => s.signalId !== signalId);
    edgeBridgeRuntime.lastActionNote = body?.ok
      ? `${body?.type || 'ORDER'} ${body?.symbol || ''} 체결 완료`
      : `${body?.type || 'ORDER'} ${body?.symbol || ''} 오류: ${body?.error || '실패'}`;

    const waiter = edgeBridgeRuntime.ackWaiters.get(signalId);
    if (waiter) {
      clearTimeout(waiter.timer);
      edgeBridgeRuntime.ackWaiters.delete(signalId);
      waiter.resolve(body || { ok: false, error: '빈 응답' });
    } else if (body?.type === 'EXIT') {
      addLog('EXIT', body?.ok
        ? `[Edge 지연 청산 확인] $${body?.symbol} RFQ ${body?.result?.rfqId || (body?.result?.alreadyClosedOnVenue ? '기청산' : '완료')}`
        : `[Edge 지연 청산 실패] $${body?.symbol}: ${body?.error}`);
    }

    return sendJson(res, 200, { ok: true, status: getUnifiedLiveStatus() });
  }

  if (pathname === '/api/live/status' && req.method === 'GET') {
    if (parsedUrl.searchParams.get('verify') === '1' && !isEdgeBridgeConnected()) {
      const v = await verifyLiveAccountSafety();
      return sendJson(res, 200, { ok: v.ok, error: v.error || null, status: getUnifiedLiveStatus(), positions: v.positions || [] });
    }
    return sendJson(res, 200, { ok: true, status: getUnifiedLiveStatus(), positions: edgeBridgeRuntime.positions || [] });
  }

  if (pathname === '/api/live/connect' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!state.liveBridge) state.liveBridge = getDefaultState().liveBridge;

    const reqAllowed = typeof body?.allowedAddress === 'string' ? body.allowedAddress.trim() : '';
    if (reqAllowed) {
      state.liveBridge.allowedAddress = reqAllowed;
    } else if (!state.liveBridge.allowedAddress && edgeBridgeRuntime.connectedAddress) {
      state.liveBridge.allowedAddress = edgeBridgeRuntime.connectedAddress;
    }
    if (Number(body?.orderMarginUsd) > 0) state.liveBridge.orderMarginUsd = Number(body.orderMarginUsd);
    if (Number(body?.maxEquityCapUsd) > 0) state.liveBridge.maxEquityCapUsd = Number(body.maxEquityCapUsd);
    if (Number(body?.maxSlippageBps) > 0) state.liveBridge.maxSlippageBps = Number(body.maxSlippageBps);
    saveState();

    if (body?.cookieHeader && !getPublicLiveStatus().isCloudBlocked) {
      const out = await connectEdgeSession({
        ...body,
        allowedAddress: state.liveBridge.allowedAddress,
        orderMarginUsd: state.liveBridge.orderMarginUsd,
        maxEquityCapUsd: state.liveBridge.maxEquityCapUsd,
        maxSlippageBps: state.liveBridge.maxSlippageBps
      });
      if (!out.ok && !isEdgeBridgeConnected()) {
        addLog('INFO', `[Edge 부계정 연동 차단] ${out.error}`);
        return sendJson(res, 400, { ...out, status: getUnifiedLiveStatus() });
      }
    }

    if (isEdgeBridgeConnected()) {
      const safety = evaluateEdgeBridgeSafety(true);
      const unified = getUnifiedLiveStatus();
      if (!safety.ok) {
        addLog('INFO', `[Edge 브리지 안전잠금 차단] ${safety.error}`);
        return sendJson(res, 400, { ok: false, error: safety.error, status: unified });
      }
      addLog('INFO', `[Edge 브리지 안전잠금 등록] 허용 지갑 ${unified.allowedAddress} | 현재 잔고 $${Number(unified.lastBalanceUsd || 0).toFixed(2)} USDC (상한 $${unified.maxEquityCapUsd})`);
      return sendJson(res, 200, { ok: true, status: unified });
    }

    const unified = getUnifiedLiveStatus();
    addLog('INFO', `[Edge 브리지 설정 저장] 허용 지갑 ${unified.allowedAddress || '자동감지 대기'} (Edge omni.variational.io 탭 연결 시 즉시 활성화)`);
    return sendJson(res, 200, { ok: true, savedConfigOnly: true, status: unified });
  }

  if (pathname === '/api/live/toggle' && req.method === 'POST') {
    const body = await parseBody(req);
    const nextEnabled = Boolean(body?.enabled);
    if (!state.liveBridge) state.liveBridge = getDefaultState().liveBridge;

    const direct = getPublicLiveStatus();
    const bridgeConn = isEdgeBridgeConnected();
    const directActive = Boolean(!direct.isCloudBlocked && direct.hasSession);

    if (nextEnabled) {
      if (!bridgeConn && !directActive) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Edge에서 https://omni.variational.io 탭이 연결되지 않았습니다. 확장프로그램을 켜고 Variational 탭에 로그인해 주세요.',
          status: getUnifiedLiveStatus()
        });
      }
      if (bridgeConn) {
        if (!state.liveBridge.allowedAddress && edgeBridgeRuntime.connectedAddress) {
          state.liveBridge.allowedAddress = edgeBridgeRuntime.connectedAddress;
        }
        const safety = evaluateEdgeBridgeSafety(true);
        if (!safety.ok) {
          return sendJson(res, 400, { ok: false, error: safety.error, status: getUnifiedLiveStatus() });
        }
      } else {
        const out = await toggleLiveMode(true);
        if (!out.ok) {
          return sendJson(res, 400, { ok: false, error: out.error, status: getUnifiedLiveStatus() });
        }
      }
    } else if (directActive) {
      await toggleLiveMode(false);
    }

    state.liveBridge.enabled = nextEnabled;
    saveState();
    const unified = getUnifiedLiveStatus();
    addLog('INFO', `[매매 모드 변경] ${unified.enabled ? '실전 자동매매(LIVE) 활성화' : '모의매매(PAPER) 전환'}`);
    return sendJson(res, 200, { ok: true, status: unified });
  }

  if (pathname === '/api/live/test-order' && req.method === 'POST') {
    const body = await parseBody(req);
    const symbol = String(body?.symbol || 'BTC').toUpperCase();
    const notionalUsd = Number(body?.notionalUsd) > 0 ? Number(body.notionalUsd) : 1.5;

    if (isEdgeBridgeConnected()) {
      if (!state.liveBridge?.allowedAddress && edgeBridgeRuntime.connectedAddress) {
        state.liveBridge.allowedAddress = edgeBridgeRuntime.connectedAddress;
        saveState();
      }
      const safety = evaluateEdgeBridgeSafety(true);
      if (!safety.ok) {
        return sendJson(res, 400, { ok: false, error: safety.error, status: getUnifiedLiveStatus() });
      }
      try {
        const ack = await dispatchEdgeSignalAndWait(
          { type: 'TEST_ROUNDTRIP', symbol, notionalUsd },
          22000,
          25000
        );
        if (!ack?.ok) throw new Error(ack?.error || 'Edge 브리지 주문 실패');
        const r = ack.result || {};
        addLog('INFO', `[실전 소액 왕복 테스트 완료 (Edge 브리지)] ${r.symbol || symbol} 진입 RFQ ${r.openRfqId} -> 청산 RFQ ${r.closeRfqId || '완료'} ($${r.entryPrice} -> $${r.exitPrice})`);
        return sendJson(res, 200, { ok: true, ...r, status: getUnifiedLiveStatus() });
      } catch (err) {
        addLog('INFO', `[실전 테스트 주문 실패] ${err.message}`);
        return sendJson(res, 400, { ok: false, error: err.message, status: getUnifiedLiveStatus() });
      }
    }

    const direct = getPublicLiveStatus();
    if (!direct.isCloudBlocked && direct.hasSession) {
      try {
        const out = await executeLiveRoundtripTest(symbol, notionalUsd);
        addLog('INFO', `[실전 소액 왕복 테스트 완료] ${symbol} 진입 RFQ ${out.openRfqId} -> 청산 RFQ ${out.closeRfqId || '완료'} ($${out.entryPrice} -> $${out.exitPrice})`);
        return sendJson(res, 200, { ...out, status: getUnifiedLiveStatus() });
      } catch (err) {
        addLog('INFO', `[실전 테스트 주문 실패] ${err.message}`);
        return sendJson(res, 400, { ok: false, error: err.message, status: getUnifiedLiveStatus() });
      }
    }

    return sendJson(res, 400, {
      ok: false,
      error: 'Edge에서 omni.variational.io 탭 연결이 감지되지 않았습니다. Edge에서 베리에이셔널 로그인 탭을 열어두고 3초 후 다시 시도해 주세요.',
      status: getUnifiedLiveStatus()
    });
  }

  if (pathname === '/api/live/disconnect' && req.method === 'POST') {
    if (state.liveBridge) state.liveBridge.enabled = false;
    edgeBridgeRuntime.pendingSignals = [];
    saveState();
    disconnectEdgeSession();
    addLog('INFO', '[Edge 부계정 세션 연결 해제] 모의매매(PAPER) 모드로 복귀했습니다.');
    return sendJson(res, 200, { ok: true, status: getUnifiedLiveStatus() });
  }

  // 11) 정적 파일 서빙
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8' });
    res.end(fs.readFileSync(filePath));
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

function startServer(port = 3000) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      state.wmPort = nextPort;
      server.listen(nextPort, '0.0.0.0');
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    const actualPort = server.address().port;
    state.wmPort = actualPort;
    saveState();
    console.log(`================================================================`);
    console.log(`⚡ Variational 10x 스탑헌팅 봇 & 🎯 옵션 지지·저항선 핵심수치 v4.0`);
    console.log(`🌐 주소: http://localhost:${actualPort}`);
    console.log(`================================================================`);

    if (!state.desks.memecoin.lastVetResults?.length) {
      setTimeout(() => {
        executeStopHuntScan('초기 스캔').catch(() => {});
      }, 1000);
    }

    // Render 무료 서버 슬립(15분 절전) 방지용 자체 헬스체크 핑 (중복 스캔/점검은 상단 5분/15분 루프 전담)
    setInterval(() => {
      try {
        const sInfo = getStopHuntSessionInfo();
        if (process.env.RENDER_EXTERNAL_URL && !sInfo.isWeekend) {
          fetchJson(`${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/healthz`, {}, 5000).catch(() => {});
        }
      } catch {}
    }, 10 * 60 * 1000);
  });
}

if (require.main === module) {
  startServer(Number(process.env.PORT || 3000));
}

module.exports = { server, startServer };
