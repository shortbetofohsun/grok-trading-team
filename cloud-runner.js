/**
 * GitHub Actions 15분 주기 무인 클라우드 실행기 v3.0 (cloud-runner.js)
 * 3대 독립 모의매매 데스크 ($1,000 + $1,000 + $1,000 = 총 $3,000):
 *  1) 🪙 데스크 1 (memecoin): 솔라나 밈코인 (DexScreener + Solana RPC/RugCheck + 거래량 비율 청산)
 *  2) 🎯 데스크 2 (prediction): 예측시장 괴리율 (Kalshi/Polymarket + Gemini AI 블라인드 확률 괴리율 >= 8%)
 *  3) 🏛️ 데스크 3 (rwa): RWA 차트(켈트너·볼린저) & 옵션 감마(콜감마·숏감마 Net GEX·콜벽/풋벽·맥스페인)
 */

const fs = require('fs');
const path = require('path');
const {
  fetchJson,
  callGeminiAI,
  runScanAgent,
  runVetAgent,
  runSizeAgent,
  runFillsAgent,
  checkContractRiskLive,
  runBookAgent,
  runPredictionFillsAgent,
  checkPredictionRiskLive,
  runRwaDeskScanAndVet,
  runRwaFillsAgent,
  checkRwaPositionsRiskLive
} = require('./agents');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'desk_state.json');

const DEFAULT_TG_B64 = 'ODgxMDAzMTEzNzpBQUdyZ3JPZXB5SlJ6TE42OXpqbm1lV0RKQmlfWFY0Tkxidw==';
const DEFAULT_GM_B64 = 'QVEuQWI4Uk42THE1YUNscXNIVlkxbDMxUDIzREJ1eUNxSXFRZkFHeW5FMElCbUhPSjIzMkE=';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || Buffer.from(DEFAULT_GM_B64, 'base64').toString('utf-8');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || Buffer.from(DEFAULT_TG_B64, 'base64').toString('utf-8');
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8417795671';

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

function getDefaultCloudState() {
  return {
    version: '3.0.0',
    createdAt: new Date().toISOString(),
    wmMode: 'READY',
    lastDailyReportDateKst: '',
    lastTelegramUpdateId: 0,
    config: {
      startingBalanceUsd: 1000,
      minLiquidityUsd: 10000,
      minPairAgeMinutes: 30,
      slippageBudgetPct: 0.02,
      minOrderUsd: 50,
      maxKellyCapPct: 0.06,
      maxTopWalletPct: 5.0
    },
    desks: {
      memecoin: {
        id: 'memecoin',
        name: '🪙 크립토 밈코인 데스크',
        portfolio: createVaultPortfolio(1000.00),
        openPositions: [],
        closedPositions: [],
        stats: { scans: 0, candidatesCount: 0, passedCount: 0, rejectedCount: 0, rejectionReasons: {}, closedCount: 0 }
      },
      prediction: {
        id: 'prediction',
        name: '🎯 예측시장 괴리율 데스크',
        portfolio: createVaultPortfolio(1000.00),
        openPositions: [],
        closedPositions: [],
        stats: { scans: 0, evaluatedCount: 0, passedCount: 0, rejectedCount: 0, closedCount: 0 }
      },
      rwa: {
        id: 'rwa',
        name: '🏛️ RWA 차트·옵션감마 데스크',
        portfolio: createVaultPortfolio(1000.00),
        openPositions: [],
        closedPositions: [],
        stats: { scans: 0, evaluatedCount: 0, passedCount: 0, rejectedCount: 0, closedCount: 0 }
      }
    },
    totalCombinedPortfolio: {
      startingBalanceUsd: 3000.00,
      cashUsd: 3000.00,
      deployedUsd: 0.00,
      realizedPnlUsd: 0.00,
      unrealizedPnlUsd: 0.00,
      totalEquityUsd: 3000.00
    }
  };
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (raw && raw.version === '3.0.0' && raw.desks) {
        return { ...getDefaultCloudState(), ...raw };
      }
    } catch {
      return getDefaultCloudState();
    }
  }
  return getDefaultCloudState();
}

function recomputeAll(state) {
  for (const k of ['memecoin', 'prediction', 'rwa']) {
    const d = state.desks[k];
    if (!d) continue;
    let dep = 0;
    let unr = 0;
    for (const pos of d.openPositions) {
      const dollars = Number(pos.dollars || 0);
      const qty = Number(pos.quantity || 0);
      const curPrice = Number(pos.currentPriceUsd || pos.entryPriceUsd || 0);
      const entPrice = Number(pos.entryPriceUsd || 0);
      dep += dollars;
      if (pos.direction === 'SHORT') {
        unr += qty * (entPrice - curPrice);
      } else {
        unr += (qty * curPrice) - dollars;
      }
    }
    d.portfolio.deployedUsd = Number(dep.toFixed(2));
    d.portfolio.unrealizedPnlUsd = Number(unr.toFixed(2));
    d.portfolio.totalEquityUsd = Number((d.portfolio.cashUsd + dep + unr).toFixed(2));
  }
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
}

function saveState(state) {
  const cleanCopy = { ...state };
  if (cleanCopy.integrations) {
    cleanCopy.integrations = {
      geminiModel: 'gemini-3.5-flash',
      telegramBotUsername: '@dytradingdemo_bot',
      telegramEnabled: true,
      lastTelegramSentAt: cleanCopy.integrations.lastTelegramSentAt || null
    };
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(cleanCopy, null, 2), 'utf-8');
}

async function sendTelegram(text, chatId = TELEGRAM_CHAT_ID) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false };
  return fetchJson(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) })
  });
}

async function main() {
  console.log('☁️ [Grok 7-Agent 3-Desk v3.0] 무인 클라우드 루틴 시작');
  let state = loadState();
  recomputeAll(state);

  // 1. 3대 데스크 RISK 점검
  const memeDesk = state.desks.memecoin;
  if (memeDesk.openPositions.length > 0) {
    const rem = [];
    for (const pos of memeDesk.openPositions) {
      const check = await checkContractRiskLive(pos.contract);
      if (check.reachable && check.priceUsd > 0) pos.currentPriceUsd = check.priceUsd;
      if (check.action === 'CLOSE') {
        const gross = pos.quantity * pos.currentPriceUsd;
        const net = Math.max(0, Number((gross - Math.max(0.0045 * gross, 0.95)).toFixed(2)));
        const pnl = Number((net - pos.dollars).toFixed(2));
        memeDesk.portfolio.cashUsd = Number((memeDesk.portfolio.cashUsd + net).toFixed(2));
        memeDesk.portfolio.realizedPnlUsd = Number((memeDesk.portfolio.realizedPnlUsd + pnl).toFixed(2));
        await sendTelegram(`🚨 [🪙 밈코인 클라우드 RISK 청산] $${pos.symbol} | 회수 $${net} (${pnl >= 0 ? '+' : ''}$${pnl})`);
      } else {
        rem.push(pos);
      }
    }
    memeDesk.openPositions = rem;
  }

  const predDesk = state.desks.prediction;
  if (predDesk.openPositions.length > 0) {
    const checks = await checkPredictionRiskLive(predDesk.openPositions);
    const rem = [];
    for (const pos of predDesk.openPositions) {
      const chk = checks.find(c => c.id === pos.id);
      if (chk) pos.currentPriceUsd = chk.currentPriceUsd;
      if (chk && chk.action === 'CLOSE') {
        const gross = pos.quantity * pos.currentPriceUsd;
        const net = Math.max(0, Number((gross - Math.max(0.005 * gross, 0.50)).toFixed(2)));
        const pnl = Number((net - pos.dollars).toFixed(2));
        predDesk.portfolio.cashUsd = Number((predDesk.portfolio.cashUsd + net).toFixed(2));
        predDesk.portfolio.realizedPnlUsd = Number((predDesk.portfolio.realizedPnlUsd + pnl).toFixed(2));
        await sendTelegram(`🔔 [🎯 예측시장 클라우드 RISK 청산] "${pos.question}" (${pos.side}) | ${chk.reason} | 손익 ${pnl >= 0 ? '+' : ''}$${pnl}`);
      } else {
        rem.push(pos);
      }
    }
    predDesk.openPositions = rem;
  }

  const rwaDesk = state.desks.rwa;
  if (rwaDesk.openPositions.length > 0) {
    const checks = await checkRwaPositionsRiskLive(rwaDesk.openPositions);
    const rem = [];
    for (const pos of rwaDesk.openPositions) {
      const chk = checks.find(c => c.id === pos.id);
      if (chk) pos.currentPriceUsd = chk.currentPriceUsd;
      if (chk && chk.action === 'CLOSE') {
        const isShort = pos.direction === 'SHORT';
        const rawPnl = isShort
          ? pos.quantity * (pos.entryPriceUsd - pos.currentPriceUsd)
          : (pos.quantity * pos.currentPriceUsd) - pos.dollars;
        const fee = Math.max(0.0015 * pos.dollars, 0.35);
        const net = Math.max(0, Number((pos.dollars + rawPnl - fee).toFixed(2)));
        const pnl = Number((net - pos.dollars).toFixed(2));
        rwaDesk.portfolio.cashUsd = Number((rwaDesk.portfolio.cashUsd + net).toFixed(2));
        rwaDesk.portfolio.realizedPnlUsd = Number((rwaDesk.portfolio.realizedPnlUsd + pnl).toFixed(2));
        await sendTelegram(`🔔 [🏛️ RWA 클라우드 RISK 청산] $${pos.symbol} (${pos.direction || 'LONG'}) | ${chk.reason} | 손익 ${pnl >= 0 ? '+' : ''}$${pnl}`);
      } else {
        rem.push(pos);
      }
    }
    rwaDesk.openPositions = rem;
  }

  recomputeAll(state);

  // 2. 데스크 1 (밈코인) 스캔
  const scanOut = await runScanAgent(state.config, 'READY');
  const vetOut = await runVetAgent(scanOut.candidates, state.config, 60);
  for (const passedItem of vetOut.passed) {
    if (memeDesk.openPositions.some(p => p.contract === passedItem.contract)) continue;
    const sizeRes = runSizeAgent(passedItem, memeDesk.portfolio, state.config, 0.06);
    if (sizeRes.dollars > 0) {
      const fillRes = runFillsAgent(passedItem.candidate, sizeRes, state.config);
      if (fillRes.status === 'FILLED_PAPER') {
        memeDesk.portfolio.cashUsd = Number((memeDesk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
        memeDesk.openPositions.push(fillRes);
        await sendTelegram(`📝 [🪙 밈코인 클라우드 체결] $${fillRes.symbol} | 진입 $${fillRes.entryPriceUsd} | 크기 $${fillRes.dollars}`);
      }
    }
  }

  // 3. 데스크 2 (예측시장 괴리율) 스캔
  const existingPredIds = new Set(predDesk.openPositions.map(p => p.marketId));
  const bookOut = await runBookAgent(null, predDesk.openPositions.length, GEMINI_API_KEY, existingPredIds);
  for (const prop of (bookOut.proposals || [])) {
    if (predDesk.openPositions.some(p => p.marketId === prop.marketId)) continue;
    const sizeRes = runSizeAgent({ myProb: prop.myProb, liquidityUsd: prop.liquidityUsd, payoffRatio: 1.8 }, predDesk.portfolio, state.config, 0.08);
    if (sizeRes.dollars > 0) {
      const fillRes = runPredictionFillsAgent(prop, sizeRes);
      if (fillRes.status === 'FILLED_PAPER') {
        predDesk.portfolio.cashUsd = Number((predDesk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
        predDesk.openPositions.push(fillRes);
        await sendTelegram(`📝 [🎯 예측시장 클라우드 체결] "${fillRes.question}" (${fillRes.side}) | 괴리율 +${fillRes.edgePct}% | 크기 $${fillRes.dollars}`);
      }
    }
  }

  // 4. 데스크 3 (RWA & 7대 섹터 개별주 차트·옵션감마) 스캔 (LONG + SHORT 양방향)
  if (rwaDesk.openPositions.length < 8) {
    const existingRwaSyms = new Set(rwaDesk.openPositions.map(p => p.symbol));
    const rwaOut = await runRwaDeskScanAndVet(existingRwaSyms, GEMINI_API_KEY, 'all');
    const topLong = rwaOut.passed.find(p => p.analysis.tradeSetup.direction === 'LONG');
    const topShort = rwaOut.passed.find(p => p.analysis.tradeSetup.direction === 'SHORT');
    const selected = [topLong, topShort].filter(Boolean);
    if (selected.length === 0 && rwaOut.passed.length > 0) selected.push(rwaOut.passed[0]);
    for (const item of selected) {
      if (rwaDesk.openPositions.length >= 8) break;
      const a = item.analysis;
      const dir = a.tradeSetup.direction || 'LONG';
      const capPct = a.options.gammaRegime === 'LONG_GAMMA' ? 0.10 : 0.06;
      const sizeRes = runSizeAgent({ decision: 'PASS', myProb: 0.62, payoffRatio: Math.max(1.4, a.tradeSetup.rrRatio), liquidityUsd: 500000 }, rwaDesk.portfolio, state.config, capPct);
      if (sizeRes.dollars > 0) {
        const fillRes = runRwaFillsAgent(a, sizeRes, rwaOut.aiComment);
        if (fillRes.status === 'FILLED_PAPER') {
          rwaDesk.portfolio.cashUsd = Number((rwaDesk.portfolio.cashUsd - fillRes.dollars).toFixed(2));
          rwaDesk.openPositions.push(fillRes);
          await sendTelegram(`📝 [🏛️ RWA·섹터 개별주 클라우드 ${dir === 'SHORT' ? '🔴 SHORT' : '🟢 LONG'} 체결] [$${fillRes.symbol} · ${fillRes.category}] (${fillRes.setupName}) | 진입 $${fillRes.entryPriceUsd} | TP1 $${fillRes.tp1PriceUsd} / TP2 $${fillRes.tp2PriceUsd} | 크기 $${fillRes.dollars}`);
        }
      }
    }
  }

  recomputeAll(state);
  saveState(state);
  console.log('✅ 클라우드 루틴 완료! 통합 자산: $' + state.totalCombinedPortfolio.totalEquityUsd.toFixed(2));
}

main().catch(err => {
  console.error('❌ 클라우드 실행기 오류:', err);
  process.exit(1);
});
