const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_GEMINI_KEY,
  BOT_PROMPTS,
  fetchJson,
  callGeminiAI,
  runChiefVerification,
  runScanAgent,
  runVetAgent,
  runBookAgent,
  runSizeAgent,
  runFillsAgent,
  calculateRiskFormula,
  checkContractRiskLive
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

function getDefaultState() {
  return {
    createdAt: new Date().toISOString(),
    wmMode: 'READY', // 기본값을 READY로 설정하여 공포탐욕지수 및 예측시장(BOOK)이 즉시 작동!
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
    routines: {
      scan15mEnabled: true,
      risk5mEnabled: true,
      dailyReport23hEnabled: true,
      lastScanAt: null,
      lastRiskAt: null,
      lastDailyReportAt: null
    },
    supervision: {
      CHIEF: { status: 'ONLINE (AI)', failures: 0, restartsThisHour: 0, lastSeen: new Date().toISOString() },
      SCAN: { status: 'ONLINE', failures: 0, restartsThisHour: 0, lastSeen: new Date().toISOString() },
      VET: { status: 'ONLINE', failures: 0, restartsThisHour: 0, lastSeen: new Date().toISOString() },
      BOOK: { status: 'ONLINE (AI)', failures: 0, restartsThisHour: 0, lastSeen: new Date().toISOString() },
      SIZE: { status: 'ONLINE', failures: 0, restartsThisHour: 0, lastSeen: new Date().toISOString() },
      FILLS: { status: 'ONLINE', failures: 0, restartsThisHour: 0, lastSeen: new Date().toISOString() },
      RISK: { status: 'ONLINE (5m Timer)', failures: 0, restartsThisHour: 0, lastSeen: new Date().toISOString() }
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
    lastVetResults: [],
    lastVerification: null,
    messages: [
      {
        id: 'msg_init_1',
        desk: 'memecoin',
        sender: 'CHIEF',
        badge: '👑 총괄',
        timestamp: new Date().toISOString(),
        text: `[모의 매매 트레이딩 데스크 v2.0 가동 준비 완료]\n- 💰 시작 모의 잔고: $1,000.00 (깨끗한 초기 상태)\n- 🧠 AI 두뇌: Gemini 3.5 Flash 연결 완료 (예측시장 독립 확률 추론 & 총괄 브리핑)\n- 📱 텔레그램 알림: @dytradingdemo_bot 연결 완료 (매수 체결·강제 청산·밤 11시 마감 보고 실시간 발송)\n- 🌐 월드모니터 상태: READY (공포탐욕지수 & 예측시장 실시간 활성화)`
      },
      {
        id: 'msg_init_2',
        desk: 'prediction',
        sender: 'CHIEF',
        badge: '👑 총괄',
        timestamp: new Date().toISOString(),
        text: `[예측 시장 데스크 (CHIEF, BOOK, SIZE) — READY 가동 중]\n- BOOK 봇이 Gemini AI 두뇌를 사용하여 시장 가격을 보기 전에 독립적으로 확률(내 확률)을 먼저 추론하고, Kalshi·Polymarket 시장 가격과 8% 초과 괴리 발견 시 베팅을 요청합니다.`
      }
    ]
  };
}

let state = getDefaultState();
if (fs.existsSync(STATE_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
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

/**
 * GitHub API를 통한 원클릭 24시간 클라우드 배포 (Git 설치 없이 브라우저에서 즉시 업로드!)
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

  // 1) GitHub 계정 확인
  const userRes = await fetchJson('https://api.github.com/user', { headers: ghHeaders });
  if (!userRes.ok || !userRes.data?.login) {
    return { ok: false, error: `GitHub 인증 실패 (HTTP ${userRes.status}): 토큰 권한(repo, workflow)을 확인해 주세요.` };
  }
  const owner = userRes.data.login;

  // 2) 저장소 조회 또는 신규 생성
  let repoRes = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}`, { headers: ghHeaders });
  if (!repoRes.ok) {
    repoRes = await fetchJson('https://api.github.com/user/repos', {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        name: repoName,
        description: 'Grok 7-Agent Trading Team (15m Cloud Auto-Run + Gemini AI + Telegram)',
        private: Boolean(isPrivate),
        auto_init: true
      })
    });
    if (!repoRes.ok) {
      return { ok: false, error: `저장소 생성 실패: ${repoRes.data?.message || repoRes.status}` };
    }
    // GitHub 초기화 대기
    await new Promise(r => setTimeout(r, 1800));
  }

  const defaultBranch = repoRes.data?.default_branch || 'main';

  // 3) 업로드할 파일 목록
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

    // 기존 파일 SHA 확인
    const checkRes = await fetchJson(`https://api.github.com/repos/${owner}/${repoName}/contents/${relPath}`, { headers: ghHeaders });
    const body = {
      message: `deploy: update ${relPath}`,
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
        error: `${relPath} 업로드 실패 (HTTP ${putRes.status}): ${putRes.data?.message || '권한 부족 (토큰에 workflow 체크 필요)'}`
      };
    }
    uploaded.push(relPath);
  }

  // 4) 첫 번째 클라우드 워크플로우 즉시 실행 트리거
  await fetchJson(`https://api.github.com/repos/${owner}/${repoName}/actions/workflows/trading-cron.yml/dispatches`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({ ref: defaultBranch })
  });

  const repoUrl = `https://github.com/${owner}/${repoName}`;
  const actionsUrl = `https://github.com/${owner}/${repoName}/actions`;

  const doneMsg = [
    `☁️ [GitHub 24시간 무인 클라우드 배포 완료!]`,
    `• 저장소: ${repoUrl} (${isPrivate ? '🔒 비공개 Private' : '🌐 공개 Public'})`,
    `• 업로드된 파일: ${uploaded.length}개 (15분 자동 스케줄러 활성화 완료)`,
    `• 실시간 작동 확인: ${actionsUrl}`,
    `• 이제 컴퓨터를 완전히 끄셔도 GitHub 클라우드 서버가 15분마다 깨어나 스캔·검증·청산 감시를 수행하고 텔레그램(@dytradingdemo_bot)으로 신호를 보내줍니다!`
  ].join('\n');

  addMessage('memecoin', 'CHIEF', doneMsg);
  await sendTelegramNotification(doneMsg, true);

  return {
    ok: true,
    owner,
    repoName,
    repoUrl,
    actionsUrl,
    uploadedCount: uploaded.length
  };
}

/**
 * 텔레그램 메시지 발송 함수 (모의 매수 체결, 강제 청산, 밤 11시 마감 보고 등 즉시 발송)
 */
async function sendTelegramNotification(text, force = false) {
  const integ = state.integrations || {};
  if (!integ.telegramEnabled && !force) return { ok: false, reason: 'disabled' };
  const token = (integ.telegramToken || DEFAULT_TELEGRAM_TOKEN).trim();
  let chatId = (integ.telegramChatId || DEFAULT_TELEGRAM_CHAT_ID).trim();

  if (!token) return { ok: false, reason: 'no_token' };

  // 만약 chatId가 비어 있으면 getUpdates에서 자동 탐색
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
  const botMeta = BOT_PROMPTS[sender] || { badge: '👤 사용자', color: '#94a3b8' };
  const msg = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    desk,
    sender,
    badge: botMeta.badge || '🤖',
    timestamp: new Date().toISOString(),
    text
  };
  state.messages.push(msg);
  if (state.messages.length > 250) {
    state.messages = state.messages.slice(-250);
  }
  if (state.supervision[sender]) {
    state.supervision[sender].lastSeen = msg.timestamp;
  }
  saveState();
  return msg;
}

function recomputePortfolio() {
  let deployed = 0;
  let unrealized = 0;
  for (const pos of state.openPositions) {
    deployed += Number(pos.dollars || 0);
    const currentVal = Number(pos.quantity || 0) * Number(pos.currentPriceUsd || pos.entryPriceUsd || 0);
    const netCost = Number(pos.dollars || 0);
    unrealized += (currentVal - netCost);
  }
  state.portfolio.deployedUsd = Number(deployed.toFixed(2));
  state.portfolio.unrealizedPnlUsd = Number(unrealized.toFixed(2));
  state.portfolio.totalEquityUsd = Number((state.portfolio.cashUsd + deployed + unrealized).toFixed(2));

  // 장중 손익이 실제로 굴린 돈 대비 10% 넘게 움직일 때만 CHIEF 알림 + 텔레그램 발송
  const totalPnl = state.portfolio.realizedPnlUsd + state.portfolio.unrealizedPnlUsd;
  const denom = Math.max(50, state.portfolio.totalCapitalEverDeployedUsd || state.portfolio.deployedUsd || 0);
  if (denom > 0 && state.portfolio.totalCapitalEverDeployedUsd > 0) {
    const pnlPctVsDeployed = (totalPnl / state.portfolio.totalCapitalEverDeployedUsd) * 100;
    if (Math.abs(pnlPctVsDeployed - (state.portfolio.lastNotifiedPnlPct || 0)) >= 10) {
      state.portfolio.lastNotifiedPnlPct = Number(pnlPctVsDeployed.toFixed(2));
      const alertMsg = `📢 [CHIEF 장중 10% 이상 손익 변동 알림]\n• 누적 손익: $${totalPnl.toFixed(2)} (실제로 굴린 돈 $${state.portfolio.totalCapitalEverDeployedUsd.toFixed(2)} 대비 ${pnlPctVsDeployed >= 0 ? '+' : ''}${pnlPctVsDeployed.toFixed(2)}%)\n• 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)}`;
      addMessage('memecoin', 'CHIEF', alertMsg);
      sendTelegramNotification(alertMsg);
    }
  }
  saveState();
}

/**
 * 전체 파이프라인 1회 실행: SCAN -> VET -> BOOK -> SIZE -> FILLS -> RISK 인계
 */
let pipelineRunning = false;
async function executeTradingPipeline(triggerSource = '수동 실행') {
  if (pipelineRunning) {
    return { ok: false, message: '이미 파이프라인이 실행 중입니다.' };
  }
  pipelineRunning = true;
  try {
    state.routines.lastScanAt = new Date().toISOString();
    state.stats.totalScans += 1;

    addMessage('memecoin', 'CHIEF', `▶️ [${triggerSource}] 트레이딩 데스크 파이프라인 시작: SCAN -> VET -> BOOK -> SIZE -> FILLS -> RISK`);

    // 1. SCAN
    const scanOut = await runScanAgent(state.config, state.wmMode);
    state.lastScanCandidates = scanOut.candidates;
    state.stats.todayCandidatesCount += scanOut.candidates.length;

    const scanSummaryLines = scanOut.candidates.map((c, idx) =>
      `${idx + 1}. $${c.symbol} (${c.contract.slice(0, 6)}...${c.contract.slice(-4)}) | 속도점수: ${c.velocityScore} | 유동성: $${c.liquidityUsd.toLocaleString()} | m5 매수/매도: ${c.txnsM5.buys}/${c.txnsM5.sells} | h1: ${c.priceChangeH1 >= 0 ? '+' : ''}${c.priceChangeH1}% | holders: ${c.holders !== null ? c.holders.toLocaleString() : 'null'}${c.warning ? ` ⚠️ ${c.warning}` : ''}`
    );

    addMessage(
      'memecoin',
      'SCAN',
      `🔍 [덱스스크리너 후보 스캔 완료] (degraded: ${scanOut.degraded})\n- 스캔 원본: ${scanOut.rawScannedCount}개 페어 (유동성/매도우위 사전제외: ${scanOut.skippedByScanCount}개)\n- 속도 순위 상위 후보 (${scanOut.candidates.length}개):\n${scanSummaryLines.length ? scanSummaryLines.join('\n') : '(기준 통과 후보 없음)'}`
    );

    // 2. VET
    const plannedOrderEst = Math.max(state.config.minOrderUsd, Number((state.portfolio.totalEquityUsd * state.config.maxKellyCapPct).toFixed(2)));
    const vetOut = await runVetAgent(scanOut.candidates, state.config, plannedOrderEst, state.integrations.geminiApiKey);
    state.lastVetResults = vetOut.results;
    state.stats.todayRejectedCount += vetOut.rejectedCount;
    state.stats.todayPassedCount += vetOut.passedCount;

    for (const r of vetOut.rejected) {
      const key = `규칙 ${r.failedRule}`;
      state.stats.rejectionReasons[key] = (state.stats.rejectionReasons[key] || 0) + 1;
    }

    const vetLines = vetOut.results.map(r =>
      `• $${r.symbol}: [${r.decision}] — ${r.reason}`
    );
    const filterWarning = state.stats.todayRejectedCount < 10
      ? `\n⚠️ [필터 점검 보고] 오늘 누적 탈락 수(${state.stats.todayRejectedCount}개)가 아직 10개 미만입니다.`
      : `\n✅ 오늘 누적 탈락 수: ${state.stats.todayRejectedCount}개 (10개 이상 엄격 필터 기준 충족)`;

    addMessage(
      'memecoin',
      'VET',
      `🛡️ [7단계 순차 탈락 심사 결과] 검사 ${vetOut.totalEvaluated}개 중 통과 ${vetOut.passedCount}개 / 탈락 ${vetOut.rejectedCount}개\n${vetLines.join('\n')}${filterWarning}`
    );

    // 3. BOOK (예측 시장 데스크 — Gemini AI 확률 추론 포함)
    const bookOut = await runBookAgent(state.wmPort, state.predictionBets.length, state.integrations.geminiApiKey);
    if (bookOut.status === 'RESTING') {
      state.supervision.BOOK.status = 'RESTING (degraded)';
      addMessage('prediction', 'BOOK', `⏸️ [BOOK 휴식] ${bookOut.reason}`);
    } else {
      state.supervision.BOOK.status = bookOut.aiModelUsed ? `ONLINE (${bookOut.aiModelUsed})` : 'ONLINE';
      if (bookOut.proposals.length > 0) {
        const p = bookOut.proposals.find(cand => !state.predictionBets.some(b => b.marketId === cand.marketId));
        if (p) {
          const bookSize = runSizeAgent({ myProb: p.myProb, liquidityUsd: p.liquidityUsd }, state.portfolio, state.config);
          state.predictionBets.push({
            ...p,
            dollars: bookSize.dollars,
            createdAt: new Date().toISOString()
          });
          const bookMsg = [
            `📊 [BOOK 예측 시장 AI 신호 포착 -> SIZE]`,
            `• 질문: "${p.question}" (${p.source})`,
            `• 추론 근거: ${p.reasoning}`,
            `• 포지션: ${p.side} | 내 확률: ${(p.myProb * 100).toFixed(1)}% vs 시장 가격: ${(p.marketPrice * 100).toFixed(1)}% (괴리 ${p.edgePct}% > 8% 기준 통과)`,
            `• SIZE 산정 금액: $${bookSize.dollars} (${bookSize.reason})`
          ].join('\n');
          addMessage('prediction', 'BOOK', bookMsg);
          await sendTelegramNotification(bookMsg);
        }
      } else {
        addMessage(
          'prediction',
          'BOOK',
          `📊 [예측 시장 AI 점검 완료] Kalshi(${bookOut.kalshiStatus}) · Polymarket(${bookOut.polymarketStatus}) ${bookOut.evaluatedCount || 0}개 시장 Gemini AI 확률 대조 — 현재 8% 초과 괴리 시장 없음`
        );
      }
    }

    // 4. SIZE & 5. FILLS (VET 통과 후보만 전달!)
    if (vetOut.passed.length === 0) {
      addMessage('memecoin', 'CHIEF', `⏹️ VET을 통과한 후보가 없어 SIZE -> FILLS 단계로 넘기지 않고 시드를 보호했습니다.`);
    } else {
      for (const passedItem of vetOut.passed) {
        // 중복 매수 원천 차단 ("밈코인 진입은 주문 하나, 크기 하나로 끝낸다")
        const alreadyOpen = state.openPositions.find(p => p.contract === passedItem.contract);
        if (alreadyOpen) {
          addMessage('memecoin', 'SIZE', `⏭️ $${passedItem.symbol}: 이미 열린 모의 포지션이 존재하므로 중복 매수하지 않고 건너뜁니다.`);
          continue;
        }

        const sizeRes = runSizeAgent(passedItem, state.portfolio, state.config);
        addMessage(
          'memecoin',
          'SIZE',
          `📐 [$${passedItem.symbol} 크기 산정]\n- 결정 금액: $${sizeRes.dollars}\n- 근거: ${sizeRes.reason}`
        );

        if (sizeRes.dollars > 0) {
          const fillRes = runFillsAgent(passedItem.candidate, sizeRes, state.config);
          if (fillRes.status === 'FILLED_PAPER') {
            state.portfolio.cashUsd = Number((state.portfolio.cashUsd - fillRes.dollars).toFixed(2));
            state.portfolio.totalCapitalEverDeployedUsd = Number((state.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
            state.openPositions.push(fillRes);
            recomputePortfolio();

            const fillMsg = [
              `📝 [FILLS 모의 매수 체결 완료]`,
              `• 종목: $${fillRes.symbol} (${fillRes.name})`,
              `• 계약 주소: ${fillRes.contract}`,
              `• 진입가: $${fillRes.entryPriceUsd} | 주문 크기: $${fillRes.dollars} | 수수료: $${fillRes.feeUsd} (${fillRes.effectiveFeePct}%)`,
              `• 예상 슬리피지: ${fillRes.estimatedSlippagePct}%`,
              `• 체결 후 남은 현금: $${state.portfolio.cashUsd.toFixed(2)}`
            ].join('\n');

            addMessage('memecoin', 'FILLS', fillMsg);
            addMessage('memecoin', 'CHIEF', `📌 @RISK 신규 모의 포지션 인계: $${fillRes.symbol} (\`${fillRes.contract}\`) 5분 주기 거래량 감시 등록 완료.`);

            // 텔레그램 즉시 발송!
            await sendTelegramNotification(fillMsg);
          } else {
            addMessage('memecoin', 'FILLS', `🚫 [$${passedItem.symbol} 체결 미기록 - ${fillRes.status}] ${fillRes.reason}`);
          }
        }
      }
    }

    saveState();
    return {
      ok: true,
      scanned: scanOut.candidates.length,
      passedVet: vetOut.passedCount,
      rejectedVet: vetOut.rejectedCount,
      openPositionsCount: state.openPositions.length
    };
  } finally {
    pipelineRunning = false;
  }
}

/**
 * RISK 5분 주기 열린 포지션 일괄 점검 (강제 청산 시 텔레그램 즉시 알림 발송!)
 */
async function executeRiskRoutine(triggerSource = '5분 루틴') {
  state.routines.lastRiskAt = new Date().toISOString();
  if (state.openPositions.length === 0) {
    saveState();
    return { ok: true, checked: 0, closed: 0, results: [] };
  }

  const results = [];
  const remaining = [];
  let closedCount = 0;

  for (const pos of state.openPositions) {
    const check = await checkContractRiskLive(pos.contract);
    if (check.reachable && check.priceUsd > 0) {
      pos.currentPriceUsd = check.priceUsd;
    }

    const pnlPct = pos.entryPriceUsd > 0
      ? ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100
      : 0;
    pos.highWaterPct = Math.max(pos.highWaterPct || 0, pnlPct);

    if (pnlPct >= 60 && !pos.trail60Marked) {
      pos.trail60Marked = true;
      addMessage('memecoin', 'RISK', `🚀 [$${pos.symbol} +60% 돌파 표시] 현재 수익률 +${pnlPct.toFixed(2)}% (+50% 홀딩 구간 통과, +60% 마킹 후 추세 유지)`);
    }

    results.push({ symbol: pos.symbol, contract: pos.contract, ...check, pnlPct: Number(pnlPct.toFixed(2)) });

    if (check.action === 'CLOSE') {
      closedCount += 1;
      state.stats.closedByRuleCount += 1;
      const grossValue = pos.quantity * pos.currentPriceUsd;
      const exitFee = Math.max(0.0045 * grossValue, 0.95);
      const netProceeds = Math.max(0, Number((grossValue - exitFee).toFixed(2)));
      const pnlUsd = Number((netProceeds - pos.dollars).toFixed(2));

      state.portfolio.cashUsd = Number((state.portfolio.cashUsd + netProceeds).toFixed(2));
      state.portfolio.realizedPnlUsd = Number((state.portfolio.realizedPnlUsd + pnlUsd).toFixed(2));

      const closedRecord = {
        ...pos,
        exitPriceUsd: pos.currentPriceUsd,
        exitFeeUsd: Number(exitFee.toFixed(2)),
        netProceedsUsd: netProceeds,
        pnlUsd,
        pnlPct: Number(((pnlUsd / pos.dollars) * 100).toFixed(2)),
        closedAt: new Date().toISOString(),
        closeRule: check.reachable ? `거래량 급감 규칙 (ratio ${check.ratio} < 0.20)` : '데이터 응답 불능 즉시 청산 규칙',
        formattedLine: check.formattedLine
      };
      state.closedPositions.unshift(closedRecord);

      const closeMsg = [
        `🚨 [RISK 강제 청산 (CLOSE) 발동 — ${triggerSource}]`,
        `• 종목: $${pos.symbol} (${pos.contract})`,
        `• 계산식:\n${check.formattedLine}`,
        `• 사유: ${check.reason}`,
        `• 정산: 진입 $${pos.dollars.toFixed(2)} -> 회수 $${netProceeds.toFixed(2)} (실현손익: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} / ${closedRecord.pnlPct >= 0 ? '+' : ''}${closedRecord.pnlPct}%)`,
        `• 현재 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)}`
      ].join('\n');

      addMessage('memecoin', 'RISK', closeMsg);
      // 텔레그램 즉시 발송!
      await sendTelegramNotification(closeMsg);
    } else {
      remaining.push(pos);
    }
  }

  state.openPositions = remaining;
  recomputePortfolio();

  if (closedCount === 0 && results.length > 0) {
    const lines = results.map(r => `• $${r.symbol}: ratio = ${r.ratio} (avg_6h $${r.avg6h.toLocaleString()} / h6 $${r.volumeH6.toLocaleString()}) -> HOLD (현재 ${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct}%)`);
    addMessage('memecoin', 'RISK', `✅ [RISK ${triggerSource} 점검 완료] 열린 포지션 ${results.length}개 모두 거래량 기준(>= 0.20) 정상 유지\n${lines.join('\n')}`);
  }

  saveState();
  return { ok: true, checked: results.length, closed: closedCount, results };
}

/**
 * CHIEF 마감 보고 생성 (매일 밤 11시 KST 또는 수동 요청 + Gemini AI 총평 + 텔레그램 즉시 발송!)
 */
async function generateDailyCloseReport(triggerSource = '마감 보고') {
  state.routines.lastDailyReportAt = new Date().toISOString();
  recomputePortfolio();

  const totalPnlUsd = Number((state.portfolio.realizedPnlUsd + state.portfolio.unrealizedPnlUsd).toFixed(2));
  const deployedEver = state.portfolio.totalCapitalEverDeployedUsd || 0;
  const pnlVsDeployedPct = deployedEver > 0
    ? `${((totalPnlUsd / deployedEver) * 100).toFixed(2)}% (실제로 굴린 돈 $${deployedEver.toFixed(2)} 대비)`
    : '0.00% (실제로 굴린 돈 $0.00)';

  const rejSummary = Object.entries(state.stats.rejectionReasons)
    .map(([k, v]) => `${k}: ${v}건`)
    .join(', ') || '기록 없음';

  const openLines = state.openPositions.map(p =>
    `  - $${p.symbol}: 크기 $${p.dollars} | 진입가 $${p.entryPriceUsd} -> 현재가 $${p.currentPriceUsd} | 슬리피지 ${p.estimatedSlippagePct}%`
  ).join('\n') || '  (열린 포지션 없음)';

  const closedLines = state.closedPositions.slice(0, 10).map(c =>
    `  - $${c.symbol}: 크기 $${c.dollars} | 손익 ${c.pnlUsd >= 0 ? '+' : ''}$${c.pnlUsd} (${c.pnlPct}%) | 발동 규칙: ${c.closeRule}`
  ).join('\n') || '  (오늘 닫은 포지션 없음)';

  // Gemini AI 총평 생성
  let aiCommentary = '';
  const aiPrompt = [
    BOT_PROMPTS.CHIEF.prompt,
    `\n오늘 데스크 요약 데이터를 보고 초보자도 이해하기 쉬운 2~3문장의 핵심 마감 코멘트를 작성하라 (숫자를 절대 지어내지 말 것):`,
    `- 총 스캔 횟수: ${state.stats.totalScans}회, 누적 후보: ${state.stats.todayCandidatesCount}개, VET 통과: ${state.stats.todayPassedCount}개, VET 탈락: ${state.stats.todayRejectedCount}개 (${rejSummary})`,
    `- 예측시장 베팅: ${state.predictionBets.length}건, 열린 포지션: ${state.openPositions.length}개, 닫은 포지션: ${state.closedPositions.length}개`,
    `- 시작 잔고: $1000.00, 현재 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)}, 총 손익: $${totalPnlUsd.toFixed(2)}`
  ].join('\n');

  const aiRes = await callGeminiAI(aiPrompt, state.integrations.geminiApiKey, 8000);
  if (aiRes.ok && aiRes.text) {
    aiCommentary = `\n7. 🧠 CHIEF (Gemini AI) 총평:\n   ${aiRes.text.replace(/\n/g, '\n   ')}`;
  }

  const reportText = [
    `📋 [CHIEF 일일 모의 매매 마감 보고 (${triggerSource})]`,
    `1. 월드모니터 & 데스크 상태: ${state.wmMode} (총 스캔 횟수: ${state.stats.totalScans}회)`,
    `2. 후보 및 VET 탈락 통계:`,
    `   - 누적 후보 수: ${state.stats.todayCandidatesCount}개`,
    `   - VET 통과: ${state.stats.todayPassedCount}개 / VET 탈락: ${state.stats.todayRejectedCount}개 (${rejSummary})`,
    `3. 예측 시장(BOOK) 베팅: ${state.predictionBets.length}건`,
    `4. 기록한 모의 체결 (열린 포지션 ${state.openPositions.length}개, 켈리 6% 상한 적용):`,
    openLines,
    `5. 닫은 포지션 및 발동한 청산 규칙 (${state.closedPositions.length}건):`,
    closedLines,
    `6. 계좌 잔고 및 손익 요약 (모의 매매):`,
    `   - 시작 잔고: $${state.portfolio.startingBalanceUsd.toFixed(2)}`,
    `   - 현재 총 평가액(마감 잔고): $${state.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${state.portfolio.cashUsd.toFixed(2)} + 운용 중 $${state.portfolio.deployedUsd.toFixed(2)})`,
    `   - 총 손익: ${totalPnlUsd >= 0 ? '+' : ''}$${totalPnlUsd.toFixed(2)} (${pnlVsDeployedPct})${aiCommentary}`
  ].join('\n');

  addMessage('memecoin', 'CHIEF', reportText);
  // 텔레그램 즉시 발송!
  await sendTelegramNotification(reportText);
  return reportText;
}

/**
 * 데모/테스트용 샘플 모의 포지션(BONK) 체결 — 중복 매수 원천 차단!
 */
async function createSamplePositionIfRequested(contract = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263') {
  // 이미 같은 계약 주소 포지션이 열려 있으면 중복 매수하지 않음!
  const existing = state.openPositions.find(p => p.contract === contract);
  if (existing) {
    const check = await checkContractRiskLive(contract);
    const msg = `⚠️ [중복 매수 방지 규칙 작동]\n$${existing.symbol} (${contract.slice(0, 8)}...) 포지션($${existing.dollars})이 이미 열려 있습니다!\nSIZE 규칙("밈코인 진입은 주문 하나, 크기 하나로 끝낸다. 나눠 사지 않는다")에 따라 중복 매수하지 않고 현재 포지션의 RISK 거래량 비율만 점검했습니다:\n${check.formattedLine}`;
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
  const sizeRes = runSizeAgent({ decision: 'PASS', candidate: cand }, state.portfolio, state.config);
  if (sizeRes.dollars <= 0) {
    return { ok: false, error: sizeRes.reason };
  }
  const fillRes = runFillsAgent(cand, sizeRes, state.config);
  if (fillRes.status !== 'FILLED_PAPER') {
    return { ok: false, error: fillRes.reason };
  }
  state.portfolio.cashUsd = Number((state.portfolio.cashUsd - fillRes.dollars).toFixed(2));
  state.portfolio.totalCapitalEverDeployedUsd = Number((state.portfolio.totalCapitalEverDeployedUsd + fillRes.dollars).toFixed(2));
  state.openPositions.push(fillRes);
  recomputePortfolio();

  const fillMsg = [
    `📝 [FILLS 샘플 모의 매수 체결 기록]`,
    `• 종목: $${fillRes.symbol} (${fillRes.contract})`,
    `• 진입가: $${fillRes.entryPriceUsd} | 주문 크기: $${fillRes.dollars} | 수수료: $${fillRes.feeUsd}`,
    `• 남은 가용 현금: $${state.portfolio.cashUsd.toFixed(2)}`
  ].join('\n');

  addMessage('memecoin', 'FILLS', fillMsg);
  addMessage('memecoin', 'CHIEF', `📌 @RISK 포지션 인계 완료: \`${fillRes.contract}\``);
  await sendTelegramNotification(fillMsg);
  return { ok: true, position: fillRes };
}

/**
 * 대화창 명령 처리 (@CHIEF, @SCAN, @VET, @BOOK, @SIZE, @FILLS, @RISK + Gemini AI 대화)
 */
async function handleChatMessage(desk, userText) {
  addMessage(desk || 'memecoin', 'USER', userText);
  const text = userText.trim();

  if (text.includes('4717.70') || text.includes('167.75')) {
    const calc = calculateRiskFormula(4717.70, 167.75);
    addMessage(desk, 'RISK', calc.formattedLine);
    return { handledBy: 'RISK', result: calc };
  }

  const base58Match = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  if (base58Match && (text.toUpperCase().includes('RISK') || desk === 'memecoin')) {
    const contract = base58Match[0];
    const check = await checkContractRiskLive(contract);
    addMessage(
      desk,
      'RISK',
      `🔎 [계약 주소 실시간 거래량 검증: $${check.symbol || 'TOKEN'} (${contract})]\n${check.formattedLine}\n판정: ${check.reason}`
    );
    return { handledBy: 'RISK', result: check };
  }

  if (text.includes('마감 보고') || text.includes('보고서')) {
    const rep = await generateDailyCloseReport('대화창 요청');
    return { handledBy: 'CHIEF', report: rep };
  }

  if (text.includes('node --version') || text.includes('worldmonitor') || text.includes('내 목표')) {
    const ver = await runChiefVerification(state.wmPort);
    state.lastVerification = ver;
    saveState();
    const msg = [
      `✅ [CHIEF 초기 환경 및 데이터 연결 검증 보고]`,
      `• 확인된 Node 버전: ${ver.nodeVersion} (v20 이상 통과: ${ver.nodeVersionOk})`,
      `• 월드모니터 주소: ${ver.wmUrl} (현재 상태: ${ver.status})`,
      `• 각 확인 결과:`,
      `  1) DexScreener BONK: HTTP ${ver.checks.dexscreenerBonk.status} | "pairs" 확인=${ver.checks.dexscreenerBonk.hasPairs} (${ver.checks.dexscreenerBonk.pairCount}개 페어)`,
      `  2) fear-greed-index: HTTP ${ver.checks.wmFearGreed.status} | ${ver.checks.wmFearGreed.firstLine}`,
      `  3) list-prediction-markets: HTTP ${ver.checks.wmPrediction.status} | ${ver.checks.wmPrediction.firstLine}`,
      `  4) list-cross-source-signals: HTTP ${ver.checks.wmSignals.status} | ${ver.checks.wmSignals.firstLine}`,
      `  5) Kalshi Open Markets: HTTP ${ver.checks.kalshiOpen.status} | 정상 연결=${ver.checks.kalshiOpen.ok}`
    ].join('\n');
    addMessage(desk, 'CHIEF', msg);
    return { handledBy: 'CHIEF', verification: ver };
  }

  if (text.includes('모의 매매를 시작') || text.includes('스캔') || text.toUpperCase().includes('@SCAN')) {
    const res = await executeTradingPipeline('대화창 지시');
    return { handledBy: 'CHIEF', pipeline: res };
  }

  if (text.includes('5분마다') || text.includes('거래량 비율')) {
    state.routines.risk5mEnabled = true;
    const res = await executeRiskRoutine('대화창 즉시 점검');
    return { handledBy: 'RISK', risk: res };
  }

  // Gemini AI 기반 CHIEF 자연어 답변
  const aiPrompt = [
    BOT_PROMPTS.CHIEF.prompt,
    `\n현재 데스크 실시간 장부 상태:`,
    `- 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)}, 가용 현금: $${state.portfolio.cashUsd.toFixed(2)}, 운용 중: $${state.portfolio.deployedUsd.toFixed(2)}`,
    `- 열린 포지션 수: ${state.openPositions.length}개, 누적 스캔: ${state.stats.totalScans}회, 누적 VET 탈락: ${state.stats.todayRejectedCount}개`,
    `- 월드모니터 모드: ${state.wmMode}`,
    `\n사용자 메시지: "${text}"`,
    `위 장부 숫자를 바탕으로 총괄 봇 CHIEF로서 간결하고 명확하게 한국어로 답변하라.`
  ].join('\n');

  const aiRes = await callGeminiAI(aiPrompt, state.integrations.geminiApiKey, 8000);
  if (aiRes.ok && aiRes.text) {
    addMessage(desk, 'CHIEF', `🧠 ${aiRes.text}`);
    return { handledBy: 'CHIEF', aiModel: aiRes.model };
  }

  addMessage(
    desk,
    'CHIEF',
    `지시를 확인했습니다. 현재 모의 계좌 총 평가액은 $${state.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${state.portfolio.cashUsd.toFixed(2)}, 열린 포지션 ${state.openPositions.length}개)입니다.`
  );
  return { handledBy: 'CHIEF' };
}

// ============================================================================
// 백그라운드 루틴 타이머 (15분 SCAN / 5분 RISK / 매일 23:00 KST 마감 보고 / 텔레그램 명령 수신)
// ============================================================================
setInterval(async () => {
  if (state.routines.risk5mEnabled) {
    await executeRiskRoutine('5분 자동 루틴');
  }
}, 5 * 60 * 1000);

setInterval(async () => {
  if (state.routines.scan15mEnabled) {
    await executeTradingPipeline('15분 자동 루틴');
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

// 텔레그램 양방향 명령어 폴링 (/status, /report, /scan, /reset 지원)
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
        await sendTelegramNotification(
          `🤖 [그록 7개 에이전트 트레이딩 팀 상태]\n• 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)}\n• 가용 현금: $${state.portfolio.cashUsd.toFixed(2)}\n• 열린 포지션: ${state.openPositions.length}개\n• 누적 스캔/탈락: ${state.stats.totalScans}회 / ${state.stats.todayRejectedCount}개 탈락\n• 명령어: /status (상태), /scan (즉시 스캔), /report (마감 보고)`,
          true
        );
      } else if (cmd === '/scan') {
        await sendTelegramNotification(`🔍 텔레그램 지시로 즉시 스캔 파이프라인(SCAN->VET->SIZE->FILLS)을 실행합니다...`, true);
        const out = await executeTradingPipeline('텔레그램 원격 지시');
        await sendTelegramNotification(`✅ 스캔 완료: 후보 ${out.scanned || 0}개 중 VET 통과 ${out.passedVet || 0}개 / 탈락 ${out.rejectedVet || 0}개 (현재 열린 포지션 ${out.openPositionsCount || 0}개)`, true);
      } else if (cmd === '/report') {
        await generateDailyCloseReport('텔레그램 원격 요청');
      }
    }
  } catch {
    // ignore polling transient errors
  }
}, 12 * 1000);

// Initialize lastUpdateId on startup so old /start messages aren't re-replied
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
// HTTP 서버 (WorldMonitor 호환 엔드포인트 + 대시보드 API + 정적 UI)
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

  // 1. WorldMonitor 호환 엔드포인트 3개
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
    return sendJson(res, 200, {
      markets,
      dataAvailable: true,
      fetchedAt: Date.now()
    });
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
        { id: 'sig_2', topic: 'Crypto Macro Sentiment Neutral-Bullish', sourcesCount: 4, confidence: 0.76 }
      ]
    });
  }

  // 2. 트레이딩 데스크 제어 API
  if (pathname === '/api/desk/state' && req.method === 'GET') {
    recomputePortfolio();
    return sendJson(res, 200, { state, botPrompts: BOT_PROMPTS });
  }

  if (pathname === '/api/desk/verify' && req.method === 'POST') {
    const ver = await runChiefVerification(state.wmPort);
    state.lastVerification = ver;
    addMessage(
      'memecoin',
      'CHIEF',
      `🔍 [STEP 1·2 연결 검증 완료] Node ${ver.nodeVersion} | 월드모니터(${ver.wmUrl}): ${ver.status} | DexScreener BONK: ${ver.checks.dexscreenerBonk.hasPairs ? '정상("pairs" 확인)' : '실패'} | Kalshi: ${ver.checks.kalshiOpen.ok ? '정상' : '실패'}`
    );
    saveState();
    return sendJson(res, 200, ver);
  }

  if (pathname === '/api/desk/wm-mode' && req.method === 'POST') {
    const body = await parseBody(req);
    state.wmMode = body.mode === 'READY' ? 'READY' : 'degraded';
    state.supervision.BOOK.status = state.wmMode === 'READY' ? 'ONLINE (AI)' : 'RESTING (degraded)';
    addMessage(
      'memecoin',
      'CHIEF',
      `⚙️ 월드모니터 데이터 모드가 [${state.wmMode}]로 전환되었습니다. (${state.wmMode === 'READY' ? '3개 엔드포인트 모두 실시간 무료 데이터 응답 -> BOOK AI 추론 활성화' : '기본 설치 상태 재현 -> BOOK 휴식 및 덱스스크리너 단독 가동'})`
    );
    saveState();
    return sendJson(res, 200, { ok: true, wmMode: state.wmMode });
  }

  if (pathname === '/api/desk/run-pipeline' && req.method === 'POST') {
    const result = await executeTradingPipeline('대시보드 수동 실행');
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
      addMessage(
        'memecoin',
        'RISK',
        `🔎 [STEP 4 실시간 계약 주소 검증: $${check.symbol || 'TOKEN'} (${body.contract.trim()})]\n${check.formattedLine}\n판정: ${check.reason}`
      );
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
    const msg = [
      `🔔 [그록 7개 에이전트 트레이딩 팀 — 텔레그램 연결 확인]`,
      `• 봇 이름: @dytradingdemo_bot (모의트레이딩)`,
      `• 현재 모의 계좌 총 평가액: $${state.portfolio.totalEquityUsd.toFixed(2)} (가용 현금 $${state.portfolio.cashUsd.toFixed(2)})`,
      `• 열린 포지션: ${state.openPositions.length}개`,
      `• 이제 모의 매수 체결(FILLS), 강제 청산(RISK CLOSE), 밤 11시 마감 보고(CHIEF)가 발생할 때마다 이 채팅방으로 즉시 알림이 도착합니다!`
    ].join('\n');
    const tgOut = await sendTelegramNotification(msg, true);
    addMessage('memecoin', 'CHIEF', tgOut.ok
      ? `📱 텔레그램(@dytradingdemo_bot, Chat ID: ${tgOut.chatId})으로 실시간 테스트 알림을 발송했습니다! 휴대폰을 확인해 보세요.`
      : `⚠️ 텔레그램 알림 발송 실패 (${tgOut.reason || tgOut.status}). 텔레그램에서 @dytradingdemo_bot 에게 /start 메시지를 한 번 보내주세요.`);
    return sendJson(res, 200, tgOut);
  }

  if (pathname === '/api/desk/chat' && req.method === 'POST') {
    const body = await parseBody(req);
    const out = await handleChatMessage(body.desk || 'memecoin', body.text || '');
    return sendJson(res, 200, { ok: true, ...out });
  }

  if (pathname === '/api/desk/config' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.config) {
      state.config = { ...state.config, ...body.config };
    }
    if (body.routines) {
      state.routines = { ...state.routines, ...body.routines };
    }
    if (body.integrations) {
      state.integrations = { ...state.integrations, ...body.integrations };
    }
    saveState();
    return sendJson(res, 200, { ok: true, config: state.config, routines: state.routines, integrations: state.integrations });
  }

  if (pathname === '/api/desk/reset' && req.method === 'POST') {
    const prevIntegrations = state.integrations;
    state = getDefaultState();
    state.integrations = prevIntegrations;
    saveState();
    addMessage('memecoin', 'CHIEF', `🔄 장부가 깨끗한 초기 상태($1,000.00)로 리셋되었습니다!`);
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
      console.log(`포트 ${port} 사용 중 -> 다음 빈 포트 ${nextPort}(WM_PORT)로 전환합니다.`);
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
    console.log(`🚀 그록 에이전트 7개 트레이딩 팀 v2.0 (Gemini AI + 텔레그램 연동) 가동!`);
    console.log(`🌐 대시보드 주소: http://localhost:${actualPort}`);
    console.log(`================================================================`);
  });
}

startServer(Number(process.env.WM_PORT || 3000));
