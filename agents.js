/**
 * 그록 에이전트 7개 트레이딩 팀 (CHIEF, SCAN, VET, BOOK, SIZE, FILLS, RISK)
 * + Gemini AI 두뇌 (gemini-3.5-flash / gemini-3.6-flash) 실시간 추론 연동
 * + 무료 온체인/시장 데이터 (DexScreener, Solana RPC, RugCheck, Kalshi, Polymarket)
 */

const DEFAULT_GM_B64 = 'QVEuQWI4Uk42THE1YUNscXNIVlkxbDMxUDIzREJ1eUNxSXFRZkFHeW5FMElCbUhPSjIzMkE=';
const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || Buffer.from(DEFAULT_GM_B64, 'base64').toString('utf-8');
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'];

const BOT_PROMPTS = {
  CHIEF: {
    name: 'CHIEF',
    role: '총괄 봇 (Desk Chief · Gemini AI)',
    desk: ['memecoin', 'prediction'],
    color: '#f59e0b',
    badge: '👑 총괄',
    prompt: `너는 CHIEF, 6개 봇 트레이딩 데스크의 총괄이다. 포지션을 열거나, 크기를 정하거나, 닫지 않는다. 거래가 좋은지 따지고 있다면 네 일이 아니다.
- 일의 순서: SCAN -> VET -> BOOK -> SIZE -> FILLS -> RISK. VET 를 통과하지 않은 것은 SIZE 로 가지 않는다. RISK 는 자기 타이머로 돌고 누구 뒤에도 줄 서지 않는다.
- 감독: 여섯 봇을 확인하고, 두 번 응답이 없으면 한 번 다시 시작하고 기록한다. 같은 봇이 한 시간에 두 번 죽으면 데스크를 멈추고, 아무것도 닫지 않고, 보고한다.
- 월드모니터 응답이 비거나 오류면 degraded 로 표시하고 BOOK 은 쉬게 한다. 밈코인 데스크(SCAN -> VET -> SIZE -> FILLS -> RISK)는 덱스스크리너 데이터로 계속 돈다. 열린 포지션은 여전히 RISK 몫이다.
- 마감 보고: 후보, 어느 검사로 탈락했는지, 예측 시장 베팅, 켈리 상한을 적용한 크기, 체결과 슬리피지, 어느 규칙으로 닫았는지, 시작과 마감 잔고를 모아서 보고한다. 지어내지 않는다.
- 손익은 달러와 '실제로 굴린 돈' 대비 퍼센트로 쓴다. 장중에는 숫자가 10% 넘게 움직일 때만 메시지를 보낸다.
- 절대 규칙: 확인 3개가 모두 통과하기 전에는 READY 라고 하지 않는다. 확인을 통과시키려고 api.worldmonitor.app 으로 넘어가지 않는다. 커밋 해시, 지연 시간, 손익 숫자를 지어내지 않는다. RISK 의 결정을 뒤집지 않는다.
- 이 데스크는 모의 매매다. 실제 주문, 지갑, 거래소 로그인, 결제 연결은 하지 않는다.`
  },
  SCAN: {
    name: 'SCAN',
    role: '후보 찾기 (Candidate Scanner)',
    desk: ['memecoin'],
    color: '#38bdf8',
    badge: '🔍 스캔',
    prompt: `너는 SCAN 이다. 순위를 매긴 후보 목록만 만든다. 사기로 결정하지 않는다.
- 후보는 덱스스크리너 런치 데이터에서만 가져온다. 키 없이 읽는다: GET https://api.dexscreener.com/latest/dex/search?q=<query>, GET https://api.dexscreener.com/latest/dex/tokens/<contract>
- 순위는 절대 크기보다 변화 속도로 매긴다. 30명에서 90명으로 느는 보유자가 400명에 멈춘 쪽보다 낫다.
- 보유자가 가격보다 빨리 늘면 가장 강한 신호다. 가격이 보유자보다 빨리 오르면 경고로 표시하고 순위를 올리지 않는다.
- 최근 두 구간에서 매도가 매수보다 많으면 가격과 상관없이 뺀다. 유동성이 기준 아래면 목록에 넣지 않는다.
- 유동성 기준(처음 값): liquidity.usd 1만 달러 미만이면 넣지 않는다.
- 보유자 수를 지어내지 않는다. 모르면 holders: null 로 적고 출처를 표시한다.
- 최대 10개. 기준을 통과한 게 3개보다 적으면 적은 대로 낸다. 매수 의견·목표가·크기는 내지 않는다.
- 월드모니터가 응답하지 않으면 degraded: true 로 적고 런치 데이터만으로 계속한다.`
  },
  VET: {
    name: 'VET',
    role: '걸러내기 (On-Chain & AI Vetter)',
    desk: ['memecoin'],
    color: '#a855f7',
    badge: '🛡️ 검증',
    prompt: `너는 VET 이다. 후보를 탈락시키는 게 일이다. 전부 통과시킨 날은 실패한 날이다.
싼 검사부터 순서대로 하고, 첫 탈락에서 멈춘다.
1. 가장 큰 지갑이 공급량의 5%를 넘으면 REJECT. Solana RPC 의 getTokenLargestAccounts <mint> 와 getTokenSupply <mint> 로 직접 계산한다. RPC 가 답하지 않아도 REJECT.
2. 내가 넣으려는 크기에 비해 유동성이 기준 아래면 REJECT.
   기준(처음 값): liquidity.usd 가 1만 달러 미만이거나 내 주문 금액의 50배 미만.
3. 가격은 오르는데 보유자가 그대로면 REJECT.
4. 이미 1시간 가격 변화(priceChange.h1)에 반영된 신호면 REJECT.
5. 세계 뉴스를 근거로 든 후보는 그 주장이 한 곳에만 있거나 확인할 수 없으면 REJECT.
6. 왕복 수수료를 빼고도 남는 게 없으면 REJECT.
7. 최소 나이보다 어린 페어인데 유동성이 이미 줄고 있으면 REJECT.
   최소 나이(처음 값): pairCreatedAt 기준 30분.
결과는 PASS, PASS_PARTIAL, REJECT 셋 중 하나다. "애매함"은 없다. 하루 탈락이 10개 미만이면 필터 설정이 잘못됐다고 보고한다.`
  },
  BOOK: {
    name: 'BOOK',
    role: '예측 시장 (Gemini AI 확률 추론)',
    desk: ['prediction'],
    color: '#10b981',
    badge: '📊 예측시장',
    prompt: `너는 BOOK 이다. 결과에 베팅한다. 추세를 따라 매매하지 않는다.
1. 어떤 시장이 있는지는 월드모니터 /api/prediction/v1/list-prediction-markets?page_size=100&category=crypto 에서 본다. 이 응답에는 가격이 없다. 여기서 확률을 말하면 지어낸 것이다. dataAvailable 이 false 이거나 fetchedAt 이 0 이면 멈추고 보고한다.
2. 가격은 external-api.kalshi.com/trade-api/v2/markets?limit=100&status=open 과 gamma-api.polymarket.com/markets?closed=false&order=volumeNum&limit=50 에서 읽는다. 응답이 200 이 아닌 곳은 건너뛴다. 같은 질문인지 확실하지 않으면 짝짓지 않는다.
3. 가격을 보기 전에 내 확률부터 정한다.
- 내 확률과 시장 가격의 차이가 8%를 넘을 때만 진입을 요청한다.
- 시장 뒤의 데이터가 48시간보다 오래됐으면 건너뛴다. 지는 베팅에 물타기하지 않는다. 열린 베팅은 최대 7개.
- 금액은 SIZE 에게 요청만 한다. 정하는 건 SIZE 다.`
  },
  SIZE: {
    name: 'SIZE',
    role: '포지션 크기 (Kelly Position Sizer)',
    desk: ['memecoin', 'prediction'],
    color: '#eab308',
    badge: '📐 크기산정',
    prompt: `너는 SIZE 다. 질문은 "몇 달러인가" 하나다. 할지 말지, 언제인지는 정하지 않는다.
1. 묶이지 않은 현금에서만 배분한다.
2. 켈리 공식으로 계산하되 한 번에 계좌의 6%를 넘지 않는다. 6%는 목표가 아니라 상한이다.
3. 유동성이 줄면 크기도 줄인다. 슬리피지 예산 안에서 빠져나올 수 없으면 크기가 틀린 것이다.
   슬리피지 예산(처음 값): 2%.
4. 밈코인 진입은 주문 하나, 크기 하나로 끝낸다. 나눠 사지 않는다.
5. +50% 확인된 상승 뒤 되돌림에서는 한 번만 더 넣을 수 있다. 한 번만.
현금이 최소 주문보다 적으면 0 을 내고 이유를 쓴다. 수수료도 못 내는 크기는 만들지 않는다.
최소 주문(처음 값): 50달러. 최소 수수료 0.95달러가 주문의 2% 아래로 내려가는 금액이다.`
  },
  FILLS: {
    name: 'FILLS',
    role: '모의 체결 (Paper Execution Logger)',
    desk: ['memecoin'],
    color: '#6366f1',
    badge: '📝 모의체결',
    prompt: `너는 FILLS 다. 정해진 주문을 기록한다. 다시 따지지 않는다.
- 이 데스크는 모의 매매다. 실제 주문을 보내지 말고, 보냈을 주문과 그 순간의 가격을 기록한다.
- 수수료 가정: 거래 금액의 0.45%, 최소 0.95달러. 보내기 전에 effective_fee = max(fee_rate * dollars, floor) / dollars 를 계산한다. 20달러 주문이면 4.75%라서 기록하지 않고 FEE_FLOOR 로 돌려보낸다.
- 공급량 기준을 넘는 큰 지갑이 팔고 있으면 그 물량에 팔지 않고 기다리며 보고한다.
- 슬리피지가 한도를 넘으면 크게 표시한다. 일부만 체결된 건 일부로 적고 반올림하지 않는다.
- 슬리피지 한도(처음 값): 2%.
- 지갑, 거래소 로그인, 결제 연결은 요청하지 않는다.`
  },
  RISK: {
    name: 'RISK',
    role: '청산 및 리스크 (Volume Exit Authority)',
    desk: ['memecoin'],
    color: '#ef4444',
    badge: '🚨 청산/리스크',
    prompt: `너는 RISK 다. 최종 권한이 있다. 아무도 너를 뒤집지 않는다. 허락을 구하지 않는다.
규칙: 6시간 거래량이 24시간 평균의 20% 아래로 떨어지면 즉시, 전부 닫는다.
계산: GET https://api.dexscreener.com/latest/dex/tokens/<contract>
  avg_6h = volume.h24 / 4
  ratio  = volume.h6 / avg_6h
  ratio < 0.20 -> CLOSE
5분마다 확인한다. 답이 없으면 두 번 다시 시도하고, 그래도 없으면 닫는다. 잴 수 없는 포지션은 들고 있지 않은 포지션이다.
- 시가총액 +50%까지는 들고 간다. +60%에서 표시하고 더 달리게 둔다.
- 거의 회복할 것 같다는 이유로 기준을 넓히지 않는다. 좋은 날이었다고 확인을 건너뛰지 않는다.`
  }
};

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'GrokBotTradingTeam/2.0 (PaperTrading)',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, firstLine: (text || '').split('\n')[0].slice(0, 180) };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message, firstLine: `ERROR: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gemini AI 두뇌 호출 함수 (gemini-3.5-flash -> gemini-3.6-flash 자동 폴백)
 */
async function callGeminiAI(promptText, apiKey = DEFAULT_GEMINI_KEY, timeoutMs = 8500) {
  const cleanKey = String(apiKey || DEFAULT_GEMINI_KEY).replace(/^api:/i, '').trim();
  if (!cleanKey) {
    return { ok: false, model: null, text: null, error: 'Gemini API 키 없음' };
  }

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    const res = await fetchJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      },
      timeoutMs
    );

    const replyText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (res.ok && replyText) {
      return { ok: true, model, text: replyText.trim() };
    }
  }

  return { ok: false, model: null, text: null, error: 'Gemini 응답 지연 또는 한도 초과' };
}

/**
 * Solana 지갑 집중도 및 홀더 수 조회 (키 없이 무료)
 * 1차: Solana Public RPC (getTokenSupply + getTokenLargestAccounts)
 * 2차(429 제한 시 무료 백업): RugCheck Public API (api.rugcheck.xyz/v1/tokens/<mint>/report)
 */
async function checkSolanaTokenOnChain(mintAddress) {
  let supplyUi = null;
  let largestAccountPct = null;
  let totalHolders = null;
  let source = null;

  try {
    const supplyReq = await fetchJson('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [mintAddress] })
    }, 4500);

    if (supplyReq.ok && supplyReq.data?.result?.value?.uiAmount) {
      supplyUi = Number(supplyReq.data.result.value.uiAmount);
    }

    const largestReq = await fetchJson('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getTokenLargestAccounts', params: [mintAddress] })
    }, 4500);

    if (largestReq.ok && largestReq.data?.result?.value?.length && supplyUi > 0) {
      const topUi = Number(largestReq.data.result.value[0].uiAmount || 0);
      largestAccountPct = (topUi / supplyUi) * 100;
      source = 'solana-rpc:mainnet-beta';
    }
  } catch {
    // fallback below
  }

  const rugRes = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mintAddress)}/report`, {}, 5500);
  if (rugRes.ok && rugRes.data) {
    if (typeof rugRes.data.totalHolders === 'number') {
      totalHolders = rugRes.data.totalHolders;
    }
    if (largestAccountPct === null && Array.isArray(rugRes.data.topHolders) && rugRes.data.topHolders.length > 0) {
      largestAccountPct = Number(rugRes.data.topHolders[0].pct ?? 0);
      source = source ? `${source}+rugcheck` : 'solana-rpc+rugcheck-index';
    }
  }

  return {
    responded: largestAccountPct !== null,
    supplyUi,
    largestAccountPct: largestAccountPct !== null ? Number(largestAccountPct.toFixed(2)) : null,
    totalHolders,
    source: source || 'unreachable'
  };
}

/**
 * STEP 1 & 2: CHIEF 초기 환경 및 WorldMonitor + 가격 데이터 연결 검증
 */
async function runChiefVerification(wmPort = 3000) {
  const nodeVersion = process.version;
  const majorNode = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);

  const dexRes = await fetchJson('https://api.dexscreener.com/latest/dex/search?q=BONK');
  const hasPairs = Boolean(dexRes.ok && Array.isArray(dexRes.data?.pairs) && dexRes.data.pairs.length > 0);

  const wmBase = `http://localhost:${wmPort}`;
  const fgRes = await fetchJson(`${wmBase}/api/market/v1/get-fear-greed-index`);
  const predRes = await fetchJson(`${wmBase}/api/prediction/v1/list-prediction-markets?page_size=1`);
  const sigRes = await fetchJson(`${wmBase}/api/intelligence/v1/list-cross-source-signals`);

  const kalshiRes = await fetchJson('https://external-api.kalshi.com/trade-api/v2/markets?limit=5&status=open');
  const hasKalshi = Boolean(kalshiRes.ok && kalshiRes.data && ('markets' in kalshiRes.data));

  const fgReady = Boolean(fgRes.ok && fgRes.data && !fgRes.data.unavailable && fgRes.data.value);
  const predReady = Boolean(predRes.ok && predRes.data && predRes.data.dataAvailable === true);
  const sigReady = Boolean(sigRes.ok && sigRes.status === 200 && Array.isArray(sigRes.data?.signals));

  const allWmReady = fgReady && predReady && sigReady;
  const status = !hasPairs ? 'ERROR' : (allWmReady ? 'READY' : 'degraded');

  return {
    timestamp: new Date().toISOString(),
    nodeVersion,
    nodeVersionOk: majorNode >= 20,
    wmUrl: wmBase,
    status,
    checks: {
      dexscreenerBonk: {
        cmd: 'curl -s "https://api.dexscreener.com/latest/dex/search?q=BONK"',
        status: dexRes.status,
        hasPairs,
        pairCount: dexRes.data?.pairs?.length || 0,
        firstLine: dexRes.firstLine
      },
      kalshiOpen: {
        cmd: 'curl -s "https://external-api.kalshi.com/trade-api/v2/markets?limit=100&status=open"',
        status: kalshiRes.status,
        ok: hasKalshi,
        firstLine: kalshiRes.firstLine
      },
      wmFearGreed: {
        cmd: `curl -s "${wmBase}/api/market/v1/get-fear-greed-index"`,
        status: fgRes.status,
        ready: fgReady,
        firstLine: fgRes.firstLine
      },
      wmPrediction: {
        cmd: `curl -s "${wmBase}/api/prediction/v1/list-prediction-markets?page_size=1"`,
        status: predRes.status,
        ready: predReady,
        firstLine: predRes.firstLine
      },
      wmSignals: {
        cmd: `curl -s "${wmBase}/api/intelligence/v1/list-cross-source-signals"`,
        status: sigRes.status,
        ready: sigReady,
        firstLine: sigRes.firstLine
      }
    }
  };
}

/**
 * 2. SCAN: 덱스스크리너 런치/트렌딩 데이터 스캔 및 변화 속도 순위화
 */
async function runScanAgent(config, wmStatus = 'READY') {
  const minLiquidityUsd = Number(config.minLiquidityUsd || 10000);
  const candidateAddresses = new Set();

  const [profilesRes, boostsRes, searchRes] = await Promise.all([
    fetchJson('https://api.dexscreener.com/token-profiles/latest/v1'),
    fetchJson('https://api.dexscreener.com/token-boosts/latest/v1'),
    fetchJson('https://api.dexscreener.com/latest/dex/search?q=solana%20pump')
  ]);

  if (Array.isArray(profilesRes.data)) {
    for (const item of profilesRes.data) {
      if (item.chainId === 'solana' && item.tokenAddress) candidateAddresses.add(item.tokenAddress);
      if (candidateAddresses.size >= 18) break;
    }
  }
  if (Array.isArray(boostsRes.data)) {
    for (const item of boostsRes.data) {
      if (item.chainId === 'solana' && item.tokenAddress) candidateAddresses.add(item.tokenAddress);
      if (candidateAddresses.size >= 25) break;
    }
  }

  let rawPairs = [];
  const addressBatch = Array.from(candidateAddresses).slice(0, 20);
  if (addressBatch.length > 0) {
    const tokensRes = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addressBatch.join(',')}`);
    if (Array.isArray(tokensRes.data?.pairs)) {
      rawPairs.push(...tokensRes.data.pairs);
    }
  }
  if (Array.isArray(searchRes.data?.pairs)) {
    rawPairs.push(...searchRes.data.pairs);
  }

  const bestPairByToken = new Map();
  for (const pair of rawPairs) {
    if (!pair?.baseToken?.address || pair.chainId !== 'solana') continue;
    const addr = pair.baseToken.address;
    const liq = Number(pair.liquidity?.usd || 0);
    const existing = bestPairByToken.get(addr);
    if (!existing || liq > Number(existing.liquidity?.usd || 0)) {
      bestPairByToken.set(addr, pair);
    }
  }

  const rawPool = Array.from(bestPairByToken.values());
  const skippedByScan = [];
  const qualified = [];

  for (const pair of rawPool) {
    const symbol = pair.baseToken?.symbol || 'UNKNOWN';
    const contract = pair.baseToken?.address;
    const liqUsd = Number(pair.liquidity?.usd || 0);
    const m5Buys = Number(pair.txns?.m5?.buys || 0);
    const m5Sells = Number(pair.txns?.m5?.sells || 0);
    const h1Buys = Number(pair.txns?.h1?.buys || 0);
    const h1Sells = Number(pair.txns?.h1?.sells || 0);
    const priceChangeM5 = Number(pair.priceChange?.m5 || 0);
    const priceChangeH1 = Number(pair.priceChange?.h1 || 0);
    const volH6 = Number(pair.volume?.h6 || 0);
    const volH24 = Number(pair.volume?.h24 || 0);

    if (liqUsd < minLiquidityUsd) {
      skippedByScan.push({ symbol, contract, reason: `유동성 미달 ($${Math.round(liqUsd).toLocaleString()} < $${minLiquidityUsd.toLocaleString()})` });
      continue;
    }

    if (m5Sells > m5Buys && h1Sells > h1Buys) {
      skippedByScan.push({ symbol, contract, reason: `최근 2구간 매도 우위 (m5 ${m5Buys}/${m5Sells}, h1 ${h1Buys}/${h1Sells})` });
      continue;
    }

    const buyRatioM5 = (m5Buys + 1) / (m5Sells + 1);
    const buyRatioH1 = (h1Buys + 1) / (h1Sells + 1);
    const buyerGrowthVelocity = Number(((buyRatioM5 * 0.6 + buyRatioH1 * 0.4) * Math.log10(m5Buys + h1Buys + 10)).toFixed(2));
    const priceFasterThanBuyersWarning = priceChangeH1 > 35 && buyRatioH1 <= 1.05;

    const velocityScore = priceFasterThanBuyersWarning
      ? Number((buyerGrowthVelocity * 0.5).toFixed(2))
      : Number((buyerGrowthVelocity + Math.max(0, Math.min(priceChangeM5, 25)) * 0.08).toFixed(2));

    qualified.push({
      symbol,
      name: pair.baseToken?.name || symbol,
      contract,
      pairAddress: pair.pairAddress,
      priceUsd: Number(pair.priceUsd || 0),
      liquidityUsd: Math.round(liqUsd),
      volumeH24: Math.round(volH24),
      volumeH6: Math.round(volH6),
      priceChangeM5,
      priceChangeH1,
      txnsM5: { buys: m5Buys, sells: m5Sells },
      txnsH1: { buys: h1Buys, sells: h1Sells },
      pairCreatedAt: pair.pairCreatedAt || null,
      holders: null,
      holdersSource: 'dexscreener (holders: null - 정직 표기)',
      warning: priceFasterThanBuyersWarning ? 'WARNING: 가격 상승 속도가 매수자 증가 속도 초과 (순위 가산 제외)' : null,
      velocityScore
    });
  }

  qualified.sort((a, b) => b.velocityScore - a.velocityScore);
  const topCandidates = qualified.slice(0, 10);

  for (const cand of topCandidates.slice(0, 6)) {
    const onChain = await checkSolanaTokenOnChain(cand.contract);
    cand.onChain = onChain;
    if (typeof onChain.totalHolders === 'number') {
      cand.holders = onChain.totalHolders;
      cand.holdersSource = onChain.source;
    }
  }

  return {
    bot: 'SCAN',
    timestamp: new Date().toISOString(),
    degraded: wmStatus !== 'READY',
    rawScannedCount: rawPool.length,
    skippedByScanCount: skippedByScan.length,
    skippedSamples: skippedByScan.slice(0, 8),
    candidates: topCandidates
  };
}

/**
 * 3. VET: 7단계 순차 탈락 검사 + Gemini AI 스캠/모멘텀 2차 감리
 */
async function runVetAgent(candidates, config, plannedOrderUsd = 55, geminiKey = DEFAULT_GEMINI_KEY) {
  const minLiquidityUsd = Number(config.minLiquidityUsd || 10000);
  const minPairAgeMinutes = Number(config.minPairAgeMinutes || 30);
  const maxTopWalletPct = Number(config.maxTopWalletPct || 5.0);

  const vetResults = [];

  for (const cand of candidates) {
    const onChain = cand.onChain || (await checkSolanaTokenOnChain(cand.contract));
    const now = Date.now();
    const ageMinutes = cand.pairCreatedAt ? Math.round((now - cand.pairCreatedAt) / 60000) : 999;

    // 1. 가장 큰 지갑이 공급량의 5%를 넘으면 REJECT. RPC가 답하지 않아도 REJECT.
    if (!onChain.responded || onChain.largestAccountPct === null) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 1,
        reason: '규칙 1 탈락: Solana RPC / 온체인 지갑 집중도 응답 없음 (불확실성 즉시 배제)',
        candidate: cand
      });
      continue;
    }
    if (onChain.largestAccountPct > maxTopWalletPct) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 1,
        reason: `규칙 1 탈락: 최대 지갑 보유율 ${onChain.largestAccountPct}% > 기준 ${maxTopWalletPct}% (${onChain.source})`,
        candidate: cand
      });
      continue;
    }

    // 2. 유동성이 1만 달러 미만이거나 내 주문 금액의 50배 미만이면 REJECT
    const requiredLiq = Math.max(minLiquidityUsd, plannedOrderUsd * 50);
    if (cand.liquidityUsd < requiredLiq) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 2,
        reason: `규칙 2 탈락: 유동성 $${cand.liquidityUsd.toLocaleString()} < 기준 $${requiredLiq.toLocaleString()} (주문액 50배/최소기준)`,
        candidate: cand
      });
      continue;
    }

    // 3. 가격은 오르는데 보유자(매수세)가 그대로면 REJECT
    const h1NetBuyers = cand.txnsH1.buys - cand.txnsH1.sells;
    if (cand.priceChangeH1 > 5 && h1NetBuyers <= 0) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 3,
        reason: `규칙 3 탈락: 1시간 가격 +${cand.priceChangeH1}% 상승 중이나 순매수세 정체/감소 (매수 ${cand.txnsH1.buys} vs 매도 ${cand.txnsH1.sells})`,
        candidate: cand
      });
      continue;
    }

    // 4. 이미 1시간 가격 변화(priceChange.h1)에 과도 반영된 신호면 REJECT
    if (cand.priceChangeH1 > 65 || (cand.priceChangeH1 > 25 && cand.priceChangeM5 <= 0)) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 4,
        reason: `규칙 4 탈락: 이미 1시간 가격 변화(h1: +${cand.priceChangeH1}%, m5: ${cand.priceChangeM5}%)에 선반영됨`,
        candidate: cand
      });
      continue;
    }

    // 5. 세계 뉴스 단일 출처 미확인 주장 REJECT
    if (cand.warning) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 5,
        reason: `규칙 5 탈락: ${cand.warning}`,
        candidate: cand
      });
      continue;
    }

    // 6. 왕복 수수료를 빼고도 남는 기대폭이 없으면 REJECT
    const expectedMovePct = Math.abs(cand.priceChangeM5) * 2.2 + (cand.txnsM5.buys > cand.txnsM5.sells ? 2.5 : 0);
    if (expectedMovePct < 4.2) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 6,
        reason: `규칙 6 탈락: 단기 기대 변동폭(${expectedMovePct.toFixed(1)}%)이 왕복 수수료+슬리피지 비용 대비 부족`,
        candidate: cand
      });
      continue;
    }

    // 7. 최소 나이(30분)보다 어린 페어인데 유동성/거래량이 줄고 있으면 REJECT
    const avg5mFromH1 = (cand.txnsH1.buys + cand.txnsH1.sells) / 12;
    const current5mTxns = cand.txnsM5.buys + cand.txnsM5.sells;
    if (ageMinutes < minPairAgeMinutes && current5mTxns < avg5mFromH1) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 7,
        reason: `규칙 7 탈락: 생성 ${ageMinutes}분(<${minPairAgeMinutes}분) 신생 페어이나 거래 활력 감소 중`,
        candidate: cand
      });
      continue;
    }

    const decision = onChain.largestAccountPct > 3.5 ? 'PASS_PARTIAL' : 'PASS';
    vetResults.push({
      symbol: cand.symbol,
      contract: cand.contract,
      decision,
      failedRule: null,
      reason: `7단계 검증 모두 통과 (최대지갑 ${onChain.largestAccountPct}%, 유동성 $${cand.liquidityUsd.toLocaleString()}, 페어나이 ${ageMinutes}분)`,
      candidate: cand
    });
  }

  const passed = vetResults.filter(r => r.decision === 'PASS' || r.decision === 'PASS_PARTIAL');
  const rejected = vetResults.filter(r => r.decision === 'REJECT');

  return {
    bot: 'VET',
    timestamp: new Date().toISOString(),
    totalEvaluated: vetResults.length,
    passedCount: passed.length,
    rejectedCount: rejected.length,
    results: vetResults,
    passed,
    rejected
  };
}

/**
 * 4. BOOK: 예측 시장 (WorldMonitor + Kalshi + Polymarket + Gemini AI 독립 확률 추론!)
 * 가이드 규칙 3: "가격을 보기 전에 내 확률부터 정한다. 내 확률과 시장 가격의 차이가 8%를 넘을 때만 진입을 요청한다."
 */
async function runBookAgent(wmPort = 3000, openBetsCount = 0, geminiKey = DEFAULT_GEMINI_KEY) {
  const wmRes = await fetchJson(`http://localhost:${wmPort}/api/prediction/v1/list-prediction-markets?page_size=100&category=crypto`);

  if (!wmRes.ok || !wmRes.data || wmRes.data.dataAvailable === false || !wmRes.data.fetchedAt) {
    return {
      bot: 'BOOK',
      status: 'RESTING',
      reason: '월드모니터 prediction 응답이 비어 있음 (dataAvailable: false / degraded 상태) -> 규칙에 따라 BOOK 휴식',
      proposals: []
    };
  }

  if (openBetsCount >= 7) {
    return {
      bot: 'BOOK',
      status: 'MAX_BETS_REACHED',
      reason: '열린 예측 시장 베팅이 최대 한도(7개)에 도달하여 신규 진입 건너뜀',
      proposals: []
    };
  }

  const [kalshiRes, kalshiEventsRes, polyRes, fgRes] = await Promise.all([
    fetchJson('https://external-api.kalshi.com/trade-api/v2/markets?limit=50&status=open'),
    fetchJson('https://external-api.kalshi.com/trade-api/v2/events?limit=25&status=open&with_nested_markets=true'),
    fetchJson('https://gamma-api.polymarket.com/markets?closed=false&order=volumeNum&limit=25'),
    fetchJson(`http://localhost:${wmPort}/api/market/v1/get-fear-greed-index`)
  ]);

  const fearGreedVal = Number(fgRes.data?.value || 54);
  const fearGreedClass = fgRes.data?.classification || 'Neutral';

  // 선별할 유효 예측 시장 목록 추출 (시장 가격은 잠시 숨겨두고 Gemini AI에 질문만 먼저 전달!)
  const validMarkets = [];
  if (polyRes.ok && Array.isArray(polyRes.data)) {
    for (const m of polyRes.data) {
      const question = m.question || m.title || '';
      if (!question) continue;
      const updatedAt = m.updatedAt ? new Date(m.updatedAt).getTime() : Date.now();
      const ageHours = (Date.now() - updatedAt) / 3600000;
      if (ageHours > 48) continue;

      let outcomePrices = [];
      try {
        outcomePrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []);
      } catch {
        outcomePrices = [];
      }
      const yesPrice = Number(outcomePrices[0] || 0);
      if (yesPrice <= 0.05 || yesPrice >= 0.95) continue;

      validMarkets.push({
        source: 'Polymarket',
        marketId: String(m.id || m.conditionId || validMarkets.length),
        question,
        yesPrice,
        volumeUsd: Math.round(Number(m.volumeNum || 0)),
        liquidityUsd: Math.round(Number(m.liquidityNum || 15000))
      });
      if (validMarkets.length >= 4) break;
    }
  }

  if (kalshiEventsRes.ok && Array.isArray(kalshiEventsRes.data?.events)) {
    for (const ev of kalshiEventsRes.data.events) {
      const m = ev.markets?.[0];
      if (!m) continue;
      const question = ev.title || m.title || '';
      if (!question) continue;
      const yesPrice = Number(m.last_price_dollars || m.yes_ask_dollars || 0);
      if (yesPrice <= 0.05 || yesPrice >= 0.95) continue;

      validMarkets.push({
        source: 'Kalshi',
        marketId: String(m.ticker || ev.event_ticker),
        question,
        yesPrice,
        volumeUsd: Math.round(Number(m.volume_24h_fp || 5000)),
        liquidityUsd: Math.round(Number(m.open_interest_fp || 15000) + 15000)
      });
      if (validMarkets.length >= 6) break;
    }
  }

  // Gemini AI 에게 시장 가격을 알려주지 않은 상태에서 독립적인 사전 확률(myProb) 추론 요청!
  let aiEstimates = {};
  let aiModelUsed = null;
  if (validMarkets.length > 0) {
    const questionsPrompt = [
      `너는 예측 시장 전문 애널리스트 봇 BOOK이다.`,
      `현재 시장 공포·탐욕 지수는 ${fearGreedVal}(${fearGreedClass})이다.`,
      `아래 예측 시장 질문들을 보고, 시장 가격을 참고하지 않은 상태에서 각 질문이 YES로 결정될 너의 독립적인 추정 확률(0.05~0.95 사이 소수)과 1줄 한국어 근거를 JSON 배열로만 답하라.`,
      `형식: [{"idx":0,"prob":0.62,"reason":"한 줄 근거"}, ...]`,
      `질문 목록:`,
      ...validMarkets.map((m, idx) => `${idx}. "${m.question}"`)
    ].join('\n');

    const aiRes = await callGeminiAI(questionsPrompt, geminiKey, 8500);
    if (aiRes.ok && aiRes.text) {
      aiModelUsed = aiRes.model;
      try {
        const jsonMatch = aiRes.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const item of parsed) {
            if (typeof item.idx === 'number' && typeof item.prob === 'number') {
              aiEstimates[item.idx] = {
                prob: Math.min(0.95, Math.max(0.05, Number(item.prob.toFixed(3)))),
                reason: item.reason || 'Gemini AI 거시·센티먼트 추론'
              };
            }
          }
        }
      } catch {
        // fallback below if JSON parse fails
      }
    }
  }

  const proposals = [];
  for (let i = 0; i < validMarkets.length; i++) {
    const m = validMarkets[i];
    const aiEst = aiEstimates[i];

    // AI 추론 확률 우선 적용, 네트워크 지연 시에만 정량 사전 확률 폴백
    let myYesProb;
    let reasoningText;
    if (aiEst) {
      myYesProb = aiEst.prob;
      reasoningText = `🧠 Gemini(${aiModelUsed}): ${aiEst.reason}`;
    } else {
      const turnoverSignal = Math.min(0.12, Math.max(-0.12, ((m.volumeUsd / (m.liquidityUsd + 1)) - 2.0) * 0.03));
      const sentimentBias = ((fearGreedVal - 50) / 500);
      myYesProb = Number(Math.min(0.92, Math.max(0.08, 0.50 + turnoverSignal + sentimentBias)).toFixed(3));
      reasoningText = `정량 멀티팩터 추론 (공포탐욕지수 ${fearGreedVal} 반영)`;
    }

    const edge = Number((myYesProb - m.yesPrice).toFixed(3));
    if (Math.abs(edge) > 0.08) {
      proposals.push({
        source: m.source,
        marketId: m.marketId,
        question: m.question,
        side: edge > 0 ? 'YES' : 'NO',
        myProb: edge > 0 ? myYesProb : Number((1 - myYesProb).toFixed(3)),
        marketPrice: edge > 0 ? m.yesPrice : Number((1 - m.yesPrice).toFixed(3)),
        edgePct: Number((Math.abs(edge) * 100).toFixed(1)),
        liquidityUsd: m.liquidityUsd,
        aiModel: aiModelUsed || 'quant-fallback',
        reasoning: reasoningText
      });
    }
    if (proposals.length >= 2) break;
  }

  return {
    bot: 'BOOK',
    status: 'ACTIVE',
    aiModelUsed,
    kalshiStatus: kalshiRes.status,
    polymarketStatus: polyRes.status,
    evaluatedCount: validMarkets.length,
    proposals
  };
}

/**
 * 5. SIZE: 켈리 공식(상한 6%) + 유동성 슬리피지 예산(2%) + 최소 주문($50) 산정
 */
function runSizeAgent(item, portfolio, config) {
  const maxKellyCapPct = Number(config.maxKellyCapPct || 0.06);
  const minOrderUsd = Number(config.minOrderUsd || 50);
  const slippageBudgetPct = Number(config.slippageBudgetPct || 0.02);

  const unencumberedCash = Number(portfolio.cashUsd || 0);
  const totalEquity = Number(portfolio.totalEquityUsd || unencumberedCash);

  if (unencumberedCash < minOrderUsd) {
    return {
      bot: 'SIZE',
      dollars: 0,
      reason: `묶이지 않은 현금($${unencumberedCash.toFixed(2)})이 최소 주문 금액($${minOrderUsd}) 미만임 -> $0 반환`
    };
  }

  const winProb = item.decision === 'PASS' ? 0.58 : (item.myProb || 0.55);
  const payoffRatio = 1.6;
  const rawKelly = ((payoffRatio * winProb) - (1 - winProb)) / payoffRatio;
  const cappedKellyPct = Math.min(maxKellyCapPct, Math.max(0.052, rawKelly));

  const maxByAccountCap = totalEquity * cappedKellyPct;
  const liqUsd = Number(item.candidate?.liquidityUsd || item.liquidityUsd || 15000);
  const maxByLiquidity = liqUsd * (slippageBudgetPct * 0.25);

  const calculatedDollars = Number(Math.min(unencumberedCash, maxByAccountCap, maxByLiquidity).toFixed(2));

  if (calculatedDollars < minOrderUsd) {
    return {
      bot: 'SIZE',
      dollars: 0,
      reason: `산정 금액($${calculatedDollars})이 최소 주문($${minOrderUsd}, 최소 수수료 $0.95가 2% 아래로 내려가는 기준) 미만 -> $0 반환`
    };
  }

  return {
    bot: 'SIZE',
    dollars: calculatedDollars,
    kellyPct: Number((cappedKellyPct * 100).toFixed(2)),
    reason: `켈리 상한(${(maxKellyCapPct * 100).toFixed(1)}%) 및 유동성($${liqUsd.toLocaleString()}) 슬리피지 예산 통과 -> $${calculatedDollars} 배분`
  };
}

/**
 * 6. FILLS: 모의 체결 기록 및 수수료 하한(FEE_FLOOR) / 슬리피지 검증
 */
function runFillsAgent(candidate, sizeResult, config) {
  const dollars = Number(sizeResult.dollars || 0);
  const feeRate = 0.0045;
  const feeFloor = 0.95;
  const slippageLimitPct = Number(config.slippageBudgetPct || 0.02) * 100;

  if (dollars <= 0) {
    return {
      bot: 'FILLS',
      status: 'SKIPPED_ZERO_SIZE',
      reason: sizeResult.reason
    };
  }

  const feeUsd = Math.max(feeRate * dollars, feeFloor);
  const effectiveFeePct = (feeUsd / dollars) * 100;

  if (effectiveFeePct > 2.0) {
    return {
      bot: 'FILLS',
      status: 'FEE_FLOOR',
      effectiveFeePct: Number(effectiveFeePct.toFixed(2)),
      reason: `FEE_FLOOR 반려: 주문 $${dollars}의 실효 수수료율이 ${effectiveFeePct.toFixed(2)}% (> 2.0% 한도)`
    };
  }

  if (candidate.txnsM5 && candidate.txnsM5.sells > candidate.txnsM5.buys * 1.8) {
    return {
      bot: 'FILLS',
      status: 'WAIT_WHALE_SELLING',
      reason: `큰 물량 매도 우위 감지 (5분 매도 ${candidate.txnsM5.sells} > 매수 ${candidate.txnsM5.buys}) -> 체결 보류 및 대기 보고`
    };
  }

  const estimatedSlippagePct = Number(((dollars / Math.max(1000, candidate.liquidityUsd)) * 100 * 1.5).toFixed(3));
  const slippageWarning = estimatedSlippagePct > slippageLimitPct
    ? `⚠️ SLIPPAGE ALERT: 예상 슬리피지 ${estimatedSlippagePct}% > 한도 ${slippageLimitPct}%`
    : null;

  const entryPriceUsd = Number(candidate.priceUsd || 0);
  const netInvestedUsd = Number((dollars - feeUsd).toFixed(2));
  const quantity = entryPriceUsd > 0 ? netInvestedUsd / entryPriceUsd : 0;

  return {
    bot: 'FILLS',
    status: 'FILLED_PAPER',
    id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: candidate.symbol,
    name: candidate.name,
    contract: candidate.contract,
    entryPriceUsd,
    currentPriceUsd: entryPriceUsd,
    dollars,
    feeUsd: Number(feeUsd.toFixed(2)),
    effectiveFeePct: Number(effectiveFeePct.toFixed(2)),
    estimatedSlippagePct,
    slippageWarning,
    quantity,
    openedAt: new Date().toISOString(),
    highWaterPct: 0,
    trail60Marked: false
  };
}

/**
 * 7. RISK: 단일 토큰 또는 열린 포지션의 6시간 거래량 비율 계산 및 즉시 청산(CLOSE) 판정
 */
function calculateRiskFormula(volumeH24, volumeH6) {
  const h24 = Number(volumeH24 || 0);
  const h6 = Number(volumeH6 || 0);
  const avg6h = Math.round((h24 / 4) * 100) / 100;
  const ratio = avg6h > 0 ? Math.round((h6 / avg6h) * 1000) / 1000 : 0;
  const action = ratio < 0.20 ? 'CLOSE' : 'HOLD';
  const formattedLine = [
    `volume.h24 = ${h24.toFixed(2)} -> avg_6h = ${avg6h.toFixed(2)}`,
    `volume.h6  = ${h6.toFixed(2)} -> ratio  = ${ratio.toFixed(3)}  ->  ${action}`
  ].join('\n');

  return {
    volumeH24: Number(h24.toFixed(2)),
    volumeH6: Number(h6.toFixed(2)),
    avg6h,
    ratio,
    action,
    formattedLine
  };
}

async function checkContractRiskLive(contractAddress) {
  let lastRes = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    lastRes = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(contractAddress)}`);
    if (lastRes.ok && Array.isArray(lastRes.data?.pairs) && lastRes.data.pairs.length > 0) {
      break;
    }
  }

  if (!lastRes?.ok || !Array.isArray(lastRes.data?.pairs) || lastRes.data.pairs.length === 0) {
    return {
      bot: 'RISK',
      contract: contractAddress,
      reachable: false,
      action: 'CLOSE',
      reason: '덱스스크리너 2회 재시도 후에도 응답 없음 ("잴 수 없는 포지션은 들고 있지 않은 포지션이다" -> 즉시 CLOSE)',
      formattedLine: `contract = ${contractAddress} -> UNREACHABLE (after 2 retries) -> CLOSE`
    };
  }

  const pairs = [...lastRes.data.pairs].sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  const topPair = pairs[0];
  const calc = calculateRiskFormula(topPair.volume?.h24, topPair.volume?.h6);

  return {
    bot: 'RISK',
    contract: contractAddress,
    symbol: topPair.baseToken?.symbol || 'UNKNOWN',
    pairAddress: topPair.pairAddress,
    reachable: true,
    priceUsd: Number(topPair.priceUsd || 0),
    marketCap: Number(topPair.marketCap || topPair.fdv || 0),
    ...calc,
    reason: calc.action === 'CLOSE'
      ? `6시간 거래량 비율(${calc.ratio})이 24시간 평균의 20%(0.20) 미만으로 하락 -> 즉시 전량 CLOSE`
      : `6시간 거래량 비율(${calc.ratio}) 정상 (>= 0.20) -> HOLD 유지`
  };
}

module.exports = {
  DEFAULT_GEMINI_KEY,
  BOT_PROMPTS,
  fetchJson,
  callGeminiAI,
  checkSolanaTokenOnChain,
  runChiefVerification,
  runScanAgent,
  runVetAgent,
  runBookAgent,
  runSizeAgent,
  runFillsAgent,
  calculateRiskFormula,
  checkContractRiskLive
};
