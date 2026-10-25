/**
 * GitHub Actions 15분 주기 무인 클라우드 실행기 (cloud-runner.js)
 * 컴퓨터를 완전히 꺼 두어도 GitHub 서버에서 15분마다 깨어나:
 * 1) 텔레그램 원격 명령(/status, /scan, /report, /reset) 확인 및 응답
 * 2) 열린 포지션 RISK 거래량 급감(ratio < 0.20) 감시 및 강제 청산 알림
 * 3) 신규 코인 발굴(SCAN -> VET -> SIZE -> FILLS) 및 예측시장(BOOK Gemini AI) 스캔 알림
 * 4) 밤 11시(KST) 시간대면 일일 마감 보고서 자동 발송
 * 5) 변경된 장부(data/desk_state.json)를 저장하고 종료 (GitHub Actions가 자동 커밋)
 */

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_GEMINI_KEY,
  BOT_PROMPTS,
  fetchJson,
  callGeminiAI,
  runScanAgent,
  runVetAgent,
  runBookAgent,
  runSizeAgent,
  runFillsAgent,
  checkContractRiskLive
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

function getDefaultCloudState() {
  return {
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
    portfolio: {
      startingBalanceUsd: 1000.00,
      cashUsd: 1000.00,
      deployedUsd: 0.00,
      totalCapitalEverDeployedUsd: 0.00,
      realizedPnlUsd: 0.00,
      unrealizedPnlUsd: 0.00,
      totalEquityUsd: 1000.00,
      lastNotifiedPnlPct: 0
    },
    stats: {
      totalScans: 0,
      todayCandidatesCount: 0,
      todayRejectedCount: 0,
      todayPassedCount: 0,
      rejectionReasons: {},
      closedByRuleCount: 0
    },
    openPositions: [],
    closedPositions: [],
    predictionBets: [],
    lastScanCandidates: [],
    lastVetResults: []
  };
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      return { ...getDefaultCloudState(), ...raw };
    } catch {
      return getDefaultCloudState();
    }
  }
  return getDefaultCloudState();
}

function saveState(state) {
  // GitHub 저장소에 올라가는 파일이므로 민감한 API 키 필드는 저장하지 않음
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
  const res = await fetchJson(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000)
    })
  });
  return res;
}

function recomputePortfolio(state) {
  let deployed = 0;
  let unrealized = 0;
  for (const pos of state.openPositions) {
    deployed += Number(pos.dollars || 0);
    const currentVal = Number(pos.quantity || 0) * Number(pos.currentPriceUsd || pos.entryPriceUsd || 0);
    unrealized += (currentVal - Number(pos.dollars || 0));
  }
  state.portfolio.deployedUsd = Number(deployed.toFixed(2));
  state.portfolio.unrealizedPnlUsd = Number(unrealized.toFixed(2));
  state.portfolio.totalEquityUsd = Number((state.portfolio.cashUsd + deployed + unrealized).toFixed(2));
}

async function buildDailyReportText(state, triggerSource = 'GitHub Cloud 밤 11시 마감 보고') {
  recomputePortfolio(state);
  const totalPnlUsd = Number((state.portfolio.realizedPnlUsd + state.portfolio.unrealizedPnlUsd).toFixed(2));
  const deployedEver = state.portfolio.totalCapitalEverDeployedUsd || 0;
  const pnlVsDeployedPct = deployedEver > 0
    ? `${((totalPnlUsd / deployedEver) * 100).toFixed(2)}% (실제로 굴린 돈 $${deployedEver.toFixed(2)} 대비)`
    : '0.00% (실제로 굴린 돈 $0.00)';

  const rejSummary = Object.entries(state.stats.rejectionReasons || {})
    .map(([k, v]) => `${k}: ${v}건`)
    .join(', ') || '기록 없음';

  const openLines = state.openPositions.map(p =>
    `  - $${p.symbol}: 크기 $${p.dollars} | 진입가 $${p.entryPriceUsd} -> 현재가 $${p.currentPriceUsd}`
  ).join('\n') || '  (열린 포지션 없음)';

  const closedLines = state.closedPositions.slice(0, 10).map(c =>
    `  - $${c.symbol}: 크기 $${c.dollars} | 손익 ${c.pnlUsd >= 0 ? '+' : ''}$${c.pnlUsd} (${c.pnlPct}%) | 규칙: ${c.closeRule}`
  ).join('\n') || '  (오늘 닫은 포지션 없음)';

  let aiCommentary = '';
  const aiPrompt = [
    BOT_PROMPTS.CHIEF.prompt,
    `\n오늘 데스크 요약 데이터를 보고 초보자도 이해하기 쉬운 2~3문장의 핵심 마감 코멘트를 작성하라:`,
    `- 총 스캔 횟수: ${state.stats.totalScans}회, 누적 후보: ${state.stats.todayCandidatesCount}개, VET 통과: ${state.stats.todayPassedCount}개, VET 탈락: ${state.stats.todayRejectedCount}개 (${rejSummary})`,
    `- 예측시장 베팅: ${state.predictionBets.length}건, 열린 포지션: ${state.openPositions.length}개, 닫은 포지션: ${state.closedPositions.length}개`,
    `- 시작 잔고: $1000.00, 현재 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)}, 총 손익: $${totalPnlUsd.toFixed(2)}`
  ].join('\n');

  const aiRes = await callGeminiAI(aiPrompt, GEMINI_API_KEY, 8500);
  if (aiRes.ok && aiRes.text) {
    aiCommentary = `\n7. 🧠 CHIEF (Gemini AI) 총평:\n   ${aiRes.text.replace(/\n/g, '\n   ')}`;
  }

  return [
    `📋 [CHIEF 일일 모의 매매 마감 보고 (${triggerSource})]`,
    `1. 구동 환경: ☁️ GitHub Actions 24시간 무인 클라우드 (총 스캔: ${state.stats.totalScans}회)`,
    `2. 후보 및 VET 탈락 통계:`,
    `   - 누적 후보 수: ${state.stats.todayCandidatesCount}개`,
    `   - VET 통과: ${state.stats.todayPassedCount}개 / VET 탈락: ${state.stats.todayRejectedCount}개 (${rejSummary})`,
    `3. 예측 시장(BOOK) 베팅: ${state.predictionBets.length}건`,
    `4. 열린 포지션 (${state.openPositions.length}개):`,
    openLines,
    `5. 닫은 포지션 (${state.closedPositions.length}건):`,
    closedLines,
    `6. 계좌 잔고 및 손익 요약:`,
    `   - 시작 잔고: $${state.portfolio.startingBalanceUsd.toFixed(2)}`,
    `   - 현재 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${state.portfolio.cashUsd.toFixed(2)} + 운용 중 $${state.portfolio.deployedUsd.toFixed(2)})`,
    `   - 총 손익: ${totalPnlUsd >= 0 ? '+' : ''}$${totalPnlUsd.toFixed(2)} (${pnlVsDeployedPct})${aiCommentary}`
  ].join('\n');
}

async function main() {
  console.log('================================================================');
  console.log('☁️ [Grok 7-Agent Trading Team] 무인 클라우드 루틴 실행 시작');
  console.log('================================================================');
  let state = loadState();

  // --------------------------------------------------------------------------
  // 1. 텔레그램 원격 명령어 확인 (/status, /report, /reset)
  // --------------------------------------------------------------------------
  if (TELEGRAM_BOT_TOKEN) {
    const offset = (state.lastTelegramUpdateId || 0) + 1;
    const updRes = await fetchJson(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=1`, {}, 5000);
    const updates = updRes.data?.result || [];
    for (const u of updates) {
      if (u.update_id > (state.lastTelegramUpdateId || 0)) {
        state.lastTelegramUpdateId = u.update_id;
      }
      const text = (u.message?.text || '').trim().toLowerCase();
      const chatId = String(u.message?.chat?.id || TELEGRAM_CHAT_ID);
      if (text === '/status' || text === '/start') {
        await sendTelegram(
          `☁️ [그록 7개 에이전트 클라우드 상태]\n• 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)}\n• 가용 현금: $${state.portfolio.cashUsd.toFixed(2)}\n• 열린 포지션: ${state.openPositions.length}개\n• 누적 스캔/탈락: ${state.stats.totalScans}회 / ${state.stats.todayRejectedCount}개 탈락`,
          chatId
        );
      } else if (text === '/report') {
        const rep = await buildDailyReportText(state, '텔레그램 원격 요청');
        await sendTelegram(rep, chatId);
      } else if (text === '/reset') {
        const lastUpd = state.lastTelegramUpdateId;
        state = getDefaultCloudState();
        state.lastTelegramUpdateId = lastUpd;
        await sendTelegram(`🔄 장부가 깨끗한 초기 상태($1,000.00)로 리셋되었습니다!`, chatId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. RISK: 열린 모의 포지션 거래량 비율(ratio < 0.20 -> CLOSE) 점검
  // --------------------------------------------------------------------------
  if (state.openPositions.length > 0) {
    console.log(`[RISK] 열린 포지션 ${state.openPositions.length}개 거래량 점검 중...`);
    const remaining = [];
    for (const pos of state.openPositions) {
      const check = await checkContractRiskLive(pos.contract);
      if (check.reachable && check.priceUsd > 0) {
        pos.currentPriceUsd = check.priceUsd;
      }
      if (check.action === 'CLOSE') {
        state.stats.closedByRuleCount += 1;
        const grossValue = pos.quantity * pos.currentPriceUsd;
        const exitFee = Math.max(0.0045 * grossValue, 0.95);
        const netProceeds = Math.max(0, Number((grossValue - exitFee).toFixed(2)));
        const pnlUsd = Number((netProceeds - pos.dollars).toFixed(2));
        const pnlPct = Number(((pnlUsd / pos.dollars) * 100).toFixed(2));

        state.portfolio.cashUsd = Number((state.portfolio.cashUsd + netProceeds).toFixed(2));
        state.portfolio.realizedPnlUsd = Number((state.portfolio.realizedPnlUsd + pnlUsd).toFixed(2));

        state.closedPositions.unshift({
          ...pos,
          exitPriceUsd: pos.currentPriceUsd,
          exitFeeUsd: Number(exitFee.toFixed(2)),
          netProceedsUsd: netProceeds,
          pnlUsd,
          pnlPct,
          closedAt: new Date().toISOString(),
          closeRule: check.reachable ? `거래량 급감 규칙 (ratio ${check.ratio} < 0.20)` : '데이터 응답 불능 즉시 청산 규칙'
        });

        const closeMsg = [
          `🚨 [RISK 클라우드 강제 청산 (CLOSE) 발동]`,
          `• 종목: $${pos.symbol} (${pos.contract})`,
          `• 계산식:\n${check.formattedLine}`,
          `• 정산: 진입 $${pos.dollars.toFixed(2)} -> 회수 $${netProceeds.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} / ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`
        ].join('\n');
        console.log(closeMsg);
        await sendTelegram(closeMsg);
      } else {
        remaining.push(pos);
      }
    }
    state.openPositions = remaining;
    recomputePortfolio(state);
  }

  // --------------------------------------------------------------------------
  // 3. SCAN -> VET -> SIZE -> FILLS 파이프라인 실행
  // --------------------------------------------------------------------------
  console.log(`[SCAN] 덱스스크리너 후보 스캔 시작...`);
  state.stats.totalScans += 1;
  const scanOut = await runScanAgent(state.config, 'READY');
  state.lastScanCandidates = scanOut.candidates;
  state.stats.todayCandidatesCount += scanOut.candidates.length;

  const plannedOrderEst = Math.max(state.config.minOrderUsd, Number((state.portfolio.totalEquityUsd * state.config.maxKellyCapPct).toFixed(2)));
  const vetOut = await runVetAgent(scanOut.candidates, state.config, plannedOrderEst, GEMINI_API_KEY);
  state.lastVetResults = vetOut.results;
  state.stats.todayRejectedCount += vetOut.rejectedCount;
  state.stats.todayPassedCount += vetOut.passedCount;

  for (const r of vetOut.rejected) {
    const key = `규칙 ${r.failedRule}`;
    state.stats.rejectionReasons[key] = (state.stats.rejectionReasons[key] || 0) + 1;
  }
  console.log(`[VET] 후보 ${vetOut.totalEvaluated}개 중 통과 ${vetOut.passedCount}개 / 탈락 ${vetOut.rejectedCount}개`);

  for (const passedItem of vetOut.passed) {
    if (state.openPositions.some(p => p.contract === passedItem.contract)) continue;
    const sizeRes = runSizeAgent(passedItem, state.portfolio, state.config);
    if (sizeRes.dollars > 0) {
      const fillRes = runFillsAgent(passedItem.candidate, sizeRes, state.config);
      if (fillRes.status === 'FILLED_PAPER') {
        state.portfolio.cashUsd = Number((state.portfolio.cashUsd - fillRes.dollars).toFixed(2));
        state.portfolio.totalCapitalEverDeployedUsd = Number((state.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
        state.openPositions.push(fillRes);
        recomputePortfolio(state);

        const fillMsg = [
          `📝 [FILLS 클라우드 모의 매수 체결]`,
          `• 종목: $${fillRes.symbol} (${fillRes.name})`,
          `• 계약 주소: ${fillRes.contract}`,
          `• 진입가: $${fillRes.entryPriceUsd} | 주문 크기: $${fillRes.dollars} | 수수료: $${fillRes.feeUsd}`,
          `• 남은 가용 현금: $${state.portfolio.cashUsd.toFixed(2)}`
        ].join('\n');
        console.log(fillMsg);
        await sendTelegram(fillMsg);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. BOOK: 예측 시장 Gemini AI 확률 추론 (WorldMonitor 서버 없이 직접 조회)
  // --------------------------------------------------------------------------
  if (state.predictionBets.length < 7) {
    const [kalshiEvRes, fgRes] = await Promise.all([
      fetchJson('https://external-api.kalshi.com/trade-api/v2/events?limit=15&status=open&with_nested_markets=true'),
      fetchJson('https://api.alternative.me/fng/?limit=1')
    ]);
    const fearGreedVal = Number(fgRes.data?.data?.[0]?.value || 54);
    const validMarkets = [];
    for (const ev of (kalshiEvRes.data?.events || [])) {
      const m = ev.markets?.[0];
      if (!m) continue;
      const yesPrice = Number(m.last_price_dollars || m.yes_ask_dollars || 0);
      if (yesPrice <= 0.05 || yesPrice >= 0.95) continue;
      validMarkets.push({
        source: 'Kalshi',
        marketId: String(m.ticker || ev.event_ticker),
        question: ev.title || m.title,
        yesPrice,
        liquidityUsd: Math.round(Number(m.open_interest_fp || 15000) + 15000)
      });
      if (validMarkets.length >= 5) break;
    }

    if (validMarkets.length > 0) {
      const prompt = [
        `너는 예측 시장 전문 애널리스트 봇 BOOK이다. 현재 공포탐욕지수는 ${fearGreedVal}이다.`,
        `아래 예측 시장 질문들을 보고 시장 가격을 참고하지 않은 상태에서 YES 확률(0.05~0.95)과 1줄 한국어 근거를 JSON 배열로만 답하라.`,
        `형식: [{"idx":0,"prob":0.62,"reason":"근거"}]`,
        ...validMarkets.map((m, i) => `${i}. "${m.question}"`)
      ].join('\n');

      const aiRes = await callGeminiAI(prompt, GEMINI_API_KEY, 8500);
      if (aiRes.ok && aiRes.text) {
        try {
          const match = aiRes.text.match(/\[[\s\S]*\]/);
          const parsed = match ? JSON.parse(match[0]) : [];
          for (const item of parsed) {
            const m = validMarkets[item.idx];
            if (!m || typeof item.prob !== 'number') continue;
            if (state.predictionBets.some(b => b.marketId === m.marketId)) continue;
            const myYesProb = Math.min(0.95, Math.max(0.05, Number(item.prob.toFixed(3))));
            const edge = Number((myYesProb - m.yesPrice).toFixed(3));
            if (Math.abs(edge) > 0.08) {
              const side = edge > 0 ? 'YES' : 'NO';
              const myProb = edge > 0 ? myYesProb : Number((1 - myYesProb).toFixed(3));
              const marketPrice = edge > 0 ? m.yesPrice : Number((1 - m.yesPrice).toFixed(3));
              const edgePct = Number((Math.abs(edge) * 100).toFixed(1));
              const bookSize = runSizeAgent({ myProb, liquidityUsd: m.liquidityUsd }, state.portfolio, state.config);

              const betRecord = {
                source: m.source,
                marketId: m.marketId,
                question: m.question,
                side,
                myProb,
                marketPrice,
                edgePct,
                dollars: bookSize.dollars,
                reasoning: `🧠 Gemini(${aiRes.model}): ${item.reason}`,
                createdAt: new Date().toISOString()
              };
              state.predictionBets.push(betRecord);

              const bookMsg = [
                `📊 [BOOK 클라우드 예측시장 AI 신호 포착]`,
                `• 질문: "${m.question}" (${m.source})`,
                `• 추론 근거: ${betRecord.reasoning}`,
                `• 포지션: ${side} | 내 확률: ${(myProb * 100).toFixed(1)}% vs 시장 가격: ${(marketPrice * 100).toFixed(1)}% (괴리 ${edgePct}% > 8%)`,
                `• SIZE 산정 금액: $${bookSize.dollars}`
              ].join('\n');
              console.log(bookMsg);
              await sendTelegram(bookMsg);
              break;
            }
          }
        } catch {
          // ignore parse error
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. 밤 11시(KST) 시간대면 일일 마감 보고서 자동 발송 (하루 1회)
  // --------------------------------------------------------------------------
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const dateKst = nowKst.toISOString().slice(0, 10);
  const hourKst = nowKst.getUTCHours();

  if (hourKst === 23 && state.lastDailyReportDateKst !== dateKst) {
    state.lastDailyReportDateKst = dateKst;
    const reportText = await buildDailyReportText(state, '밤 11시 KST 정기 마감 보고');
    console.log(reportText);
    await sendTelegram(reportText);
  }

  saveState(state);
  console.log('✅ 클라우드 루틴 1회 실행 및 장부 저장 완료.');
}

main().catch(err => {
  console.error('Cloud runner error:', err);
  process.exit(1);
});
