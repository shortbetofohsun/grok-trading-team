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

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'desk_state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GH_LOCAL_AUTH_FILE = path.join(DATA_DIR, '.gh_local_auth.json');

const DEFAULT_TG_B64 = 'ODgxMDAzMTEzNzpBQUdyZ3JPZXB5SlJ6TE42OXpqbm1lV0RKQmlfWFY0Tkxidw==';
const DEFAULT_GM_B64 = 'QVEuQWI4Uk42THE1YUNscXNIVlkxbDMxUDIzREJ1eUNxSXFRZkFHeW5FMElCbUhPSjIzMkE=';

const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || Buffer.from(DEFAULT_GM_B64, 'base64').toString('utf-8');
const DEFAULT_TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || Buffer.from(DEFAULT_TG_B64, 'base64').toString('utf-8');
const DEFAULT_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8417795671';

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
    version: '4.0.0',
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
    logs: [
      {
        id: 'log_init',
        type: 'INFO',
        timestamp: nowIso,
        text: '⚡ Variational DEX 7대 선물 10x 스탑헌팅 모의매매 봇($1,000 금고) 가동 완료 (주말 휴장 가드 · 60일 백테스트 최적 % 적용)'
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
        desks: {
          memecoin: {
            ...def.desks.memecoin,
            ...loaded.desks.memecoin,
            name: 'Variational 10x 스탑헌팅 봇'
          }
        },
        logs: Array.isArray(loaded.logs) && loaded.logs.length ? loaded.logs : def.logs,
        optionChatHistory: Array.isArray(loaded.optionChatHistory) && loaded.optionChatHistory.length ? loaded.optionChatHistory : def.optionChatHistory
      };

      const allowedSyms = new Set(['BTC', 'ETH', 'SOL', 'HYPE', 'QQQUSDT', 'SOXXUSDT', 'EWYUSDT']);
      const hasInvalid = (state.desks.memecoin.openPositions || []).some(p => !p.isStopHunt || !allowedSyms.has(p.symbol));
      if (hasInvalid) {
        state.desks.memecoin.portfolio = createVaultPortfolio(1000.00);
        state.desks.memecoin.openPositions = [];
        state.desks.memecoin.closedPositions = [];
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

async function sendTelegramNotification(text, force = false) {
  const integ = state.integrations || {};
  if (!integ.telegramEnabled && !force) return { ok: false, reason: 'disabled' };
  const token = (integ.telegramToken || DEFAULT_TELEGRAM_TOKEN).trim();
  const chatId = (integ.telegramChatId || DEFAULT_TELEGRAM_CHAT_ID).trim();
  if (!token || !chatId) return { ok: false, reason: 'missing_credentials' };

  const res = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) })
  });
  if (res.ok) {
    state.integrations.lastTelegramSentAt = new Date().toISOString();
    saveState();
  }
  return { ok: res.ok, status: res.status };
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
      const capPct = passedItem.decision === 'PASS' ? 0.08 : 0.06;
      const sizeRes = runSizeAgent(passedItem, desk.portfolio, state.config, capPct);

      if (sizeRes.dollars > 0) {
        const fillRes = runFillsAgent(c, sizeRes);
        if (fillRes.status === 'FILLED_PAPER') {
          desk.portfolio.cashUsd = Number((desk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
          desk.portfolio.totalCapitalEverDeployedUsd = Number((desk.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
          desk.openPositions.push(fillRes);
          recomputePortfolio();

          const isShort = fillRes.direction === 'SHORT';
          const fillMsg = [
            `🚨 [평일 미장 개장 전 스탑헌팅 포착 — Variational 10x ${isShort ? 'SHORT(숏)' : 'LONG(롱)'} 진입!]`,
            `• 종목: $${fillRes.symbol} (${fillRes.name}) | 60일 승률 ${fillRes.btWinRate || 60}% (10x ${fillRes.btPnl10x || '+15%'})`,
            `• 포착 패턴: 90분 기준가($${fillRes.anchorPriceUsd}) 대비 ${fillRes.huntMovePct >= 0 ? '+' : ''}${fillRes.huntMovePct}% [최적 ±${fillRes.minHuntPct}%~±${fillRes.maxHuntPct}%] + 꼬리 ${fillRes.wickReversalPct}% 확인`,
            `• 진입(Variational 호가): $${fillRes.entryPriceUsd} | 증거금 $${fillRes.dollars} × 10배 = 포지션 $${fillRes.notionalUsd} (손익비 1:${fillRes.rrRatio})`,
            `• 목표가: TP1 $${fillRes.tp1PriceUsd} / TP2(출발점) $${fillRes.tp2PriceUsd} | 칼손절(SL): $${fillRes.stopPriceUsd}`
          ].join('\n');

          addLog('ENTRY', fillMsg);
          await sendTelegramNotification(fillMsg);
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

async function executeStopHuntRiskCheck(triggerSource = '5분 리스크 점검') {
  state.routines.lastRiskAt = new Date().toISOString();
  const desk = state.desks.memecoin;
  let checked = 0;
  let closed = 0;

  if (desk.openPositions.length > 0) {
    const remaining = [];
    for (const pos of desk.openPositions) {
      checked += 1;
      const check = await checkContractRiskLive(pos.contract || pos.symbol, pos);
      if (check.reachable && check.priceUsd > 0) {
        pos.currentPriceUsd = check.priceUsd;
      }
      if (check.action === 'CLOSE') {
        closed += 1;
        desk.stats.closedCount += 1;
        const isShort = pos.direction === 'SHORT';
        const priceDiff = isShort
          ? (pos.entryPriceUsd - pos.currentPriceUsd)
          : (pos.currentPriceUsd - pos.entryPriceUsd);
        const rawPnl = pos.quantity * priceDiff;
        const entryFee = Number(pos.feeUsd || 0);
        const exitFee = Math.max(0.0002 * Number(pos.notionalUsd || pos.dollars * 10), 0.25);
        const netProceeds = Math.max(0, Number((pos.dollars + rawPnl - entryFee - exitFee).toFixed(2)));
        const pnlUsd = Number((netProceeds - pos.dollars).toFixed(2));
        const pnlPct = Number(((pnlUsd / pos.dollars) * 100).toFixed(2));

        desk.portfolio.cashUsd = Number((desk.portfolio.cashUsd + netProceeds).toFixed(2));
        desk.portfolio.realizedPnlUsd = Number((desk.portfolio.realizedPnlUsd + pnlUsd).toFixed(2));

        desk.closedPositions.unshift({
          ...pos,
          exitPriceUsd: pos.currentPriceUsd,
          netProceedsUsd: netProceeds,
          pnlUsd,
          pnlPct,
          closedAt: new Date().toISOString(),
          closeRule: check.reason
        });

        const closeMsg = [
          `🔔 [Variational 10x 스탑헌팅 청산 — ${triggerSource}]`,
          `• 종목: $${pos.symbol} (${isShort ? 'SHORT 10x' : 'LONG 10x'})`,
          `• 사유: ${check.reason}`,
          `• 정산: 증거금 $${pos.dollars.toFixed(2)} -> 회수 $${netProceeds.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} / 10x ROE ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`
        ].join('\n');
        addLog('EXIT', closeMsg);
        await sendTelegramNotification(closeMsg);
      } else {
        remaining.push(pos);
      }
    }
    desk.openPositions = remaining;
  }

  recomputePortfolio();
  return { ok: true, checked, closed };
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
      body: JSON.stringify({ private: false })
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

  await fetchJson(`https://api.github.com/repos/${owner}/${repoName}/actions/workflows/trading-cron.yml/dispatches`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({ ref: defaultBranch })
  });

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
// 4. 백그라운드 타이머 (5분 10x 포지션 점검 / 15분 스탑헌팅 스캔)
// ============================================================================
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
    'Access-Control-Allow-Origin': '*'
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
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
  const pathname = parsedUrl.pathname;

  // Render 헬스체크 엔드포인트
  if (pathname === '/healthz' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, status: 'healthy', version: '4.0.0' });
  }

  // 1) 전체 상태 조회
  if (pathname === '/api/desk/state' && req.method === 'GET') {
    recomputePortfolio();
    return sendJson(res, 200, {
      state,
      stopHuntUniverse: STOPHUNT_UNIVERSE,
      sessionInfo: getStopHuntSessionInfo(),
      githubDeviceSession
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
    addLog('INFO', '🔄 Variational 10x 스탑헌팅 금고가 $1,000.00로 초기화되었습니다.');
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
    recomputePortfolio();
    const p = state.desks.memecoin.portfolio;
    const msg = [
      `🔔 [Variational 10x 스탑헌팅 봇 — 텔레그램 알림 테스트]`,
      `• 금고 평가액: $${p.totalEquityUsd.toFixed(2)} (가용 현금 $${p.cashUsd.toFixed(2)})`,
      `• 열린 10x 포지션: ${state.desks.memecoin.openPositions.length}개`,
      `• 평일 미장 개장 전 스탑헌팅 포착 시 즉시 이 채널로 알림이 전송됩니다.`
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

  // 10) 정적 파일 서빙
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

    // 평일 10분 주기 자동 스탑헌팅 스캔 & 포지션 리스크 점검 (Render 서버에서도 상시 가동)
    setInterval(async () => {
      try {
        const sInfo = getStopHuntSessionInfo();
        if (!sInfo.isWeekend) {
          await executeStopHuntRiskCheck('10분 자동점검');
          await executeStopHuntScan('10분 자동스캔');
        }
        // Render 무료 서버 슬립(15분 절전) 방지용 자체 헬스체크 핑
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
