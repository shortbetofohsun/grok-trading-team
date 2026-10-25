const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_GEMINI_KEY,
  RWA_SECTORS,
  RWA_UNIVERSE,
  ROLE_PROFILES_BY_DESK,
  BOT_PROMPTS,
  fetchJson,
  callGeminiAI,
  runChiefVerification,
  // 데스크 1 (밈코인 $1,000)
  runScanAgent,
  runVetAgent,
  runSizeAgent,
  runFillsAgent,
  calculateRiskFormula,
  checkContractRiskLive,
  // 데스크 2 (예측시장 괴리율 $1,000)
  runBookAgent,
  runPredictionFillsAgent,
  checkPredictionRiskLive,
  // 데스크 3 (RWA 차트·옵션감마 $1,000)
  analyzeRwaTicker,
  runRwaDeskScanAndVet,
  runRwaFillsAgent,
  checkRwaPositionsRiskLive
} = require('./agents');

const DEFAULT_TG_B64 = 'ODgxMDAzMTEzNzpBQUdyZ3JPZXB5SlJ6TE42OXpqbm1lV0RKQmlfWFY0Tkxidw==';
const DEFAULT_TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || Buffer.from(DEFAULT_TG_B64, 'base64').toString('utf-8');
const DEFAULT_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8417795671';

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'desk_state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

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
    totalEquityUsd: startingUsd,
    lastNotifiedPnlPct: 0
  };
}

function getDefaultState() {
  const nowIso = new Date().toISOString();
  return {
    version: '3.0.0',
    createdAt: nowIso,
    wmMode: 'READY',
    wmPort: 3000,
    integrations: {
      geminiApiKey: DEFAULT_GEMINI_KEY,
      geminiModel: 'gemini-3.5-flash',
      geminiStatus: 'ACTIVE (Gemini 3.5 Flash 연결됨)',
      telegramToken: DEFAULT_TELEGRAM_TOKEN,
      telegramChatId: DEFAULT_TELEGRAM_CHAT_ID,
      telegramBotUsername: '@dytradingdemo_bot',
      telegramEnabled: true,
      lastTelegramSentAt: null
    },
    config: {
      startingBalanceUsd: 1000,
      minLiquidityUsd: 10000,
      minPairAgeMinutes: 30,
      slippageBudgetPct: 0.02,
      minOrderUsd: 50,
      maxKellyCapPct: 0.06,
      maxTopWalletPct: 5.0
    },
    // 3대 데스크 각각의 독립 $1,000 금고 (총 $3,000 시드)
    desks: {
      memecoin: {
        id: 'memecoin',
        name: '🪙 크립토 밈코인 데스크',
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
          rejectionReasons: {},
          closedCount: 0
        }
      },
      prediction: {
        id: 'prediction',
        name: '🎯 예측시장 괴리율 데스크',
        portfolio: createVaultPortfolio(1000.00),
        openPositions: [],
        closedPositions: [],
        lastEvaluatedMarkets: [],
        lastVetRejected: [],
        stats: {
          scans: 0,
          evaluatedCount: 0,
          passedCount: 0,
          rejectedCount: 0,
          closedCount: 0
        }
      },
      rwa: {
        id: 'rwa',
        name: '🏛️ RWA 차트·옵션감마 데스크',
        portfolio: createVaultPortfolio(1000.00),
        openPositions: [],
        closedPositions: [],
        lastAnalyses: [],
        lastOverseasGaps: [],
        lastVetResults: [],
        stats: {
          scans: 0,
          evaluatedCount: 0,
          passedCount: 0,
          rejectedCount: 0,
          closedCount: 0
        }
      }
    },
    // 통합 합산 포트폴리오 ($3,000 총괄)
    totalCombinedPortfolio: {
      startingBalanceUsd: 3000.00,
      cashUsd: 3000.00,
      deployedUsd: 0.00,
      realizedPnlUsd: 0.00,
      unrealizedPnlUsd: 0.00,
      totalEquityUsd: 3000.00
    },
    // 하위 호환용 필드
    portfolio: createVaultPortfolio(1000.00),
    openPositions: [],
    closedPositions: [],
    predictionBets: [],
    lastScanCandidates: [],
    lastVetResults: [],
    lastVerification: null,
    routines: {
      scan15mEnabled: true,
      risk5mEnabled: true,
      dailyReport23hEnabled: true,
      lastScanAt: null,
      lastRiskAt: null,
      lastDailyReportAt: null
    },
    supervision: {
      CHIEF: { status: 'ONLINE (3-Desk AI)', failures: 0, restartsThisHour: 0, lastSeen: nowIso },
      SCAN: { status: 'ONLINE (Dex/Kalshi/Chart)', failures: 0, restartsThisHour: 0, lastSeen: nowIso },
      VET: { status: 'ONLINE (7-Rule/MTF/IV)', failures: 0, restartsThisHour: 0, lastSeen: nowIso },
      BOOK: { status: 'ONLINE (AI Edge/Gamma GEX)', failures: 0, restartsThisHour: 0, lastSeen: nowIso },
      SIZE: { status: 'ONLINE ($1K×3 Kelly)', failures: 0, restartsThisHour: 0, lastSeen: nowIso },
      FILLS: { status: 'ONLINE (Paper Logger)', failures: 0, restartsThisHour: 0, lastSeen: nowIso },
      RISK: { status: 'ONLINE (5m 3-Desk Exit)', failures: 0, restartsThisHour: 0, lastSeen: nowIso }
    },
    stats: {
      totalScans: 0,
      todayCandidatesCount: 0,
      todayRejectedCount: 0,
      todayPassedCount: 0,
      rejectionReasons: {},
      closedByRuleCount: 0
    },
    messages: [
      {
        id: 'msg_init_meme',
        desk: 'memecoin',
        sender: 'CHIEF',
        badge: '👑 밈코인 총괄',
        timestamp: nowIso,
        text: `[🪙 데스크 1: 크립토 밈코인 데스크 ($1,000.00 독립 금고) 가동]\n• SCAN(덱스 런치 속도) ➔ VET(Solana RPC + RugCheck 7단계 스캠 필터) ➔ SIZE(켈리 6% 상한) ➔ FILLS(수수료 하한 검증) ➔ RISK(5분 주기 6h/24h 거래량 비율 < 0.20 즉시 청산)`
      },
      {
        id: 'msg_init_pred',
        desk: 'prediction',
        sender: 'CHIEF',
        badge: '👑 괴리율총괄',
        timestamp: nowIso,
        text: `[🎯 데스크 2: 예측시장 괴리율 모의매매 데스크 ($1,000.00 독립 금고) 가동]\n• SCAN(Kalshi·Polymarket 실시간 마켓) ➔ VET(유동성·최신성 5단계 필터) ➔ BOOK(시장 가격을 가린 Gemini 3.5 Flash 블라인드 확률 추론 후 괴리율 >= 8% 포착) ➔ SIZE(괴리율 비례 켈리 배분) ➔ FILLS(YES/NO 컨트랙트 매수) ➔ RISK(괴리 수렴 익절 & 역행 손절)`
      },
      {
        id: 'msg_init_rwa',
        desk: 'rwa',
        sender: 'CHIEF',
        badge: '👑 RWA총괄',
        timestamp: nowIso,
        text: `[🏛️ 데스크 3: RWA 차트(켈트너·볼린저) & 옵션 감마(콜감마·숏감마) 데스크 ($1,000.00 독립 금고) 가동]\n• 대상: 실물 금(GLD), 은(SLV), 미국장기채(TLT), 원유(USO), 리츠(VNQ), SPY, QQQ, 반도체원물(SOXX), NVDA, IBIT\n• SCAN(tooja.me/chart 흰색 켈트너 채널 + 보라색 볼린저 스퀴즈 '꿈틀꿈틀 타점') ➔ VET(1H·10m 멀티타임프레임 & IV 지뢰밭 검증) ➔ BOOK(tooja.me/options 콜감마 Long Gamma vs 숏감마 Short Gamma Net GEX·콜벽·풋벽·맥스페인) ➔ SIZE ➔ FILLS(1차 보라상단·2차 흰색상단/콜벽 목표가) ➔ RISK(채널 이탈/목표 도달 자동 청산)`
      }
    ]
  };
}

let state = getDefaultState();
if (fs.existsSync(STATE_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (loaded && loaded.version === '3.0.0' && loaded.desks) {
      state = {
        ...getDefaultState(),
        ...loaded,
        integrations: {
          ...getDefaultState().integrations,
          ...(loaded.integrations || {}),
          geminiApiKey: loaded.integrations?.geminiApiKey || DEFAULT_GEMINI_KEY,
          telegramToken: loaded.integrations?.telegramToken || DEFAULT_TELEGRAM_TOKEN,
          telegramChatId: loaded.integrations?.telegramChatId || DEFAULT_TELEGRAM_CHAT_ID
        }
      };
    } else {
      // 구버전(v2.0) 장부에서 v3.0 멀티 데스크($1,000 × 3)로 자동 마이그레이션
      state = getDefaultState();
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
        geminiStatus: state.integrations?.geminiStatus || 'ACTIVE',
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

async function sendTelegramNotification(text, force = false) {
  const integ = state.integrations || {};
  if (!integ.telegramEnabled && !force) return { ok: false, reason: 'disabled' };
  const token = (integ.telegramToken || DEFAULT_TELEGRAM_TOKEN).trim();
  let chatId = (integ.telegramChatId || DEFAULT_TELEGRAM_CHAT_ID).trim();

  if (!token) return { ok: false, reason: 'no_token' };

  if (!chatId) {
    const upd = await fetchJson(`https://api.telegram.org/bot${token}/getUpdates`);
    const results = upd.data?.result || [];
    if (results.length > 0) {
      const lastMsg = results[results.length - 1].message || results[results.length - 1].channel_post;
      if (lastMsg?.chat?.id) {
        chatId = String(lastMsg.chat.id);
        state.integrations.telegramChatId = chatId;
      }
    }
  }

  if (!chatId) return { ok: false, reason: 'no_chat_id' };

  const res = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000)
    })
  });

  if (res.ok) {
    state.integrations.lastTelegramSentAt = new Date().toISOString();
    saveState();
  }
  return { ok: res.ok, status: res.status, chatId, data: res.data };
}

function addMessage(desk, sender, text) {
  const deskProfile = ROLE_PROFILES_BY_DESK[desk] || ROLE_PROFILES_BY_DESK.memecoin;
  const botMeta = deskProfile.bots?.[sender] || BOT_PROMPTS[sender] || { badge: '👤 사용자', color: '#94a3b8' };
  const msg = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    desk,
    sender,
    badge: botMeta.badge || '🤖',
    timestamp: new Date().toISOString(),
    text
  };
  state.messages.push(msg);
  if (state.messages.length > 350) {
    state.messages = state.messages.slice(-350);
  }
  if (state.supervision[sender]) {
    state.supervision[sender].lastSeen = msg.timestamp;
  }
  saveState();
  return msg;
}

/**
 * 3개 데스크($1,000 × 3) 각각의 포트폴리오 및 통합 포트폴리오($3,000) 재계산
 */
function recomputeAllPortfolios() {
  for (const deskKey of ['memecoin', 'prediction', 'rwa']) {
    const d = state.desks[deskKey];
    if (!d) continue;
    let deployed = 0;
    let unrealized = 0;
    for (const pos of d.openPositions) {
      const cost = Number(pos.dollars || 0);
      deployed += cost;
      const qty = Number(pos.quantity || 0);
      const entryP = Number(pos.entryPriceUsd || 0);
      const curP = Number(pos.currentPriceUsd || entryP);
      if (pos.direction === 'SHORT') {
        const fee = Number(pos.feeUsd || 0);
        const shortPnl = qty * (entryP - curP) - fee;
        unrealized += shortPnl;
      } else {
        const curVal = qty * curP;
        unrealized += (curVal - cost);
      }
    }
    d.portfolio.deployedUsd = Number(deployed.toFixed(2));
    d.portfolio.unrealizedPnlUsd = Number(unrealized.toFixed(2));
    d.portfolio.totalEquityUsd = Number((d.portfolio.cashUsd + deployed + unrealized).toFixed(2));
  }

  // 통합 포트폴리오 ($3,000 기준)
  const m = state.desks.memecoin.portfolio;
  const p = state.desks.prediction.portfolio;
  const r = state.desks.rwa.portfolio;

  state.totalCombinedPortfolio = {
    startingBalanceUsd: 3000.00,
    cashUsd: Number((m.cashUsd + p.cashUsd + r.cashUsd).toFixed(2)),
    deployedUsd: Number((m.deployedUsd + p.deployedUsd + r.deployedUsd).toFixed(2)),
    realizedPnlUsd: Number((m.realizedPnlUsd + p.realizedPnlUsd + r.realizedPnlUsd).toFixed(2)),
    unrealizedPnlUsd: Number((m.unrealizedPnlUsd + p.unrealizedPnlUsd + r.unrealizedPnlUsd).toFixed(2)),
    totalEquityUsd: Number((m.totalEquityUsd + p.totalEquityUsd + r.totalEquityUsd).toFixed(2))
  };

  // 하위 호환용 동기화
  state.portfolio = state.desks.memecoin.portfolio;
  state.openPositions = state.desks.memecoin.openPositions;
  state.closedPositions = state.desks.memecoin.closedPositions;
  state.predictionBets = state.desks.prediction.openPositions;
  saveState();
}

// ============================================================================
// 1. [데스크 1: 크립토 밈코인 데스크 ($1,000)] 파이프라인 실행
// ============================================================================
async function executeMemecoinDesk(triggerSource = '수동 실행') {
  const desk = state.desks.memecoin;
  desk.stats.scans += 1;
  state.stats.totalScans += 1;

  addMessage('memecoin', 'CHIEF', `▶️ [${triggerSource}] 🪙 밈코인 데스크($1,000 금고) 파이프라인 시작: SCAN -> VET -> SIZE -> FILLS -> RISK`);

  const scanOut = await runScanAgent(state.config, state.wmMode);
  desk.lastScanCandidates = scanOut.candidates;
  state.lastScanCandidates = scanOut.candidates;
  desk.stats.candidatesCount += scanOut.candidates.length;
  state.stats.todayCandidatesCount += scanOut.candidates.length;

  const scanSummaryLines = scanOut.candidates.map((c, idx) =>
    `${idx + 1}. $${c.symbol} (${c.contract.slice(0, 6)}...${c.contract.slice(-4)}) | 속도점수: ${c.velocityScore} | 유동성: $${c.liquidityUsd.toLocaleString()} | m5 매수/매도: ${c.txnsM5.buys}/${c.txnsM5.sells} | h1: ${c.priceChangeH1 >= 0 ? '+' : ''}${c.priceChangeH1}% | holders: ${c.holders !== null ? c.holders.toLocaleString() : 'null'}`
  );

  addMessage(
    'memecoin',
    'SCAN',
    `🔍 [덱스스크리너 후보 스캔 완료]\n- 스캔 원본: ${scanOut.rawScannedCount}개 페어 (사전제외: ${scanOut.skippedByScanCount}개)\n- 속도 순위 상위 후보 (${scanOut.candidates.length}개):\n${scanSummaryLines.length ? scanSummaryLines.join('\n') : '(기준 통과 후보 없음)'}`
  );

  const plannedOrderEst = Math.max(state.config.minOrderUsd, Number((desk.portfolio.totalEquityUsd * state.config.maxKellyCapPct).toFixed(2)));
  const vetOut = await runVetAgent(scanOut.candidates, state.config, plannedOrderEst);
  desk.lastVetResults = vetOut.results;
  state.lastVetResults = vetOut.results;
  desk.stats.rejectedCount += vetOut.rejectedCount;
  desk.stats.passedCount += vetOut.passedCount;
  state.stats.todayRejectedCount += vetOut.rejectedCount;
  state.stats.todayPassedCount += vetOut.passedCount;

  for (const r of vetOut.rejected) {
    const key = `규칙 ${r.failedRule}`;
    desk.stats.rejectionReasons[key] = (desk.stats.rejectionReasons[key] || 0) + 1;
    state.stats.rejectionReasons[key] = (state.stats.rejectionReasons[key] || 0) + 1;
  }

  const vetLines = vetOut.results.map(r => `• $${r.symbol}: [${r.decision}] — ${r.reason}`);
  addMessage(
    'memecoin',
    'VET',
    `🛡️ [7단계 순차 탈락 심사 결과] 검사 ${vetOut.totalEvaluated}개 중 통과 ${vetOut.passedCount}개 / 탈락 ${vetOut.rejectedCount}개\n${vetLines.join('\n')}`
  );

  if (vetOut.passed.length === 0) {
    addMessage('memecoin', 'CHIEF', `⏹️ VET을 통과한 후보가 없어 밈코인 금고($${desk.portfolio.cashUsd.toFixed(2)})를 100% 보호했습니다.`);
  } else {
    for (const passedItem of vetOut.passed) {
      if (desk.openPositions.some(p => p.contract === passedItem.contract)) {
        addMessage('memecoin', 'SIZE', `⏭️ $${passedItem.symbol}: 이미 보유 중이므로 중복 매수하지 않습니다.`);
        continue;
      }
      const sizeRes = runSizeAgent(passedItem, desk.portfolio, state.config, 0.06);
      addMessage('memecoin', 'SIZE', `📐 [$${passedItem.symbol} 크기 산정] $${sizeRes.dollars} (${sizeRes.reason})`);

      if (sizeRes.dollars > 0) {
        const fillRes = runFillsAgent(passedItem.candidate, sizeRes, state.config);
        if (fillRes.status === 'FILLED_PAPER') {
          desk.portfolio.cashUsd = Number((desk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
          desk.portfolio.totalCapitalEverDeployedUsd = Number((desk.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
          desk.openPositions.push(fillRes);
          recomputeAllPortfolios();

          const fillMsg = [
            `📝 [🪙 밈코인 데스크 FILLS 모의 매수 체결]`,
            `• 종목: $${fillRes.symbol} (${fillRes.name})`,
            `• 계약 주소: ${fillRes.contract}`,
            `• 진입가: $${fillRes.entryPriceUsd} | 주문 크기: $${fillRes.dollars} | 수수료: $${fillRes.feeUsd}`,
            `• 밈코인 금고 잔여 현금: $${desk.portfolio.cashUsd.toFixed(2)}`
          ].join('\n');

          addMessage('memecoin', 'FILLS', fillMsg);
          await sendTelegramNotification(fillMsg);
        } else {
          addMessage('memecoin', 'FILLS', `🚫 [$${passedItem.symbol} 체결 반려 - ${fillRes.status}] ${fillRes.reason}`);
        }
      }
    }
  }

  recomputeAllPortfolios();
  return { scanned: scanOut.candidates.length, passed: vetOut.passedCount, rejected: vetOut.rejectedCount };
}

// ============================================================================
// 2. [데스크 2: 예측시장 괴리율 데스크 ($1,000)] 파이프라인 실행
// ============================================================================
async function executePredictionDesk(triggerSource = '수동 실행') {
  const desk = state.desks.prediction;
  desk.stats.scans += 1;

  addMessage('prediction', 'CHIEF', `▶️ [${triggerSource}] 🎯 예측시장 괴리율 데스크($1,000 금고) 파이프라인 시작: SCAN -> VET -> BOOK(블라인드 확률 추론) -> SIZE -> FILLS`);

  const existingIds = new Set(desk.openPositions.map(p => p.marketId));
  const bookOut = await runBookAgent(state.wmPort, desk.openPositions.length, state.integrations.geminiApiKey, existingIds);

  if (bookOut.status === 'RESTING' || bookOut.status === 'MAX_BETS_REACHED') {
    addMessage('prediction', 'BOOK', `⏸️ [BOOK 대기] ${bookOut.reason}`);
    return { evaluated: 0, entered: 0 };
  }

  desk.lastEvaluatedMarkets = bookOut.evaluatedMarkets || [];
  desk.lastVetRejected = bookOut.vetRejected || [];
  desk.stats.evaluatedCount += (bookOut.evaluatedCount || 0);
  desk.stats.rejectedCount += (bookOut.vetRejectedCount || 0);
  desk.stats.passedCount += (bookOut.proposals?.length || 0);

  // 1) SCAN 보고
  addMessage(
    'prediction',
    'SCAN',
    `🔍 [Kalshi · Polymarket 오픈 마켓 스캔 완료]\n- 수집된 원시 마켓: ${bookOut.scannedRawCount}개 (Kalshi HTTP ${bookOut.kalshiStatus} / Polymarket HTTP ${bookOut.polymarketStatus})`
  );

  // 2) VET 보고
  const rejLines = (bookOut.vetRejected || []).slice(0, 5).map(r => `• [${r.source}] "${r.question.slice(0, 48)}..." -> 탈락(${r.reason})`);
  addMessage(
    'prediction',
    'VET',
    `🛡️ [예측시장 적격성 5단계 필터 완료] 적격 통과 ${bookOut.evaluatedCount}개 / 부적격 탈락 ${bookOut.vetRejectedCount}개\n${rejLines.join('\n') || '(부적격 마켓 없음)'}`
  );

  // 3) BOOK 괴리율 비교 보고
  const evalLines = (bookOut.evaluatedMarkets || []).map(m =>
    `• [${m.source}] "${m.question.slice(0, 55)}..."\n   ↳ 내 추론(${m.side}): ${(m.myProb * 100).toFixed(1)}% vs 시장가격: ${(m.marketPrice * 100).toFixed(1)}% | 괴리율: ${m.edgePct}% ${m.actionable ? '🔥 [>=8% 진입 타겟!]' : '(8% 미만 관망)'}\n   ↳ 근거: ${m.reasoning}`
  );
  addMessage(
    'prediction',
    'BOOK',
    `📊 [Gemini AI 블라인드 확률 vs 시장 가격 괴리율 대조 결과]\n${evalLines.join('\n') || '(비교 가능한 마켓 없음)'}`
  );

  // 4) SIZE & 5) FILLS: 괴리율 8% 이상 마켓 실제 모의 체결 ($1,000 예측시장 금고에서 차감!)
  let enteredCount = 0;
  for (const prop of (bookOut.proposals || [])) {
    if (desk.openPositions.some(p => p.marketId === prop.marketId)) continue;
    // 괴리율이 클수록 최대 8%($80)까지 배분
    const capPct = prop.edgePct >= 15 ? 0.08 : 0.06;
    const sizeRes = runSizeAgent({ myProb: prop.myProb, liquidityUsd: prop.liquidityUsd, payoffRatio: 1.8 }, desk.portfolio, state.config, capPct);
    addMessage('prediction', 'SIZE', `📐 [괴리율 ${prop.edgePct}% 포지션 크기 산정] $${sizeRes.dollars} (${sizeRes.reason})`);

    if (sizeRes.dollars > 0) {
      const fillRes = runPredictionFillsAgent(prop, sizeRes);
      if (fillRes.status === 'FILLED_PAPER') {
        desk.portfolio.cashUsd = Number((desk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
        desk.portfolio.totalCapitalEverDeployedUsd = Number((desk.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
        desk.openPositions.push(fillRes);
        enteredCount += 1;
        recomputeAllPortfolios();

        const fillMsg = [
          `📝 [🎯 예측시장 괴리율 데스크 FILLS 모의 체결]`,
          `• 마켓: "${fillRes.question}" (${fillRes.source})`,
          `• 방향: ${fillRes.side} 컨트랙트 (${fillRes.quantity}주)`,
          `• 진입단가: $${fillRes.entryPriceUsd} vs 내 추정확률: ${(fillRes.myProb * 100).toFixed(1)}% (괴리율 +${fillRes.edgePct}%)`,
          `• 수렴 익절목표가: $${fillRes.targetPriceUsd} | 역행 손절가: $${fillRes.stopPriceUsd}`,
          `• 투자금: $${fillRes.dollars} (수수료 $${fillRes.feeUsd}) | 예측시장 금고 잔여현금: $${desk.portfolio.cashUsd.toFixed(2)}`,
          `• 추론 근거: ${fillRes.reasoning}`
        ].join('\n');

        addMessage('prediction', 'FILLS', fillMsg);
        await sendTelegramNotification(fillMsg);
      }
    }
  }

  recomputeAllPortfolios();
  return { evaluated: bookOut.evaluatedCount, entered: enteredCount };
}

// ============================================================================
// 3. [데스크 3: RWA & 7대 섹터 개별주(우주·방산·바이오·반도체·광통신·로봇) 데스크 ($1,000)] 파이프라인 실행
// ============================================================================
async function executeRwaDesk(triggerSource = '수동 실행', sectorFilter = 'all') {
  const desk = state.desks.rwa;
  desk.stats.scans += 1;

  const sectorMeta = RWA_SECTORS[sectorFilter] || RWA_SECTORS.all;
  addMessage('rwa', 'CHIEF', `▶️ [${triggerSource}] 🏛️ 데스크 3 (${sectorMeta.label} · $1,000 금고) 차트(켈트너·볼린저) & 옵션 감마(콜/숏감마) 스캔·검증 시작`);

  const existingSymbols = new Set(desk.openPositions.map(p => p.symbol));
  const rwaOut = await runRwaDeskScanAndVet(existingSymbols, state.integrations.geminiApiKey, sectorFilter);

  desk.lastSectorFilter = rwaOut.sectorFilter || 'all';
  desk.lastSectorSummary = rwaOut.sectorSummary || {};
  desk.lastAnalyses = rwaOut.analyses || [];
  desk.lastOverseasGaps = rwaOut.overseasGaps || [];
  desk.lastVetResults = rwaOut.vetResults || [];
  desk.stats.evaluatedCount += rwaOut.scannedCount;
  desk.stats.passedCount += rwaOut.passed.length;
  desk.stats.rejectedCount += rwaOut.rejected.length;

  // 1) SCAN 보고 (섹터별 대장주 요약 + 상위 10개 타점 후보)
  const secSummaryLines = Object.values(rwaOut.sectorSummary || {}).map(s =>
    `• ${s.label}: 스캔 ${s.count}개 (스퀴즈 ${s.squeezeCount}개 | 🟢롱 ${s.longCount} / 🔴숏 ${s.shortCount}) ➔ 최우선: $${s.topSymbol} (${s.topDirection}, ${s.topScore}점)`
  );
  const scanLines = rwaOut.analyses.slice(0, 12).map((a, idx) =>
    `${idx + 1}. [${a.category}] $${a.symbol} ($${a.spot}) | ${a.tradeSetup.direction === 'SHORT' ? '🔴SHORT' : '🟢LONG'} | 1H 위치 ${a.chart.channelPos1hPct}% | 스퀴즈=${a.chart.purpleInsideWhite1h ? 'YES(꿈틀꿈틀)' : 'NO'} | ${a.tradeSetup.score}점`
  );
  const gapLines = (rwaOut.overseasGaps || []).slice(0, 4).map(g => `• ${g.label}: 해외 $${g.price} vs 국내 ₩${g.domWon} (괴리율 ${g.diff})`);

  addMessage(
    'rwa',
    'SCAN',
    `🔍 [${rwaOut.sectorLabel} — 총 ${rwaOut.scannedCount}개 종목 켈트너·볼린저 이중채널 스캔 완료]\n` +
    (secSummaryLines.length > 1 ? `[섹터별 최우선 타점 요약]\n${secSummaryLines.join('\n')}\n\n` : '') +
    `[상위 타점 랭킹 Top 12]\n${scanLines.join('\n')}` +
    (gapLines.length ? `\n\n🌐 [해외시장 원주/ADR 괴리율 모니터]\n${gapLines.join('\n')}` : '')
  );

  // 2) VET 보고 (멀티타임프레임 1H/10m & 손익비 & IV 열지도 5단계 검증)
  const vetLines = rwaOut.vetResults.slice(0, 14).map(v => `• [${v.category || 'RWA'}] $${v.symbol}: [${v.decision}] — ${v.reason}`);
  addMessage(
    'rwa',
    'VET',
    `🛡️ [섹터 개별주 & RWA 5단계 검증 완료] 전체 ${rwaOut.scannedCount}개 중 통과 ${rwaOut.passed.length}개 / 탈락 ${rwaOut.rejected.length}개\n${vetLines.join('\n')}`
  );

  // 3) BOOK (GAMMA) 보고 (콜감마 vs 숏감마 Net GEX, 콜벽/풋벽, 맥스페인)
  const gammaLines = rwaOut.analyses.slice(0, 8).map(a =>
    `• [${a.category}] $${a.symbol} ($${a.spot}): ${a.options.gammaRegimeLabel}\n   ↳ 콜벽: $${a.options.callWall} | 풋벽: $${a.options.putWall} | 감마플립: $${a.options.gammaFlip} | 맥스페인: $${a.options.maxPain} | IV: ${a.options.avgIvPct}%`
  );
  addMessage(
    'rwa',
    'BOOK',
    `📊 [tooja.me/options 섹터별 콜감마(Long Gamma) · 숏감마(Short Gamma) · 맥스페인 분석]\n${gammaLines.join('\n')}${rwaOut.aiComment ? `\n\n${rwaOut.aiComment}` : ''}`
  );

  // 4) SIZE & 5) FILLS: 상위 통과 종목 모의 매매 (LONG & SHORT 양방향 + 섹터 분산, 최대 8개 포지션 운용)
  let enteredCount = 0;
  const maxRwaPositions = 8;
  if (desk.openPositions.length >= maxRwaPositions) {
    addMessage('rwa', 'SIZE', `⏸️ 현재 데스크 3 열린 포지션이 ${maxRwaPositions}개(최대 한도)이므로 신규 진입을 보류합니다.`);
  } else {
    const usedSectors = new Set(desk.openPositions.map(p => p.sector));
    const selectedToEnter = [];
    // 1순위: 아직 보유하지 않은 섹터의 최우수 LONG 및 최우수 SHORT 선정 (섹터별 분산 진입)
    const topLongNewSec = rwaOut.passed.find(p => p.analysis?.tradeSetup?.direction === 'LONG' && !usedSectors.has(p.sector));
    const topShortNewSec = rwaOut.passed.find(p => p.analysis?.tradeSetup?.direction === 'SHORT' && !usedSectors.has(p.sector));
    const topLong = topLongNewSec || rwaOut.passed.find(p => p.analysis?.tradeSetup?.direction === 'LONG');
    const topShort = topShortNewSec || rwaOut.passed.find(p => p.analysis?.tradeSetup?.direction === 'SHORT');

    if (topLong) {
      selectedToEnter.push(topLong);
      usedSectors.add(topLong.sector);
    }
    if (topShort && (!topLong || topShort.symbol !== topLong.symbol)) {
      selectedToEnter.push(topShort);
      usedSectors.add(topShort.sector);
    }
    // 2순위: 다른 섹터에서 점수가 가장 높은 통과 종목 추가 (1회 스캔당 최대 4개 섹터 분산 진입)
    for (const p of rwaOut.passed) {
      if (selectedToEnter.length >= 4) break;
      if (!selectedToEnter.some(s => s.symbol === p.symbol) && !usedSectors.has(p.sector)) {
        selectedToEnter.push(p);
        usedSectors.add(p.sector);
      }
    }
    for (const p of rwaOut.passed) {
      if (selectedToEnter.length >= 3) break;
      if (!selectedToEnter.some(s => s.symbol === p.symbol)) selectedToEnter.push(p);
    }

    for (const item of selectedToEnter) {
      if (desk.openPositions.length >= maxRwaPositions) break;
      const a = item.analysis;
      if (desk.openPositions.some(p => p.symbol === a.symbol)) continue;

      const dir = a.tradeSetup.direction || 'LONG';
      const capPct = a.options.gammaRegime === 'LONG_GAMMA' ? 0.10 : 0.06;
      const sizeRes = runSizeAgent(
        { decision: 'PASS', myProb: 0.62, payoffRatio: Math.max(1.4, a.tradeSetup.rrRatio), liquidityUsd: 500000 },
        desk.portfolio,
        state.config,
        capPct
      );

      addMessage('rwa', 'SIZE', `📐 [$${a.symbol} (${a.category}) ${dir === 'SHORT' ? '🔴 SHORT' : '🟢 LONG'} 감마 사이징] ${a.options.gammaRegime === 'LONG_GAMMA' ? '콜감마 안정장(상한 10%)' : '숏감마 변동성장(상한 6%)'} -> $${sizeRes.dollars} 배분`);

      if (sizeRes.dollars > 0) {
        const fillRes = runRwaFillsAgent(a, sizeRes, enteredCount === 0 ? rwaOut.aiComment : null);
        if (fillRes.status === 'FILLED_PAPER') {
          desk.portfolio.cashUsd = Number((desk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
          desk.portfolio.totalCapitalEverDeployedUsd = Number((desk.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
          desk.openPositions.push(fillRes);
          enteredCount += 1;
          recomputeAllPortfolios();

          const isShort = fillRes.direction === 'SHORT';
          const fillMsg = [
            `📝 [🏛️ 데스크 3 (${fillRes.category}) FILLS 모의 체결 — ${isShort ? '🔴 SHORT(숏)' : '🟢 LONG(롱)'}]`,
            `• 종목: $${fillRes.symbol} (${fillRes.name})`,
            `• 섹터/분류: ${fillRes.category}`,
            `• 포지션 방향: ${isShort ? '🔴 SHORT (하락 베팅)' : '🟢 LONG (상승 베팅)'}`,
            `• 전략: ${fillRes.setupName}`,
            `• 감마 레짐: ${fillRes.gammaRegimeLabel}`,
            `• 진입가: $${fillRes.entryPriceUsd} | 수량: ${fillRes.quantity}주 | 증거금: $${fillRes.dollars}`,
            `• 목표/손절 라인:`,
            `  - 1차 익절(${isShort ? '보라색 볼린저 하단' : '보라색 볼린저 상단'}): $${fillRes.tp1PriceUsd}`,
            `  - 2차 익절(${isShort ? '흰색 켈트너 하단/풋벽·맥스페인' : '흰색 켈트너 상단/콜벽'}): $${fillRes.tp2PriceUsd} (맥스페인 $${fillRes.maxPain})`,
            `  - 손절 라인(${isShort ? '흰색 상단 돌파' : '흰색 하단 이탈'}): $${fillRes.stopPriceUsd}`,
            `• 데스크 3 금고 잔여 현금: $${desk.portfolio.cashUsd.toFixed(2)}`
          ].join('\n');

          addMessage('rwa', 'FILLS', fillMsg);
          await sendTelegramNotification(fillMsg);
        }
      }
    }
  }

  recomputeAllPortfolios();
  return { sectorFilter: rwaOut.sectorFilter, scanned: rwaOut.scannedCount, passed: rwaOut.passed.length, entered: enteredCount };
}

/**
 * 전체 또는 개별 데스크 통합 파이프라인 실행
 */
let pipelineRunning = false;
async function executeTradingPipeline(triggerSource = '수동 실행', targetDesk = 'all', sectorFilter = 'all') {
  if (pipelineRunning) {
    return { ok: false, message: '이미 파이프라인이 실행 중입니다.' };
  }
  pipelineRunning = true;
  try {
    state.routines.lastScanAt = new Date().toISOString();
    const out = {};

    if (targetDesk === 'all' || targetDesk === 'memecoin') {
      out.memecoin = await executeMemecoinDesk(triggerSource);
    }
    if (targetDesk === 'all' || targetDesk === 'prediction') {
      out.prediction = await executePredictionDesk(triggerSource);
    }
    if (targetDesk === 'all' || targetDesk === 'rwa') {
      out.rwa = await executeRwaDesk(triggerSource, sectorFilter);
    }

    recomputeAllPortfolios();
    return {
      ok: true,
      targetDesk,
      sectorFilter,
      results: out,
      totalCombinedEquityUsd: state.totalCombinedPortfolio.totalEquityUsd
    };
  } finally {
    pipelineRunning = false;
  }
}

/**
 * 3대 데스크 통합 5분 RISK 점검 루틴 (밈코인 거래량 급감 + 예측시장 괴리 수렴/손절 + RWA 채널 상하단/감마 청산)
 */
async function executeRiskRoutine(triggerSource = '5분 루틴') {
  state.routines.lastRiskAt = new Date().toISOString();
  let totalChecked = 0;
  let totalClosed = 0;

  // --------------------------------------------------------------------------
  // 1) 데스크 1 (밈코인) RISK 점검
  // --------------------------------------------------------------------------
  const memeDesk = state.desks.memecoin;
  if (memeDesk.openPositions.length > 0) {
    const remaining = [];
    for (const pos of memeDesk.openPositions) {
      totalChecked += 1;
      const check = await checkContractRiskLive(pos.contract);
      if (check.reachable && check.priceUsd > 0) {
        pos.currentPriceUsd = check.priceUsd;
      }
      if (check.action === 'CLOSE') {
        totalClosed += 1;
        memeDesk.stats.closedCount += 1;
        state.stats.closedByRuleCount += 1;

        const grossValue = pos.quantity * pos.currentPriceUsd;
        const exitFee = Math.max(0.0045 * grossValue, 0.95);
        const netProceeds = Math.max(0, Number((grossValue - exitFee).toFixed(2)));
        const pnlUsd = Number((netProceeds - pos.dollars).toFixed(2));
        const pnlPct = Number(((pnlUsd / pos.dollars) * 100).toFixed(2));

        memeDesk.portfolio.cashUsd = Number((memeDesk.portfolio.cashUsd + netProceeds).toFixed(2));
        memeDesk.portfolio.realizedPnlUsd = Number((memeDesk.portfolio.realizedPnlUsd + pnlUsd).toFixed(2));

        const closedRec = {
          ...pos,
          exitPriceUsd: pos.currentPriceUsd,
          netProceedsUsd: netProceeds,
          pnlUsd,
          pnlPct,
          closedAt: new Date().toISOString(),
          closeRule: check.reachable ? `거래량 급감 규칙 (ratio ${check.ratio} < 0.20)` : '데이터 응답 불능 즉시 청산'
        };
        memeDesk.closedPositions.unshift(closedRec);

        const closeMsg = [
          `🚨 [🪙 밈코인 데스크 RISK 강제 청산 — ${triggerSource}]`,
          `• 종목: $${pos.symbol} (${pos.contract})`,
          `• 계산식:\n${check.formattedLine}`,
          `• 정산: 진입 $${pos.dollars.toFixed(2)} -> 회수 $${netProceeds.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} / ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`
        ].join('\n');
        addMessage('memecoin', 'RISK', closeMsg);
        await sendTelegramNotification(closeMsg);
      } else {
        remaining.push(pos);
      }
    }
    memeDesk.openPositions = remaining;
  }

  // --------------------------------------------------------------------------
  // 2) 데스크 2 (예측시장 괴리율) RISK 점검
  // --------------------------------------------------------------------------
  const predDesk = state.desks.prediction;
  if (predDesk.openPositions.length > 0) {
    const predChecks = await checkPredictionRiskLive(predDesk.openPositions);
    const remainingPred = [];
    for (const pos of predDesk.openPositions) {
      totalChecked += 1;
      const chk = predChecks.find(c => c.id === pos.id);
      if (chk) {
        pos.currentPriceUsd = chk.currentPriceUsd;
        pos.currentEdgePct = chk.currentEdgePct;
      }
      if (chk && chk.action === 'CLOSE') {
        totalClosed += 1;
        predDesk.stats.closedCount += 1;

        const grossValue = pos.quantity * pos.currentPriceUsd;
        const exitFee = Math.max(0.005 * grossValue, 0.50);
        const netProceeds = Math.max(0, Number((grossValue - exitFee).toFixed(2)));
        const pnlUsd = Number((netProceeds - pos.dollars).toFixed(2));
        const pnlPct = Number(((pnlUsd / pos.dollars) * 100).toFixed(2));

        predDesk.portfolio.cashUsd = Number((predDesk.portfolio.cashUsd + netProceeds).toFixed(2));
        predDesk.portfolio.realizedPnlUsd = Number((predDesk.portfolio.realizedPnlUsd + pnlUsd).toFixed(2));

        predDesk.closedPositions.unshift({
          ...pos,
          exitPriceUsd: pos.currentPriceUsd,
          netProceedsUsd: netProceeds,
          pnlUsd,
          pnlPct,
          closedAt: new Date().toISOString(),
          closeRule: chk.reason
        });

        const msg = [
          `🔔 [🎯 예측시장 데스크 RISK 청산 — ${triggerSource}]`,
          `• 질문: "${pos.question}" (${pos.side})`,
          `• 사유: ${chk.reason}`,
          `• 정산: 진입 $${pos.dollars.toFixed(2)} -> 회수 $${netProceeds.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} / ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`
        ].join('\n');
        addMessage('prediction', 'RISK', msg);
        await sendTelegramNotification(msg);
      } else {
        remainingPred.push(pos);
      }
    }
    predDesk.openPositions = remainingPred;
  }

  // --------------------------------------------------------------------------
  // 3) 데스크 3 (RWA 차트·옵션감마) RISK 점검
  // --------------------------------------------------------------------------
  const rwaDesk = state.desks.rwa;
  if (rwaDesk.openPositions.length > 0) {
    const rwaChecks = await checkRwaPositionsRiskLive(rwaDesk.openPositions);
    const remainingRwa = [];
    for (const pos of rwaDesk.openPositions) {
      totalChecked += 1;
      const chk = rwaChecks.find(c => c.id === pos.id);
      if (chk) {
        pos.currentPriceUsd = chk.currentPriceUsd;
      }
      if (chk && chk.action === 'CLOSE') {
        totalClosed += 1;
        rwaDesk.stats.closedCount += 1;

        const isShort = pos.direction === 'SHORT';
        const grossValue = isShort
          ? (pos.dollars + pos.quantity * (pos.entryPriceUsd - pos.currentPriceUsd))
          : (pos.quantity * pos.currentPriceUsd);
        const exitFee = Math.max(0.0015 * Math.max(0, grossValue), 0.35);
        const netProceeds = Math.max(0, Number((grossValue - exitFee).toFixed(2)));
        const pnlUsd = Number((netProceeds - pos.dollars).toFixed(2));
        const pnlPct = Number(((pnlUsd / pos.dollars) * 100).toFixed(2));

        rwaDesk.portfolio.cashUsd = Number((rwaDesk.portfolio.cashUsd + netProceeds).toFixed(2));
        rwaDesk.portfolio.realizedPnlUsd = Number((rwaDesk.portfolio.realizedPnlUsd + pnlUsd).toFixed(2));

        rwaDesk.closedPositions.unshift({
          ...pos,
          exitPriceUsd: pos.currentPriceUsd,
          netProceedsUsd: netProceeds,
          pnlUsd,
          pnlPct,
          closedAt: new Date().toISOString(),
          closeRule: chk.reason
        });

        const msg = [
          `🔔 [🏛️ RWA 차트·옵션감마 데스크 RISK 청산 — ${triggerSource}]`,
          `• 종목: $${pos.symbol} (${isShort ? '🔴 SHORT' : '🟢 LONG'})`,
          `• 사유: ${chk.reason}`,
          `• 정산: 진입 $${pos.dollars.toFixed(2)} -> 회수 $${netProceeds.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} / ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`
        ].join('\n');
        addMessage('rwa', 'RISK', msg);
        await sendTelegramNotification(msg);
      } else {
        remainingRwa.push(pos);
      }
    }
    rwaDesk.openPositions = remainingRwa;
  }

  recomputeAllPortfolios();
  return { ok: true, checked: totalChecked, closed: totalClosed };
}

/**
 * 3대 데스크 통합 마감 보고서 생성 ($1,000 + $1,000 + $1,000 = $3,000 총괄)
 */
async function generateDailyCloseReport(triggerSource = '마감 보고') {
  state.routines.lastDailyReportAt = new Date().toISOString();
  recomputeAllPortfolios();

  const m = state.desks.memecoin;
  const p = state.desks.prediction;
  const r = state.desks.rwa;
  const tot = state.totalCombinedPortfolio;
  const totalPnl = Number((tot.realizedPnlUsd + tot.unrealizedPnlUsd).toFixed(2));

  const aiPrompt = [
    `너는 3대 멀티 데스크(크립토 밈코인 $1,000 + 예측시장 괴리율 $1,000 + RWA 차트/옵션감마 $1,000 = 총 $3,000)를 총괄하는 CHIEF다.`,
    `아래 실시간 성과를 바탕으로 3문장 이내의 명쾌한 한국어 총평을 작성하라:`,
    `- 통합 총 평가액: $${tot.totalEquityUsd.toFixed(2)} (총 손익: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)})`,
    `- 데스크 1 (밈코인): 평가액 $${m.portfolio.totalEquityUsd.toFixed(2)}, 열린 포지션 ${m.openPositions.length}개, 스캠 탈락 ${m.stats.rejectedCount}개`,
    `- 데스크 2 (예측시장 괴리율): 평가액 $${p.portfolio.totalEquityUsd.toFixed(2)}, 열린 베팅 ${p.openPositions.length}개`,
    `- 데스크 3 (RWA 켈트너·볼린저 & 콜/숏감마): 평가액 $${r.portfolio.totalEquityUsd.toFixed(2)}, 열린 포지션 ${r.openPositions.length}개`
  ].join('\n');

  let aiCommentary = '';
  const aiRes = await callGeminiAI(aiPrompt, state.integrations.geminiApiKey, 8000);
  if (aiRes.ok && aiRes.text) {
    aiCommentary = `\n🧠 [CHIEF (Gemini AI) 멀티 데스크 총평]\n${aiRes.text}`;
  }

  const reportText = [
    `📋 [CHIEF 3대 데스크 통합 마감 보고 (${triggerSource})]`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 통합 총 자산 (시작 $3,000.00 ➔ 현재 $${tot.totalEquityUsd.toFixed(2)} | 총 손익 ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)})`,
    ``,
    `1️⃣ [🪙 데스크 1: 크립토 밈코인 금고 ($1,000)]`,
    `   • 현재 평가액: $${m.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${m.portfolio.cashUsd.toFixed(2)} / 운용 중 $${m.portfolio.deployedUsd.toFixed(2)})`,
    `   • 스캔/검증: 후보 ${m.stats.candidatesCount}개 중 통과 ${m.stats.passedCount}개 / 7단계 탈락 ${m.stats.rejectedCount}개`,
    `   • 보유 포지션(${m.openPositions.length}개): ${m.openPositions.map(x => `$${x.symbol}($${x.dollars})`).join(', ') || '없음'}`,
    ``,
    `2️⃣ [🎯 데스크 2: 예측시장 괴리율 금고 ($1,000)]`,
    `   • 현재 평가액: $${p.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${p.portfolio.cashUsd.toFixed(2)} / 운용 중 $${p.portfolio.deployedUsd.toFixed(2)})`,
    `   • 괴리율(>=8%) 포지션(${p.openPositions.length}개): ${p.openPositions.map(x => `${x.side} "${x.question.slice(0, 22)}.."(괴리 ${x.edgePct}%)`).join(', ') || '없음'}`,
    ``,
    `3️⃣ [🏛️ 데스크 3: RWA 차트·옵션감마 금고 ($1,000)]`,
    `   • 현재 평가액: $${r.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${r.portfolio.cashUsd.toFixed(2)} / 운용 중 $${r.portfolio.deployedUsd.toFixed(2)})`,
    `   • 켈트너·볼린저 & 콜/숏감마 포지션(${r.openPositions.length}개): ${r.openPositions.map(x => `$${x.symbol}($${x.dollars}, TP1 $${x.tp1PriceUsd}/TP2 $${x.tp2PriceUsd})`).join(', ') || '없음'}${aiCommentary}`
  ].join('\n');

  addMessage('memecoin', 'CHIEF', reportText);
  addMessage('prediction', 'CHIEF', reportText);
  addMessage('rwa', 'CHIEF', reportText);
  await sendTelegramNotification(reportText);
  return reportText;
}

/**
 * 데모/테스트용 샘플 모의 포지션(BONK) 체결 — 중복 매수 원천 차단
 */
async function createSamplePositionIfRequested(contract = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263') {
  const memeDesk = state.desks.memecoin;
  const existing = memeDesk.openPositions.find(p => p.contract === contract);
  if (existing) {
    const check = await checkContractRiskLive(contract);
    const msg = `⚠️ [중복 매수 방지 작동] $${existing.symbol} 포지션($${existing.dollars})이 이미 열려 있습니다!\n${check.formattedLine}`;
    addMessage('memecoin', 'SIZE', msg);
    return { ok: false, duplicatePrevented: true, message: msg };
  }

  const res = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(contract)}`);
  if (!res.ok || !Array.isArray(res.data?.pairs) || res.data.pairs.length === 0) {
    return { ok: false, error: '덱스스크리너에서 토큰 정보를 가져오지 못했습니다.' };
  }
  const pair = res.data.pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
  const cand = {
    symbol: pair.baseToken?.symbol || 'TOKEN',
    name: pair.baseToken?.name || 'Token',
    contract: pair.baseToken?.address || contract,
    priceUsd: Number(pair.priceUsd || 0.00001),
    liquidityUsd: Number(pair.liquidity?.usd || 100000),
    txnsM5: { buys: 20, sells: 5 }
  };
  const sizeRes = runSizeAgent({ decision: 'PASS', candidate: cand }, memeDesk.portfolio, state.config, 0.06);
  if (sizeRes.dollars <= 0) return { ok: false, error: sizeRes.reason };
  const fillRes = runFillsAgent(cand, sizeRes, state.config);
  if (fillRes.status !== 'FILLED_PAPER') return { ok: false, error: fillRes.reason };

  memeDesk.portfolio.cashUsd = Number((memeDesk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
  memeDesk.portfolio.totalCapitalEverDeployedUsd = Number((memeDesk.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
  memeDesk.openPositions.push(fillRes);
  recomputeAllPortfolios();

  const fillMsg = `📝 [🪙 밈코인 데스크 샘플 모의 체결] $${fillRes.symbol} | 진입가 $${fillRes.entryPriceUsd} | 크기 $${fillRes.dollars} | 잔여현금 $${memeDesk.portfolio.cashUsd.toFixed(2)}`;
  addMessage('memecoin', 'FILLS', fillMsg);
  await sendTelegramNotification(fillMsg);
  return { ok: true, position: fillRes };
}

/**
 * GitHub API를 통한 원클릭 24시간 클라우드 배포
 */
async function deployToGitHub(githubToken, repoName = 'grok-trading-team', isPrivate = true) {
  const token = String(githubToken || '').trim();
  if (!token) {
    return { ok: false, error: 'GitHub 토큰(ghp_...)을 입력해 주세요.' };
  }

  const ghHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  const userRes = await fetchJson('https://api.github.com/user', { headers: ghHeaders });
  if (!userRes.ok || !userRes.data?.login) {
    return { ok: false, error: `GitHub 인증 실패 (HTTP ${userRes.status}): 토큰 권한(repo, workflow)을 확인해 주세요.` };
  }
  const owner = userRes.data.login;

  let repoRes = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}`, { headers: ghHeaders });
  if (!repoRes.ok) {
    repoRes = await fetchJson('https://api.github.com/user/repos', {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        name: repoName,
        description: 'Grok 7-Agent 3-Desk Trading Team v3.0 (Crypto + Prediction Arbitrage + RWA Chart/Options Gamma)',
        private: Boolean(isPrivate),
        auto_init: true
      })
    });
    if (!repoRes.ok) {
      return { ok: false, error: `저장소 생성 실패: ${repoRes.data?.message || repoRes.status}` };
    }
    await new Promise(r => setTimeout(r, 1800));
  }

  const defaultBranch = repoRes.data?.default_branch || 'main';
  saveState();

  const filesToUpload = [
    'package.json',
    'agents.js',
    'cloud-runner.js',
    'server.js',
    'cli-verify.js',
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
      message: `deploy(v3.0): update ${relPath}`,
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
      return {
        ok: false,
        error: `${relPath} 업로드 실패 (HTTP ${putRes.status}): ${putRes.data?.message || '권한 부족'}`
      };
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

  const doneMsg = [
    `☁️ [GitHub 24시간 무인 클라우드 v3.0 배포 완료!]`,
    `• 저장소: ${repoUrl}`,
    `• 3대 데스크(크립토 $1,000 + 예측시장 괴리율 $1,000 + RWA 차트·옵션감마 $1,000)가 15분마다 클라우드에서 자동 실행됩니다!`
  ].join('\n');

  addMessage('memecoin', 'CHIEF', doneMsg);
  await sendTelegramNotification(doneMsg, true);

  return { ok: true, owner, repoName, repoUrl, actionsUrl, uploadedCount: uploaded.length };
}

/**
 * 토큰 직접 발급 없이 1클릭 브라우저 인증으로 GitHub Actions에 자동 업로드하는 Device Flow
 */
const GH_OAUTH_CLIENT_ID = '178c6fc778ccc68e1d6a';
let githubDeviceSession = {
  status: 'IDLE', // IDLE | WAITING_USER | DEPLOYING | DEPLOYED | ERROR
  userCode: null,
  verificationUri: 'https://github.com/login/device',
  repoName: 'grok-trading-team',
  deployResult: null,
  error: null,
  startedAt: null
};
let devicePollTimer = null;

async function startGitHubDeviceFlow(repoName = 'grok-trading-team', isPrivate = true) {
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
    githubDeviceSession = {
      status: 'ERROR',
      userCode: null,
      verificationUri: 'https://github.com/login/device',
      repoName,
      deployResult: null,
      error: 'GitHub Device 인증 코드 요청 실패',
      startedAt: new Date().toISOString()
    };
    return { ok: false, error: githubDeviceSession.error };
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
          state.integrations.githubRepoUrl = depOut.repoUrl;
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
        githubDeviceSession.error = `인증 코드 유효시간(15분) 만료 또는 거부됨 (${tokenRes.data.error}) — 버튼을 다시 눌러 새 코드를 받아주세요.`;
        return;
      }
    } catch {
      // ignore transient network error
    }
    devicePollTimer = setTimeout(pollOnce, currentIntervalSec * 1000);
  };

  devicePollTimer = setTimeout(pollOnce, currentIntervalSec * 1000);

  return {
    ok: true,
    userCode,
    verificationUri,
    repoName,
    status: githubDeviceSession.status
  };
}

/**
 * 대화창 명령 처리 (3대 데스크별 맞춤 응답 + 실시간 티커 분석 지원)
 */
async function handleChatMessage(desk, userText) {
  const targetDesk = ['memecoin', 'prediction', 'rwa'].includes(desk) ? desk : 'memecoin';
  addMessage(targetDesk, 'USER', userText);
  const text = userText.trim();

  if (text.includes('4717.70') || text.includes('167.75')) {
    const calc = calculateRiskFormula(4717.70, 167.75);
    addMessage(targetDesk, 'RISK', calc.formattedLine);
    return { handledBy: 'RISK', result: calc };
  }

  // RWA 및 7대 섹터 개별주 티커 질문 시 즉시 tooja.me 차트+옵션감마 분석!
  const allUniverseSyms = RWA_UNIVERSE.map(u => u.symbol).concat(['SOXL', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'CRCL', 'COIN', 'MSTR']).join('|');
  const tickerRegex = new RegExp(`\\b(${allUniverseSyms})\\b`);
  const tickerMatch = text.toUpperCase().match(tickerRegex);
  if (tickerMatch && (targetDesk === 'rwa' || text.includes('감마') || text.includes('차트') || text.includes('분석') || text.includes('타점'))) {
    const sym = tickerMatch[1] === 'SOXL' ? 'SOXX' : tickerMatch[1];
    const analysis = await analyzeRwaTicker(sym);
    if (analysis.ok) {
      const isShort = analysis.tradeSetup.direction === 'SHORT';
      const msg = [
        `📊 [$${analysis.symbol} (${analysis.name} · ${analysis.category}) 실시간 차트 채널 & 옵션 감마 분석]`,
        `• 현재가: $${analysis.spot} | 추천 방향: ${isShort ? '🔴 SHORT(숏)' : '🟢 LONG(롱)'}`,
        `• [tooja.me/chart 이중 채널]`,
        `  - 1H 보라색(볼린저) 채널: $${analysis.chart.purple1hLower} ~ $${analysis.chart.purple1hUpper} (스퀴즈=${analysis.chart.purpleInsideWhite1h ? 'YES 꿈틀꿈틀' : 'NO'})`,
        `  - 1H 흰색(켈트너) 채널: $${analysis.chart.white1hLower} ~ $${analysis.chart.white1hUpper} (채널내 위치 ${analysis.chart.channelPos1hPct}%)`,
        `  - 10m 보라색 채널: $${analysis.chart.purple10mLower} ~ $${analysis.chart.purple10mUpper}`,
        `• [tooja.me/options 콜감마·숏감마 & 맥스페인]`,
        `  - 감마 레짐: ${analysis.options.gammaRegimeLabel}`,
        `  - 콜감마 벽(Call Wall): $${analysis.options.callWall} | 풋감마 벽(Put Wall): $${analysis.options.putWall} | 감마 플립: $${analysis.options.gammaFlip}`,
        `  - 맥스페인(기관 만기 목표가): $${analysis.options.maxPain} | 평균 IV: ${analysis.options.avgIvPct}%`,
        `• [추천 모의 타점 (점수 ${analysis.tradeSetup.score}점 / 손익비 ${analysis.tradeSetup.rrRatio}:1)]`,
        `  - 전략: ${analysis.tradeSetup.setupName}`,
        `  - 1차 익절: $${analysis.tradeSetup.tp1Price} | 2차 익절: $${analysis.tradeSetup.tp2Price} | 손절가: $${analysis.tradeSetup.stopPrice}`
      ].join('\n');
      addMessage(targetDesk, 'BOOK', msg);
      return { handledBy: 'BOOK', analysis };
    }
  }

  // 섹터별 스캔 명령 인식 (우주, 방산, 바이오, 반도체, 광통신, 로봇, RWA)
  const sectorMapFromChat = [
    ['우주', 'space'], ['위성', 'space'],
    ['방산', 'defense'], ['드론', 'defense'], ['국방', 'defense'],
    ['바이오', 'bio'], ['비만', 'bio'], ['신약', 'bio'],
    ['반도체', 'semi'], ['칩', 'semi'],
    ['광통신', 'optical'], ['데이터센터', 'optical'], ['원전', 'optical'],
    ['로봇', 'robotics'], ['양자', 'robotics'],
    ['원자재', 'rwa_macro']
  ];
  for (const [kw, secKey] of sectorMapFromChat) {
    if (text.includes(kw) && (text.includes('스캔') || text.includes('분석') || text.includes('찾아') || text.includes('매매'))) {
      const res = await executeTradingPipeline(`대화창 [${kw}] 섹터 지시`, 'rwa', secKey);
      return { handledBy: 'CHIEF', pipeline: res };
    }
  }

  if (text.includes('마감 보고') || text.includes('보고서')) {
    const rep = await generateDailyCloseReport('대화창 요청');
    return { handledBy: 'CHIEF', report: rep };
  }

  if (text.includes('스캔') || text.includes('모의 매매를 시작')) {
    const res = await executeTradingPipeline('대화창 지시', targetDesk);
    return { handledBy: 'CHIEF', pipeline: res };
  }

  const dState = state.desks[targetDesk];
  const roleMeta = ROLE_PROFILES_BY_DESK[targetDesk].bots.CHIEF;
  const aiPrompt = [
    roleMeta.prompt,
    `\n현재 [${dState.name}] 장부 상태:`,
    `- 데스크 평가액: $${dState.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${dState.portfolio.cashUsd.toFixed(2)}, 운용 중 $${dState.portfolio.deployedUsd.toFixed(2)})`,
    `- 열린 포지션 수: ${dState.openPositions.length}개`,
    `- 3대 데스크 통합 총 자산: $${state.totalCombinedPortfolio.totalEquityUsd.toFixed(2)}`,
    `\n사용자 질문: "${text}"`,
    `위 데이터를 바탕으로 친절하고 명확하게 한국어로 답변하라.`
  ].join('\n');

  const aiRes = await callGeminiAI(aiPrompt, state.integrations.geminiApiKey, 8000);
  if (aiRes.ok && aiRes.text) {
    addMessage(targetDesk, 'CHIEF', `🧠 ${aiRes.text}`);
    return { handledBy: 'CHIEF', aiModel: aiRes.model };
  }

  addMessage(targetDesk, 'CHIEF', `현재 [${dState.name}] 평가액은 $${dState.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${dState.portfolio.cashUsd.toFixed(2)}, 열린 포지션 ${dState.openPositions.length}개)입니다.`);
  return { handledBy: 'CHIEF' };
}

// ============================================================================
// 백그라운드 자동 루틴 타이머 (5분 RISK / 15분 3-Desk SCAN / 밤 11시 마감 보고 / 텔레그램 폴링)
// ============================================================================
setInterval(async () => {
  if (state.routines.risk5mEnabled) {
    await executeRiskRoutine('5분 자동 루틴');
  }
}, 5 * 60 * 1000);

setInterval(async () => {
  if (state.routines.scan15mEnabled) {
    await executeTradingPipeline('15분 자동 루틴', 'all');
  }
}, 15 * 60 * 1000);

let lastReportDateKst = '';
setInterval(async () => {
  if (!state.routines.dailyReport23hEnabled) return;
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const dateStr = nowKst.toISOString().slice(0, 10);
  const hour = nowKst.getUTCHours();
  if (hour === 23 && lastReportDateKst !== dateStr) {
    lastReportDateKst = dateStr;
    await generateDailyCloseReport('밤 11시 KST 정기 루틴');
  }
}, 60 * 1000);

// 텔레그램 양방향 원격 명령어 (/status, /scan, /rwa, /pred, /report, /reset)
let lastUpdateId = 0;
setInterval(async () => {
  const token = state.integrations?.telegramToken || DEFAULT_TELEGRAM_TOKEN;
  if (!token) return;
  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`;
    const res = await fetchJson(url, {}, 4000);
    const updates = res.data?.result || [];
    for (const u of updates) {
      if (u.update_id > lastUpdateId) lastUpdateId = u.update_id;
      const msg = u.message;
      if (!msg || !msg.text) continue;
      const chatId = String(msg.chat.id);
      if (state.integrations.telegramChatId !== chatId) {
        state.integrations.telegramChatId = chatId;
        saveState();
      }
      const cmd = msg.text.trim().toLowerCase();
      if (cmd === '/start' || cmd === '/status') {
        recomputeAllPortfolios();
        const m = state.desks.memecoin;
        const p = state.desks.prediction;
        const r = state.desks.rwa;
        await sendTelegramNotification(
          [
            `🤖 [그록 7개 에이전트 멀티 데스크 v3.0 상태]`,
            `💰 통합 총 평가액: $${state.totalCombinedPortfolio.totalEquityUsd.toFixed(2)} (시작 $3,000.00)`,
            `• 🪙 밈코인 데스크: $${m.portfolio.totalEquityUsd.toFixed(2)} (보유 ${m.openPositions.length}개)`,
            `• 🎯 예측시장 괴리율: $${p.portfolio.totalEquityUsd.toFixed(2)} (보유 ${p.openPositions.length}개)`,
            `• 🏛️ RWA 차트·옵션감마: $${r.portfolio.totalEquityUsd.toFixed(2)} (보유 ${r.openPositions.length}개)`,
            `• 명령어: /status (상태), /scan (3대 데스크 전체 스캔), /rwa (RWA 스캔), /pred (예측시장 스캔), /report (마감 보고)`
          ].join('\n'),
          true
        );
      } else if (cmd === '/scan') {
        await sendTelegramNotification(`🔍 3대 데스크(크립토 + 예측시장 괴리율 + RWA 차트·옵션감마) 통합 스캔을 시작합니다...`, true);
        await executeTradingPipeline('텔레그램 원격 지시', 'all');
      } else if (cmd === '/rwa') {
        await sendTelegramNotification(`🏛️ RWA 차트(켈트너·볼린저) & 옵션 감마 데스크 스캔을 시작합니다...`, true);
        await executeTradingPipeline('텔레그램 RWA 지시', 'rwa');
      } else if (cmd === '/pred') {
        await sendTelegramNotification(`🎯 예측시장 괴리율 데스크 스캔을 시작합니다...`, true);
        await executeTradingPipeline('텔레그램 예측시장 지시', 'prediction');
      } else if (cmd === '/report') {
        await generateDailyCloseReport('텔레그램 원격 요청');
      }
    }
  } catch {
    // ignore transient polling error
  }
}, 12 * 1000);

(async () => {
  const token = state.integrations?.telegramToken || DEFAULT_TELEGRAM_TOKEN;
  const res = await fetchJson(`https://api.telegram.org/bot${token}/getUpdates`, {}, 4000);
  const updates = res.data?.result || [];
  for (const u of updates) {
    if (u.update_id > lastUpdateId) lastUpdateId = u.update_id;
    if (u.message?.chat?.id && !state.integrations.telegramChatId) {
      state.integrations.telegramChatId = String(u.message.chat.id);
      saveState();
    }
  }
})();

// ============================================================================
// HTTP 서버
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

  // 1. WorldMonitor 호환 엔드포인트
  if (pathname === '/api/market/v1/get-fear-greed-index') {
    if (state.wmMode === 'degraded') {
      return sendJson(res, 200, { unavailable: true, value: null, classification: '', updatedAt: 0 });
    }
    const fg = await fetchJson('https://api.alternative.me/fng/?limit=1');
    const item = fg.data?.data?.[0];
    return sendJson(res, 200, {
      unavailable: false,
      value: Number(item?.value || 54),
      classification: item?.value_classification || 'Neutral',
      updatedAt: Date.now()
    });
  }

  if (pathname === '/api/prediction/v1/list-prediction-markets') {
    if (state.wmMode === 'degraded') {
      return sendJson(res, 200, { markets: [], dataAvailable: false, fetchedAt: 0 });
    }
    const kalshiEv = await fetchJson('https://external-api.kalshi.com/trade-api/v2/events?limit=10&status=open');
    const markets = Array.isArray(kalshiEv.data?.events)
      ? kalshiEv.data.events.map(ev => ({ id: ev.event_ticker, title: ev.title, category: ev.category || 'crypto' }))
      : [{ id: 'wm_seed_1', title: 'Crypto & Macro Prediction Markets Active', category: 'crypto' }];
    return sendJson(res, 200, { markets, dataAvailable: true, fetchedAt: Date.now() });
  }

  if (pathname === '/api/intelligence/v1/list-cross-source-signals') {
    if (state.wmMode === 'degraded') {
      return sendJson(res, 503, { message: 'Internal server error' });
    }
    return sendJson(res, 200, {
      dataAvailable: true,
      fetchedAt: Date.now(),
      signals: [
        { id: 'sig_1', topic: 'Solana DEX Volume Momentum', sourcesCount: 3, confidence: 0.82 },
        { id: 'sig_2', topic: 'RWA Options Gamma & Keltner Squeeze Signal', sourcesCount: 4, confidence: 0.85 }
      ]
    });
  }

  // 2. 대시보드 상태 및 제어 API
  if (pathname === '/api/desk/state' && req.method === 'GET') {
    recomputeAllPortfolios();
    return sendJson(res, 200, {
      state,
      botPrompts: BOT_PROMPTS,
      roleProfilesByDesk: ROLE_PROFILES_BY_DESK,
      rwaSectors: RWA_SECTORS,
      rwaUniverse: RWA_UNIVERSE,
      githubDeviceSession
    });
  }

  // RWA 개별 티커 실시간 차트(켈트너·볼린저) + 옵션 감마(콜감마·숏감마) 분석 API
  if (pathname === '/api/rwa/analyze' && req.method === 'GET') {
    const sym = (parsedUrl.searchParams.get('symbol') || 'SPY').toUpperCase().trim();
    const analysis = await analyzeRwaTicker(sym);
    return sendJson(res, 200, analysis);
  }

  // RWA 개별 티커 즉시 모의 진입 API (LONG / SHORT 양방향 지원!)
  if (pathname === '/api/rwa/trade' && req.method === 'POST') {
    const body = await parseBody(req);
    const sym = String(body.symbol || 'SPY').toUpperCase().trim();
    const forceDirection = body.direction === 'SHORT' ? 'SHORT' : (body.direction === 'LONG' ? 'LONG' : null);
    const rwaDesk = state.desks.rwa;
    if (rwaDesk.openPositions.some(p => p.symbol === sym)) {
      return sendJson(res, 200, { ok: false, error: `$${sym} 포지션이 이미 열려 있습니다.` });
    }
    const analysis = await analyzeRwaTicker(sym);
    if (!analysis.ok) {
      return sendJson(res, 200, { ok: false, error: analysis.error });
    }
    const capPct = analysis.options.gammaRegime === 'LONG_GAMMA' ? 0.10 : 0.06;
    const sizeRes = runSizeAgent(
      { decision: 'PASS', myProb: 0.62, payoffRatio: Math.max(1.4, analysis.tradeSetup.rrRatio), liquidityUsd: 500000 },
      rwaDesk.portfolio,
      state.config,
      capPct
    );
    if (sizeRes.dollars <= 0) {
      return sendJson(res, 200, { ok: false, error: sizeRes.reason });
    }
    const fillRes = runRwaFillsAgent(analysis, sizeRes, null, forceDirection);
    rwaDesk.portfolio.cashUsd = Number((rwaDesk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
    rwaDesk.portfolio.totalCapitalEverDeployedUsd = Number((rwaDesk.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
    rwaDesk.openPositions.push(fillRes);
    recomputeAllPortfolios();

    const isShort = fillRes.direction === 'SHORT';
    const fillMsg = [
      `📝 [🏛️ RWA 차트·옵션감마 데스크 수동 타점 모의 체결 — ${isShort ? '🔴 SHORT(숏)' : '🟢 LONG(롱)'}]`,
      `• 종목: $${fillRes.symbol} (${fillRes.name})`,
      `• 방향: ${isShort ? '🔴 SHORT (하락 베팅)' : '🟢 LONG (상승 베팅)'}`,
      `• 전략: ${fillRes.setupName} | ${fillRes.gammaRegimeLabel}`,
      `• 진입가: $${fillRes.entryPriceUsd} | 증거금: $${fillRes.dollars}`,
      `• TP1: $${fillRes.tp1PriceUsd} | TP2: $${fillRes.tp2PriceUsd} | 손절가: $${fillRes.stopPriceUsd}`
    ].join('\n');
    addMessage('rwa', 'FILLS', fillMsg);
    await sendTelegramNotification(fillMsg);
    return sendJson(res, 200, { ok: true, position: fillRes, analysis });
  }

  if (pathname === '/api/desk/verify' && req.method === 'POST') {
    const ver = await runChiefVerification(state.wmPort);
    state.lastVerification = ver;
    addMessage(
      'memecoin',
      'CHIEF',
      `🔍 [전체 데이터 연결 검증 완료] Node ${ver.nodeVersion} | 월드모니터: ${ver.status} | DexScreener: ${ver.checks.dexscreenerBonk.hasPairs ? '정상' : '실패'} | Kalshi: ${ver.checks.kalshiOpen.ok ? '정상' : '실패'} | tooja.me RWA 차트·옵션: ${ver.rwaReady ? '정상(HTTP 200)' : '실패'}`
    );
    saveState();
    return sendJson(res, 200, ver);
  }

  if (pathname === '/api/desk/wm-mode' && req.method === 'POST') {
    const body = await parseBody(req);
    state.wmMode = body.mode === 'READY' ? 'READY' : 'degraded';
    addMessage('memecoin', 'CHIEF', `⚙️ 월드모니터 모드가 [${state.wmMode}]로 전환되었습니다.`);
    saveState();
    return sendJson(res, 200, { ok: true, wmMode: state.wmMode });
  }

  if (pathname === '/api/desk/run-pipeline' && req.method === 'POST') {
    const body = await parseBody(req);
    const targetDesk = body.desk || 'all';
    const sectorFilter = body.sector || 'all';
    const result = await executeTradingPipeline('대시보드 실행', targetDesk, sectorFilter);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/desk/run-risk' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.staticTest) {
      const calc = calculateRiskFormula(4717.70, 167.75);
      addMessage('memecoin', 'RISK', `🧮 [STEP 4 정적 수식 검증]\n${calc.formattedLine}`);
      return sendJson(res, 200, { ok: true, type: 'static', result: calc });
    }
    if (body.contract) {
      const check = await checkContractRiskLive(body.contract.trim());
      addMessage('memecoin', 'RISK', `🔎 [계약 주소 검증: $${check.symbol || 'TOKEN'}]\n${check.formattedLine}\n판정: ${check.reason}`);
      return sendJson(res, 200, { ok: true, type: 'contract', result: check });
    }
    const routineRes = await executeRiskRoutine('수동 점검');
    return sendJson(res, 200, { ok: true, type: 'routine', result: routineRes });
  }

  if (pathname === '/api/desk/sample-position' && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await createSamplePositionIfRequested(body.contract || 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
    return sendJson(res, 200, out);
  }

  if (pathname === '/api/desk/daily-report' && req.method === 'POST') {
    const report = await generateDailyCloseReport('수동 마감 보고 요청');
    return sendJson(res, 200, { ok: true, report });
  }

  if (pathname === '/api/desk/telegram-test' && req.method === 'POST') {
    recomputeAllPortfolios();
    const m = state.desks.memecoin.portfolio;
    const p = state.desks.prediction.portfolio;
    const r = state.desks.rwa.portfolio;
    const msg = [
      `🔔 [그록 7개 에이전트 멀티 데스크 v3.0 — 텔레그램 연결 확인]`,
      `💰 통합 총 평가액: $${state.totalCombinedPortfolio.totalEquityUsd.toFixed(2)} (시작 $3,000.00)`,
      `• 🪙 데스크 1 (크립토 밈코인): $${m.totalEquityUsd.toFixed(2)}`,
      `• 🎯 데스크 2 (예측시장 괴리율): $${p.totalEquityUsd.toFixed(2)}`,
      `• 🏛️ 데스크 3 (RWA 차트·옵션감마): $${r.totalEquityUsd.toFixed(2)}`,
      `• 3대 데스크에서 체결·익절·손절·마감보고 발생 시 즉시 알림이 전송됩니다!`
    ].join('\n');
    const tgOut = await sendTelegramNotification(msg, true);
    addMessage('memecoin', 'CHIEF', tgOut.ok
      ? `📱 텔레그램(@dytradingdemo_bot)으로 3대 데스크 테스트 알림을 발송했습니다!`
      : `⚠️ 텔레그램 발송 실패 (${tgOut.reason || tgOut.status})`);
    return sendJson(res, 200, tgOut);
  }

  if (pathname === '/api/desk/chat' && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await handleChatMessage(body.desk || 'memecoin', body.text || '');
    return sendJson(res, 200, { ok: true, ...out });
  }

  if (pathname === '/api/desk/config' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.config) state.config = { ...state.config, ...body.config };
    if (body.routines) state.routines = { ...state.routines, ...body.routines };
    if (body.integrations) state.integrations = { ...state.integrations, ...body.integrations };
    saveState();
    return sendJson(res, 200, { ok: true, config: state.config, routines: state.routines });
  }

  if (pathname === '/api/desk/reset' && req.method === 'POST') {
    const body = await parseBody(req);
    const prevIntegrations = state.integrations;
    if (body.desk && state.desks[body.desk]) {
      state.desks[body.desk].portfolio = createVaultPortfolio(1000.00);
      state.desks[body.desk].openPositions = [];
      state.desks[body.desk].closedPositions = [];
      recomputeAllPortfolios();
      addMessage(body.desk, 'CHIEF', `🔄 [${state.desks[body.desk].name}] 금고가 깨끗한 $1,000.00로 초기화되었습니다.`);
    } else {
      state = getDefaultState();
      state.integrations = prevIntegrations;
      saveState();
      addMessage('memecoin', 'CHIEF', `🔄 3대 데스크 금고($1,000 + $1,000 + $1,000 = 총 $3,000.00)가 모두 깨끗하게 초기화되었습니다!`);
    }
    return sendJson(res, 200, { ok: true, state });
  }

  if (pathname === '/api/desk/github-deploy' && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await deployToGitHub(
      body.githubToken,
      body.repoName || 'grok-trading-team',
      body.isPrivate !== false
    );
    return sendJson(res, 200, out);
  }

  if (pathname === '/api/desk/github-device-start' && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await startGitHubDeviceFlow(
      body.repoName || 'grok-trading-team',
      body.isPrivate !== false
    );
    return sendJson(res, 200, out);
  }

  if (pathname === '/api/desk/github-device-status' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, session: githubDeviceSession });
  }

  // 3. 정적 파일 서빙
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
      console.log(`포트 ${port} 사용 중 -> 다음 빈 포트 ${nextPort}로 전환합니다.`);
      state.wmPort = nextPort;
      server.listen(nextPort);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, () => {
    const actualPort = server.address().port;
    state.wmPort = actualPort;
    saveState();
    console.log(`================================================================`);
    console.log(`🚀 그록 7-Agent 멀티 데스크 트레이딩 시스템 v3.0 가동!`);
    console.log(`💰 [데스크1 밈코인 $1,000] + [데스크2 예측시장 괴리율 $1,000] + [데스크3 RWA 차트·옵션감마 $1,000]`);
    console.log(`🌐 대시보드 주소: http://localhost:${actualPort}`);
    console.log(`================================================================`);
  });
}

startServer(Number(process.env.WM_PORT || 3000));
