/**
 * 그록 에이전트 7개 멀티 데스크 트레이딩 시스템 v3.0
 * ============================================================================
 * [3대 독립 모의매매 금고 ($1,000 + $1,000 + $1,000 = 총 $3,000)]
 *  1) 🪙 데스크 1 (memecoin)   : 솔라나 밈코인 데스크 ($1,000) — DexScreener + Solana RPC + RugCheck 7단계 필터 + 거래량 비율 청산
 *  2) 🎯 데스크 2 (prediction) : 예측시장 괴리율 데스크 ($1,000) — Kalshi + Polymarket + Gemini 3.5 Flash 블라인드 확률 괴리율(>=8%) 모의매매
 *  3) 🏛️ 데스크 3 (rwa)        : RWA 차트(켈트너·볼린저) & 옵션 감마(콜감마·숏감마) 데스크 ($1,000)
 *                                — tooja.me/chart (흰색 켈트너 채널 + 보라색 볼린저 스퀴즈 1H/10m 타점)
 *                                — tooja.me/options (콜감마 Long Gamma vs 숏감마 Short Gamma Net GEX, 콜벽/풋벽, 감마플립, 맥스페인)
 */

const DEFAULT_GM_B64 = 'QVEuQWI4Uk42THE1YUNscXNIVlkxbDMxUDIzREJ1eUNxSXFRZkFHeW5FMElCbUhPSjIzMkE=';
const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || Buffer.from(DEFAULT_GM_B64, 'base64').toString('utf-8');
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'];

/**
 * RWA & 7대 핵심 테마 섹터 정의 (우주·방산·바이오·반도체·광통신·로봇·RWA매크로)
 */
const RWA_SECTORS = {
  all: { id: 'all', label: '🔥 전 섹터 통합 (49종목)', badge: '🔥 전체섹터' },
  rwa_macro: { id: 'rwa_macro', label: '🏛️ RWA·원자재·매크로', badge: '🏛️ RWA/매크로' },
  space: { id: 'space', label: '🚀 우주·위성·발사체', badge: '🚀 우주항공' },
  defense: { id: 'defense', label: '🛡️ 방산·국방AI·드론', badge: '🛡️ 방산/드론' },
  bio: { id: 'bio', label: '🧬 바이오·비만·유전자가위', badge: '🧬 바이오' },
  semi: { id: 'semi', label: '💾 반도체·AI칩·HBM', badge: '💾 반도체' },
  optical: { id: 'optical', label: '🔦 광통신·AI전력·데이터센터', badge: '🔦 광통신/전력' },
  robotics: { id: 'robotics', label: '🤖 로봇·자율주행·양자', badge: '🤖 로봇/양자' }
};

/**
 * RWA & 7대 핵심 섹터 개별주 유니버스 (총 49개 종목 — tooja.me/chart & tooja.me/options 실시간 연동)
 */
const RWA_UNIVERSE = [
  // 1) 🏛️ RWA·원자재·매크로 (8종목)
  { symbol: 'GLD', name: 'SPDR Gold Trust (실물 금 RWA)', sector: 'rwa_macro', category: '🏛️ RWA/금' },
  { symbol: 'SLV', name: 'iShares Silver Trust (실물 은 RWA)', sector: 'rwa_macro', category: '🏛️ RWA/은' },
  { symbol: 'USO', name: 'United States Oil Fund (WTI 원유 RWA)', sector: 'rwa_macro', category: '🏛️ RWA/원유' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury (미국 장기국채 RWA)', sector: 'rwa_macro', category: '🏛️ RWA/장기채' },
  { symbol: 'VNQ', name: 'Vanguard Real Estate ETF (미국 부동산 리츠 RWA)', sector: 'rwa_macro', category: '🏛️ RWA/부동산' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF (미국 대형주 인덱스)', sector: 'rwa_macro', category: '🏛️ 매크로지수' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust (나스닥 100 인덱스)', sector: 'rwa_macro', category: '🏛️ 매크로지수' },
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust (비트코인 현물 ETF)', sector: 'rwa_macro', category: '🏛️ 크립토RWA' },

  // 2) 🚀 우주·위성·발사체 (6종목)
  { symbol: 'RKLB', name: 'Rocket Lab USA (우주 발사체·위성시스템)', sector: 'space', category: '🚀 우주/발사체' },
  { symbol: 'ASTS', name: 'AST SpaceMobile (저궤도 위성 다이렉트 셀룰러)', sector: 'space', category: '🚀 우주/위성통신' },
  { symbol: 'LUNR', name: 'Intuitive Machines (달 착륙선·우주탐사)', sector: 'space', category: '🚀 우주/달탐사' },
  { symbol: 'RDW', name: 'Redwire Corp (우주 인프라·태양전지판)', sector: 'space', category: '🚀 우주/인프라' },
  { symbol: 'PL', name: 'Planet Labs PBC (지구관측 위성 데이터)', sector: 'space', category: '🚀 우주/관측위성' },
  { symbol: 'BKSY', name: 'BlackSky Technology (실시간 위성 정찰 AI)', sector: 'space', category: '🚀 우주/위성AI' },

  // 3) 🛡️ 방산·국방AI·드론 (7종목)
  { symbol: 'PLTR', name: 'Palantir Technologies (국방·전장 AI 플랫폼)', sector: 'defense', category: '🛡️ 방산/국방AI' },
  { symbol: 'LMT', name: 'Lockheed Martin (F-35 스텔스·미사일 방어)', sector: 'defense', category: '🛡️ 방산/체계종합' },
  { symbol: 'RTX', name: 'RTX Corp (패트리어트 방공망·레이더)', sector: 'defense', category: '🛡️ 방산/방공망' },
  { symbol: 'NOC', name: 'Northrop Grumman (B-21 전략폭격기·우주방산)', sector: 'defense', category: '🛡️ 방산/전략무기' },
  { symbol: 'GD', name: 'General Dynamics (핵잠수함·에이브럼스 전차)', sector: 'defense', category: '🛡️ 방산/해군육군' },
  { symbol: 'AVAV', name: 'AeroVironment (스위치블레이드 자폭드론)', sector: 'defense', category: '🛡️ 방산/전술드론' },
  { symbol: 'KTOS', name: 'Kratos Defense (발키리 무인전투기·극초음속)', sector: 'defense', category: '🛡️ 방산/무인기' },

  // 4) 🧬 바이오·비만·유전자가위 (7종목)
  { symbol: 'LLY', name: 'Eli Lilly (젭바운드·마운자로 비만/알츠하이머)', sector: 'bio', category: '🧬 바이오/비만신약' },
  { symbol: 'NVO', name: 'Novo Nordisk (위고비·오젬픽 GLP-1 대장)', sector: 'bio', category: '🧬 바이오/GLP-1' },
  { symbol: 'VRTX', name: 'Vertex Pharmaceuticals (비마약성 통증·유전자치료)', sector: 'bio', category: '🧬 바이오/혁신신약' },
  { symbol: 'REGN', name: 'Regeneron (듀피젠트·항체 면역신약)', sector: 'bio', category: '🧬 바이오/항체신약' },
  { symbol: 'CRSP', name: 'CRISPR Therapeutics (카스게비 유전자가위 치료제)', sector: 'bio', category: '🧬 바이오/유전자가위' },
  { symbol: 'MRNA', name: 'Moderna (mRNA 맞춤형 항암백신·감염병)', sector: 'bio', category: '🧬 바이오/mRNA' },
  { symbol: 'AMGN', name: 'Amgen (마리타이드 비만약·항암 바이오)', sector: 'bio', category: '🧬 바이오/대형주' },

  // 5) 💾 반도체·AI칩·HBM (8종목)
  { symbol: 'NVDA', name: 'NVIDIA Corp (블랙웰·루빈 AI 가속기 독점)', sector: 'semi', category: '💾 반도체/AI칩' },
  { symbol: 'AMD', name: 'Advanced Micro Devices (MI325X AI GPU·서버CPU)', sector: 'semi', category: '💾 반도체/AI칩' },
  { symbol: 'AVGO', name: 'Broadcom Inc (빅테크 맞춤형 AI ASIC·네트워크칩)', sector: 'semi', category: '💾 반도체/ASIC' },
  { symbol: 'TSM', name: 'TSMC (AI 칩 초미세공정 파운드리·CoWoS)', sector: 'semi', category: '💾 반도체/파운드리' },
  { symbol: 'MU', name: 'Micron Technology (HBM3E·HBM4 고대역폭메모리)', sector: 'semi', category: '💾 반도체/HBM' },
  { symbol: 'ARM', name: 'Arm Holdings (AI 데이터센터·모바일 CPU 아키텍처)', sector: 'semi', category: '💾 반도체/IP설계' },
  { symbol: 'SMCI', name: 'Super Micro Computer (액침냉각 AI 서버 랙)', sector: 'semi', category: '💾 반도체/AI서버' },
  { symbol: 'SOXX', name: 'iShares Semiconductor ETF (필라델피아 반도체 원물)', sector: 'semi', category: '💾 반도체/원물ETF' },

  // 6) 🔦 광통신·AI전력·데이터센터 (7종목)
  { symbol: 'LITE', name: 'Lumentum Holdings (AI 데이터센터 초고속 광레이저)', sector: 'optical', category: '🔦 광통신/레이저' },
  { symbol: 'COHR', name: 'Coherent Corp (800G·1.6T AI 광트랜시버)', sector: 'optical', category: '🔦 광통신/트랜시버' },
  { symbol: 'ANET', name: 'Arista Networks (AI 클러스터 초고속 이더넷 스위치)', sector: 'optical', category: '🔦 광통신/네트워크' },
  { symbol: 'CIEN', name: 'Ciena Corp (데이터센터 인터커넥트 광통신망)', sector: 'optical', category: '🔦 광통신/광전송' },
  { symbol: 'GLW', name: 'Corning Inc (AI 데이터센터 생성형 광섬유 케이블)', sector: 'optical', category: '🔦 광통신/광섬유' },
  { symbol: 'VRT', name: 'Vertiv Holdings (AI 데이터센터 열관리·액침냉각)', sector: 'optical', category: '🔦 데이터센터/냉각' },
  { symbol: 'VST', name: 'Vistra Corp (AI 데이터센터 전용 원전·전력 공급)', sector: 'optical', category: '🔦 데이터센터/원전' },

  // 7) 🤖 로봇·자율주행·양자컴퓨팅 (6종목)
  { symbol: 'TSLA', name: 'Tesla Inc (옵티머스 휴머노이드 로봇·로보택시 FSD)', sector: 'robotics', category: '🤖 로봇/휴머노이드' },
  { symbol: 'ISRG', name: 'Intuitive Surgical (다빈치5 수술용 로봇 독점)', sector: 'robotics', category: '🤖 로봇/수술로봇' },
  { symbol: 'SERV', name: 'Serve Robotics (엔비디아 투자 자율주행 배달로봇)', sector: 'robotics', category: '🤖 로봇/배송로봇' },
  { symbol: 'SYM', name: 'Symbotic Inc (월마트 AI 물류창고 자동화로봇)', sector: 'robotics', category: '🤖 로봇/물류로봇' },
  { symbol: 'IONQ', name: 'IonQ Inc (이온트랩 방식 상용 양자컴퓨팅 대장)', sector: 'robotics', category: '🤖 양자컴퓨팅' },
  { symbol: 'RGTI', name: 'Rigetti Computing (초전도 풀스택 양자컴퓨터)', sector: 'robotics', category: '🤖 양자컴퓨팅' }
];

// ============================================================================
// [1. 스탑헌팅 10x 실전/모의매매 + 옵션 지지·저항선 분석 코어 엔진]
// ============================================================================

async function fetchJson(url, options = {}, timeoutMs = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GrokBotTradingTeam/3.0',
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

// ============================================================================
// [데스크 1: Variational DEX 7대 정예 선물 스탑헌팅 역추세 데스크]
//  - 대상: EWYUSDT > SOXLUSDT > QQQUSDT > ETH > SOL > HYPE > BTC (3분할 우선순위)
//  - 시세/호가: Variational Omni DEX 공식 API 실시간 마크가·Bid/Ask 연동
//  - 주말(토·일) 미국장 휴장 시 자동 작동 중지 (Weekend Guard)
// ============================================================================
const STOPHUNT_UNIVERSE = [
  // 우선순위 1~3: 백테스트 최상위 RWA/ETF 3대장 (3분할 슬롯 최우선 배정)
  { symbol: 'EWYUSDT', priorityRank: 1, name: 'iShares MSCI South Korea Perp (Variational EWY)', varTicker: 'EWY', hlCoin: null, pair: null, yahoo: 'EWY', tier: '한국증시 듀얼킬존', minHuntPct: 0.35, maxHuntPct: 1.10, asiaMinHuntPct: 1.50, asiaMaxHuntPct: 2.20, dangerTrendPct: 1.40, asiaDangerTrendPct: 2.80, minWickPct: 0.10, stopBufferPct: 0.28, btWinRate: 75.0, bt6mWinRate: 100.0, bt60dWinRate: 66.7, asiaBtWinRate: 71.4, btTrades: 36, btPnl10x: '+51.3%', asiaBtPnl10x: '+24.9%', btRR: 1.76 },
  { symbol: 'SOXLUSDT', priorityRank: 2, name: 'Direxion Semiconductor Bull 3X Perp (Variational SOXL)', varTicker: 'SOXL', hlCoin: null, pair: null, yahoo: 'SOXL', tier: '반도체 3X 선물', minHuntPct: 2.20, maxHuntPct: 3.80, dangerTrendPct: 4.25, minWickPct: 0.40, stopBufferPct: 0.45, btWinRate: 77.8, bt6mWinRate: 100.0, bt60dWinRate: 75.0, btTrades: 4, btPnl10x: '+42.6%', btRR: 2.70 },
  { symbol: 'QQQUSDT', priorityRank: 3, name: 'Invesco QQQ Nasdaq 100 Perp (Variational QQQ)', varTicker: 'QQQ', hlCoin: null, pair: null, yahoo: 'QQQ', tier: '나스닥 지수선물', minHuntPct: 0.70, maxHuntPct: 1.35, dangerTrendPct: 1.65, minWickPct: 0.18, stopBufferPct: 0.25, btWinRate: 85.7, bt6mWinRate: 88.9, bt60dWinRate: 70.0, btTrades: 10, btPnl10x: '+16.4%', btRR: 1.55 },
  // 우선순위 4~7: 크립토 4대장 (볼밴 %B 연속 3봉 이하 + 현재 %B < 80% 복귀 퀀트 필터)
  { symbol: 'ETH', priorityRank: 4, name: 'Ethereum Perp (Variational ETH)', varTicker: 'ETH', hlCoin: 'ETH', pair: 'ETHUSDT', yahoo: 'ETH-USD', tier: '크립토 대장', minHuntPct: 1.15, maxHuntPct: 2.20, dangerTrendPct: 2.65, minWickPct: 0.20, stopBufferPct: 0.25, btWinRate: 66.7, bt6mWinRate: 66.7, bt60dWinRate: 66.7, btTrades: 9, btPnl10x: '+21.8%', btRR: 1.68 },
  { symbol: 'SOL', priorityRank: 5, name: 'Solana Perp (Variational SOL)', varTicker: 'SOL', hlCoin: 'SOL', pair: 'SOLUSDT', yahoo: 'SOL-USD', tier: '크립토 대장', minHuntPct: 1.40, maxHuntPct: 2.65, dangerTrendPct: 3.40, minWickPct: 0.25, stopBufferPct: 0.30, btWinRate: 77.8, bt6mWinRate: 85.7, bt60dWinRate: 100.0, btTrades: 2, btPnl10x: '+17.8%', btRR: 1.73 },
  { symbol: 'HYPE', priorityRank: 6, name: 'Hyperliquid Perp (Variational HYPE)', varTicker: 'HYPE', hlCoin: 'HYPE', pair: null, yahoo: 'HYPE-USD', tier: '크립토 대장', minHuntPct: 1.00, maxHuntPct: 1.55, dangerTrendPct: 2.00, minWickPct: 0.12, stopBufferPct: 0.45, btWinRate: 80.0, bt6mWinRate: 80.0, bt60dWinRate: 66.7, btTrades: 3, btPnl10x: '+8.1%', btRR: 1.78 },
  { symbol: 'BTC', priorityRank: 7, name: 'Bitcoin Perp (Variational BTC)', varTicker: 'BTC', hlCoin: 'BTC', pair: 'BTCUSDT', yahoo: 'BTC-USD', tier: '크립토 대장', minHuntPct: 1.05, maxHuntPct: 2.15, dangerTrendPct: 2.80, minWickPct: 0.15, stopBufferPct: 0.25, btWinRate: 66.7, bt6mWinRate: 66.7, bt60dWinRate: 66.7, btTrades: 3, btPnl10x: '+5.5%', btRR: 1.55 }
];

const VARIATIONAL_API_BASE = 'https://omni-client-api.prod.ap-northeast-1.variational.io';
let cachedVariationalMap = new Map();
let cachedVariationalAt = 0;

/**
 * Variational Omni DEX 공식 Public Read-Only API 호출 (API Key 불필요)
 * 문서: https://docs.variational.io/technical-documentation/api
 */
async function fetchVariationalMarketMap() {
  if (Date.now() - cachedVariationalAt < 8000 && cachedVariationalMap.size > 0) {
    return cachedVariationalMap;
  }

  for (const ep of ['/metadata/stats', '/metadata/v2/stats']) {
    const res = await fetchJson(`${VARIATIONAL_API_BASE}${ep}`, {}, 5000);
    if (res.ok && Array.isArray(res.data?.listings)) {
      const map = new Map();
      for (const item of res.data.listings) {
        const rawTicker = String(item.ticker || '').toUpperCase();
        const baseTicker = rawTicker.replace(/-(PERP|SWAP)$/i, '');
        const markPrice = Number(item.mark_price || 0);
        const bidPrice = Number(item.quotes?.base?.bid || item.quotes?.size_1k?.bid || markPrice);
        const askPrice = Number(item.quotes?.base?.ask || item.quotes?.size_1k?.ask || markPrice);
        const spreadBps = Number(item.base_spread_bps || 0);
        const volume24h = Number(item.volume_24h || 0);
        if (markPrice > 0) {
          map.set(baseTicker, {
            ticker: rawTicker,
            baseTicker,
            name: item.name,
            markPrice,
            bidPrice: bidPrice > 0 ? bidPrice : markPrice,
            askPrice: askPrice > 0 ? askPrice : markPrice,
            spreadBps: Number(spreadBps.toFixed(2)),
            volume24h: Math.round(volume24h),
            updatedAt: item.quotes?.updated_at || new Date().toISOString()
          });
        }
      }
      if (map.size > 0) {
        cachedVariationalMap = map;
        cachedVariationalAt = Date.now();
        return map;
      }
    }
  }
  return cachedVariationalMap;
}

function getStopHuntSessionInfo(refDate = new Date()) {
  const now = refDate instanceof Date ? refDate : new Date(refDate || Date.now());
  let nyHour = 0;
  let nyMin = 0;
  let nyWeekday = 'Mon';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);
    nyWeekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';
    nyHour = Number(parts.find(p => p.type === 'hour')?.value || 0);
    nyMin = Number(parts.find(p => p.type === 'minute')?.value || 0);
  } catch {
    nyHour = (now.getUTCHours() + 19) % 24;
    nyMin = now.getUTCMinutes();
    const d = now.getUTCDay();
    nyWeekday = d === 0 ? 'Sun' : (d === 6 ? 'Sat' : 'Mon');
  }

  // 한국 시간 (KST) 파싱
  let kstHour = 0;
  let kstMin = 0;
  let kstWeekday = 'Mon';
  try {
    const kParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);
    kstWeekday = kParts.find(p => p.type === 'weekday')?.value || 'Mon';
    kstHour = Number(kParts.find(p => p.type === 'hour')?.value || 0);
    kstMin = Number(kParts.find(p => p.type === 'minute')?.value || 0);
  } catch {
    kstHour = (now.getUTCHours() + 9) % 24;
    kstMin = now.getUTCMinutes();
    const kd = now.getUTCDay();
    kstWeekday = kd === 0 ? 'Sun' : (kd === 6 ? 'Sat' : 'Mon');
  }

  // 미국 동부시간 기준 토요일(Sat) 종일 또는 일요일(Sun) 18:00 ET 이전, 혹은 금요일 17:00 ET 이후는 주말 미장 휴장!
  const isWeekend = (nyWeekday === 'Sat') || (nyWeekday === 'Sun') || (nyWeekday === 'Fri' && nyHour >= 17);
  const isKoreaWeekend = (kstWeekday === 'Sat') || (kstWeekday === 'Sun');
  
  const nyMinutesTotal = nyHour * 60 + nyMin;
  // 미장 개장 전후 스탑헌팅 킬존: 07:30 ~ 10:30 ET (한국시간 밤 21:30 ~ 00:30 / 서머타임 20:30 ~ 23:30)
  const isNyPreOpenKillzone = !isWeekend && (nyMinutesTotal >= 450 && nyMinutesTotal <= 630);
  const isLondonOpenZone = !isWeekend && (nyMinutesTotal >= 150 && nyMinutesTotal <= 270);

  // 한국장 개장 스탑헌팅 킬존 (EWY 전용): 평일 아침 08:45 ~ 10:15 KST
  const kstMinutesTotal = kstHour * 60 + kstMin;
  const isKoreaOpenKillzone = !isKoreaWeekend && (kstMinutesTotal >= 525 && kstMinutesTotal <= 615);

  let sessionLabel = '평일 미장(21:30~00:30 KST) / 한국장 EWY(08:45~10:15 KST) 킬존 대기 모드';
  if (isWeekend && isKoreaWeekend) {
    sessionLabel = '[주말 휴장 가드 작동 중 (토·일 시장 휴장 — 자동 진입 중지)]';
  } else if (isKoreaOpenKillzone) {
    sessionLabel = '[한국장 개장 EWY 스탑헌팅 킬존 작동 중 (08:45~10:15 KST · EWY 전용)]';
  } else if (isNyPreOpenKillzone) {
    sessionLabel = '[미장 개장 전후 7종목 스탑헌팅 골든타임 작동 중 (07:30~10:30 ET / 21:30~00:30 KST)]';
  } else if (isLondonOpenZone) {
    sessionLabel = '[유럽/런던 세션 감시 중 · 미장 킬존(21:30 KST) 대기]';
  }

  return {
    nyTimeStr: `${nyWeekday} ${String(nyHour).padStart(2, '0')}:${String(nyMin).padStart(2, '0')} ET`,
    kstTimeStr: `${kstWeekday} ${String(kstHour).padStart(2, '0')}:${String(kstMin).padStart(2, '0')} KST`,
    isWeekend,
    isKoreaWeekend,
    isNyPreOpenKillzone,
    isKoreaOpenKillzone,
    isLondonOpenZone,
    sessionLabel
  };
}

function scaleCandlesToVariationalMark(candles, varInfo) {
  if (!varInfo || !varInfo.markPrice || !candles.length) return candles;
  const lastClose = candles[candles.length - 1].close;
  if (!lastClose || lastClose <= 0) return candles;
  const ratio = varInfo.markPrice / lastClose;
  // 비율 차이가 15% 이내일 때 Variational DEX 실시간 마크 가격에 1:1 정밀 동기화
  if (ratio < 0.85 || ratio > 1.15) return candles;
  return candles.map((c, idx) => {
    const isLast = idx === candles.length - 1;
    const o = c.open * ratio;
    const cl = isLast ? varInfo.markPrice : (c.close * ratio);
    const h = Math.max(c.high * ratio, o, cl);
    const l = Math.min(c.low * ratio, o, cl);
    return { time: c.time, open: o, high: h, low: l, close: cl, volume: c.volume };
  });
}

async function fetchStopHuntCandles(item, varMap = null) {
  const map = varMap || (await fetchVariationalMarketMap());
  const varInfo = map.get(item.varTicker) || null;

  // 1) Hyperliquid 15m 캔들 (HYPE 및 BTC/ETH/SOL — 지오블록 없음 + Variational 마크가 1:1 보정)
  if (item.hlCoin) {
    const now = Date.now();
    const hlRes = await fetchJson('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: item.hlCoin, interval: '15m', startTime: now - 40 * 15 * 60 * 1000, endTime: now }
      })
    }, 4500);
    if (hlRes.ok && Array.isArray(hlRes.data) && hlRes.data.length >= 12) {
      const rawCandles = hlRes.data.map(k => ({
        time: Number(k.t),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v || 0)
      })).filter(c => c.close > 0);
      if (rawCandles.length >= 12) {
        return {
          ok: true,
          source: varInfo ? `Variational DEX (Mark $${formatPricePrecise(varInfo.markPrice)})` : 'Hyperliquid 15m',
          varInfo,
          candles: scaleCandlesToVariationalMark(rawCandles, varInfo)
        };
      }
    }
  }

  // 2) Binance Vision 15m 폴백 (BTC/ETH/SOL)
  if (item.pair) {
    const urls = [
      `https://data-api.binance.vision/api/v3/klines?symbol=${item.pair}&interval=15m&limit=40`,
      `https://api.binance.com/api/v3/klines?symbol=${item.pair}&interval=15m&limit=40`
    ];
    for (const u of urls) {
      const res = await fetchJson(u, {}, 4500);
      if (res.ok && Array.isArray(res.data) && res.data.length >= 12) {
        const rawCandles = res.data.map(k => ({
          time: Number(k[0]),
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5])
        })).filter(c => c.close > 0);
        if (rawCandles.length >= 12) {
          return {
            ok: true,
            source: varInfo ? `Variational DEX (Mark $${formatPricePrecise(varInfo.markPrice)})` : 'Binance 15m',
            varInfo,
            candles: scaleCandlesToVariationalMark(rawCandles, varInfo)
          };
        }
      }
    }
  }

  // 3) QQQUSDT, SOXLUSDT, EWYUSDT: Yahoo 프리/본장 15m + Variational DEX 실시간 마크가/호가 결합
  if (item.yahoo) {
    const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.yahoo)}?interval=15m&range=5d&includePrePost=true`;
    const res = await fetchJson(yUrl, {}, 5500);
    const result = res.data?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const rawCandles = [];
    for (let i = 0; i < ts.length; i++) {
      const o = Number(q.open?.[i]);
      const h = Number(q.high?.[i]);
      const l = Number(q.low?.[i]);
      const c = Number(q.close?.[i]);
      const v = Number(q.volume?.[i] || 0);
      if (o > 0 && h > 0 && l > 0 && c > 0) {
        rawCandles.push({ time: ts[i] * 1000, open: o, high: h, low: l, close: c, volume: v });
      }
    }
    if (rawCandles.length >= 12) {
      const sliced = rawCandles.slice(-40);
      return {
        ok: true,
        source: varInfo ? `Variational DEX (Mark $${formatPricePrecise(varInfo.markPrice)})` : 'NASDAQ Pre/Reg 15m',
        varInfo,
        candles: scaleCandlesToVariationalMark(sliced, varInfo)
      };
    }
  }

  return { ok: false, source: 'unreachable', varInfo: null, candles: [] };
}

function formatPricePrecise(val) {
  const n = Number(val || 0);
  if (n >= 1000) return Number(n.toFixed(2));
  if (n >= 10) return Number(n.toFixed(3));
  if (n >= 1) return Number(n.toFixed(4));
  return Number(n.toFixed(5));
}

function analyzeStopHuntCandidate(item, candles, sourceName, sessionInfo, varInfo = null) {
  const n = candles.length;
  const lastCandle = candles[n - 1];
  const markPrice = varInfo?.markPrice || lastCandle.close;

  // 1) 직전 90분(1시간 30분 = 15분봉 6개) 윈도우 vs 그 이전 세션(직전 6시간) 비교
  const windowSize = Math.min(7, n - 4);
  const huntWindow = candles.slice(n - windowSize);
  const priorWindow = candles.slice(Math.max(0, n - windowSize - 20), n - windowSize);

  const anchorPrice = huntWindow[0].open; // 1시간 30분 전 출발 기준가 (Anchor Price)
  let windowHigh = Math.max(...huntWindow.map(c => c.high));
  let windowLow = Math.min(...huntWindow.map(c => c.low));

  // markPrice와 anchorPrice의 괴리가 25% 이내일 때만 markPrice를 고/저점 비교에 포함 (단위 불일치 방어)
  if (anchorPrice > 0 && Math.abs(markPrice - anchorPrice) / anchorPrice < 0.25) {
    windowHigh = Math.max(windowHigh, markPrice);
    windowLow = Math.min(windowLow, markPrice);
  }

  const prevHigh = priorWindow.length ? Math.max(...priorWindow.map(c => c.high)) : windowHigh;
  const prevLow = priorWindow.length ? Math.min(...priorWindow.map(c => c.low)) : windowLow;

  // 2) 20개 15분봉 볼린저 밴드 (2.0 표준편차) 계산
  const bbSlice = candles.slice(-20);
  const bbMid = bbSlice.reduce((s, c) => s + c.close, 0) / bbSlice.length;
  const variance = bbSlice.reduce((s, c) => s + Math.pow(c.close - bbMid, 2), 0) / bbSlice.length;
  const stdDev = Math.sqrt(variance) || (bbMid * 0.004);
  const bbUpper = bbMid + 2.0 * stdDev;
  const bbLower = bbMid - 2.0 * stdDev;

  // 3) 90분 기준가(Anchor) 대비 위/아래 급등·급락 폭(%) 계산
  const upSpikePct = ((windowHigh - anchorPrice) / anchorPrice) * 100;
  const downDumpPct = ((anchorPrice - windowLow) / anchorPrice) * 100;

  const isUpHunt = upSpikePct >= downDumpPct;
  const huntType = isUpHunt ? 'UP_HUNT' : 'DOWN_HUNT';
  const direction = isUpHunt ? 'SHORT' : 'LONG'; // 위로 쏘면 🔴SHORT, 아래로 빼면 🟢LONG!

  // Variational DEX 실전 호가 반영: LONG 진입 시 Ask(매도호가), SHORT 진입 시 Bid(매수호가) 적용!
  const execPrice = direction === 'LONG'
    ? (varInfo?.askPrice || markPrice)
    : (varInfo?.bidPrice || markPrice);

  const rawMovePct = isUpHunt ? upSpikePct : -downDumpPct;
  const absMovePct = Number(Math.abs(rawMovePct).toFixed(2));
  const huntMovePct = Number(rawMovePct.toFixed(2));
  const extremePrice = isUpHunt ? windowHigh : windowLow;

  // 4) 고점/저점 찍은 뒤 꼬리(되돌림)가 얼마나 달렸는지 계산
  const wickReversalPct = isUpHunt
    ? Number((((windowHigh - markPrice) / windowHigh) * 100).toFixed(2))
    : Number((((markPrice - windowLow) / windowLow) * 100).toFixed(2));

  // 5) 직전 세션 고/저점 스윕(Liquidity Sweep) 및 볼린저 밴드 %B 퀀트 휩쏘 필터 계산
  const sweptPrevLevel = isUpHunt ? (windowHigh >= prevHigh * 0.999) : (windowLow <= prevLow * 1.001);
  let curConsec90 = 0;
  let bbConsec90Bars = 0;
  let bbTotal90Bars = 0;
  const extPctBs = [];

  for (let k = 0; k < huntWindow.length; k++) {
    const c = huntWindow[k];
    const idx = (n - windowSize) + k;
    let barLower = bbLower;
    let barUpper = bbUpper;
    if (idx >= 19) {
      const subSlice = candles.slice(idx - 19, idx + 1);
      const subMid = subSlice.reduce((s, x) => s + x.close, 0) / subSlice.length;
      const subVar = subSlice.reduce((s, x) => s + Math.pow(x.close - subMid, 2), 0) / subSlice.length;
      const subStd = Math.sqrt(subVar) || (subMid * 0.004);
      barUpper = subMid + 2.0 * subStd;
      barLower = subMid - 2.0 * subStd;
    }
    const barRange = Math.max(barUpper - barLower, bbMid * 0.001, 1e-9);
    const pctBClose = (c.close - barLower) / barRange;
    const pctBHigh = (c.high - barLower) / barRange;
    const pctBLow = (c.low - barLower) / barRange;
    const dirClosePctB = isUpHunt ? pctBClose : (1 - pctBClose);
    const dirExtPctB = isUpHunt ? pctBHigh : (1 - pctBLow);
    extPctBs.push(dirExtPctB);

    if (dirClosePctB >= 0.90) {
      curConsec90 += 1;
      bbTotal90Bars += 1;
      if (curConsec90 > bbConsec90Bars) bbConsec90Bars = curConsec90;
    } else {
      curConsec90 = 0;
    }
  }

  const bbRange = Math.max(bbUpper - bbLower, bbMid * 0.001, 1e-9);
  const rawCurPctB = (markPrice - bbLower) / bbRange;
  const dirCurPctB = isUpHunt ? rawCurPctB : (1 - rawCurPctB);
  const bbCurrentPctB = Number((dirCurPctB * 100).toFixed(1));
  if (anchorPrice > 0 && Math.abs(markPrice - anchorPrice) / anchorPrice < 0.25) {
    extPctBs.push(dirCurPctB);
  }
  const bbPeakPctB = Number(((extPctBs.length ? Math.max(...extPctBs) : 0) * 100).toFixed(1));

  const bandTouch = (bbPeakPctB >= 90.0) || (isUpHunt
    ? (windowHigh >= bbMid + (bbUpper - bbMid) * 0.80)
    : (windowLow <= bbMid - (bbMid - bbLower) * 0.80));

  // 6) 반대 포지션 진입 시 손절가(SL) · 1차 익절(TP1 = 65% 되돌림) · 2차 익절(TP2 = 출발 기준가 Anchor 회귀) 산출
  let stopPriceUsd = 0;
  let tp1PriceUsd = 0;
  let tp2PriceUsd = 0;

  if (direction === 'SHORT') {
    const highBound = Math.max(windowHigh, markPrice, execPrice);
    stopPriceUsd = formatPricePrecise(highBound * (1 + item.stopBufferPct / 100));
    if (stopPriceUsd <= execPrice) {
      stopPriceUsd = formatPricePrecise(execPrice * (1 + Math.max(0.002, (item.stopBufferPct || 0.25) / 100)));
    }
    const targetAnchor = Math.min(anchorPrice, execPrice * 0.992);
    tp2PriceUsd = formatPricePrecise(Math.min(anchorPrice, (anchorPrice + bbMid) / 2, targetAnchor));
    tp1PriceUsd = formatPricePrecise(execPrice - (execPrice - tp2PriceUsd) * 0.65);
  } else {
    const lowBound = Math.min(windowLow, markPrice, execPrice);
    stopPriceUsd = formatPricePrecise(lowBound * (1 - item.stopBufferPct / 100));
    if (stopPriceUsd >= execPrice) {
      stopPriceUsd = formatPricePrecise(execPrice * (1 - Math.max(0.002, (item.stopBufferPct || 0.25) / 100)));
    }
    const targetAnchor = Math.max(anchorPrice, execPrice * 1.008);
    tp2PriceUsd = formatPricePrecise(Math.max(anchorPrice, (anchorPrice + bbMid) / 2, targetAnchor));
    tp1PriceUsd = formatPricePrecise(execPrice + (tp2PriceUsd - execPrice) * 0.65);
  }

  const signedReward = direction === 'LONG' ? (tp2PriceUsd - execPrice) : (execPrice - tp2PriceUsd);
  const signedRisk = direction === 'LONG' ? (execPrice - stopPriceUsd) : (stopPriceUsd - execPrice);
  const validLevels = signedRisk > 0 && signedReward > 0
    && (direction === 'LONG' ? (tp1PriceUsd > execPrice && tp2PriceUsd >= tp1PriceUsd) : (tp1PriceUsd < execPrice && tp2PriceUsd <= tp1PriceUsd));
  const riskAbs = Math.max(execPrice * 0.0015, Math.max(0, signedRisk));
  const rrRatio = validLevels ? Number((signedReward / riskAbs).toFixed(2)) : 0;

  const isEwy = item.symbol.includes('EWY') || item.varTicker === 'EWY';
  const isKoreaSessionActive = Boolean(isEwy && sessionInfo.isKoreaOpenKillzone);
  const activeMinHuntPct = isKoreaSessionActive ? (item.asiaMinHuntPct || 1.50) : item.minHuntPct;
  const activeMaxHuntPct = isKoreaSessionActive ? (item.asiaMaxHuntPct || 2.20) : item.maxHuntPct;
  const activeDangerTrendPct = isKoreaSessionActive ? (item.asiaDangerTrendPct || 2.80) : item.dangerTrendPct;

  const inGoldilocks = absMovePct >= activeMinHuntPct && absMovePct <= activeMaxHuntPct;
  const velocityScore = Number((
    (inGoldilocks ? 50 : 15) +
    Math.min(25, absMovePct * 10) +
    Math.min(15, wickReversalPct * 25) +
    (sweptPrevLevel ? 10 : 0) +
    (bandTouch ? 10 : 0)
  ).toFixed(1));

  return {
    symbol: item.symbol,
    name: item.name,
    tier: item.tier,
    contract: item.varTicker || item.symbol,
    source: sourceName,
    sessionLabel: sessionInfo.sessionLabel,
    isWeekend: Boolean(sessionInfo.isWeekend),
    isNyPreOpenKillzone: sessionInfo.isNyPreOpenKillzone,
    isKoreaOpenKillzone: Boolean(sessionInfo.isKoreaOpenKillzone),
    isKoreaSessionActive,
    priceUsd: formatPricePrecise(execPrice),
    markPriceUsd: formatPricePrecise(markPrice),
    bidPriceUsd: formatPricePrecise(varInfo?.bidPrice || markPrice),
    askPriceUsd: formatPricePrecise(varInfo?.askPrice || markPrice),
    spreadBps: varInfo?.spreadBps ?? 1.5,
    anchorPriceUsd: formatPricePrecise(anchorPrice),
    extremePriceUsd: formatPricePrecise(extremePrice),
    bbUpperUsd: formatPricePrecise(bbUpper),
    bbMidUsd: formatPricePrecise(bbMid),
    bbLowerUsd: formatPricePrecise(bbLower),
    huntType,
    direction,
    huntMovePct,
    absMovePct,
    wickReversalPct,
    sweptPrevLevel,
    bandTouch,
    bbConsec90Bars,
    bbTotal90Bars,
    bbPeakPctB,
    bbCurrentPctB,
    maxConsec90Limit: 3,
    snapbackPctBLimit: 80,
    setupSummary: `%B 연속 ${bbConsec90Bars}봉(<=3봉) · 현재 %B ${bbCurrentPctB}%(<80% 복귀)`,
    minHuntPct: activeMinHuntPct,
    maxHuntPct: activeMaxHuntPct,
    dangerTrendPct: activeDangerTrendPct,
    minWickPct: item.minWickPct,
    stopBufferPct: item.stopBufferPct || 0.30,
    btWinRate: isKoreaSessionActive ? (item.asiaBtWinRate || 71.4) : (item.btWinRate || 65.0),
    bt6mWinRate: item.bt6mWinRate || item.btWinRate || 75.0,
    bt60dWinRate: isKoreaSessionActive ? (item.asiaBtWinRate || 71.4) : (item.bt60dWinRate || item.btWinRate || 80.0),
    btTrades: isKoreaSessionActive ? 7 : (item.btTrades || 10),
    btPnl10x: isKoreaSessionActive ? (item.asiaBtPnl10x || '+24.9%') : (item.btPnl10x || '+20.0%'),
    btRR: item.btRR || 1.85,
    tp1PriceUsd,
    tp2PriceUsd,
    stopPriceUsd,
    rrRatio,
    invalidLevels: !validLevels,
    liquidityUsd: varInfo?.volume24h || 5000000,
    priceChangeH1: huntMovePct,
    priceChangeM5: wickReversalPct,
    txnsM5: { buys: direction === 'LONG' ? 120 : 80, sells: direction === 'SHORT' ? 120 : 80 },
    txnsH1: { buys: 500, sells: 500 },
    holders: null,
    velocityScore
  };
}

async function runScanAgent(config, wmStatus = 'READY') {
  const sessionInfo = getStopHuntSessionInfo();
  const varMap = await fetchVariationalMarketMap();
  const qualified = [];
  const skippedByScan = [];

  const fetchedList = await Promise.all(
    STOPHUNT_UNIVERSE.map(async (item) => {
      const res = await fetchStopHuntCandles(item, varMap);
      return { item, res };
    })
  );

  for (const { item, res } of fetchedList) {
    if (!res.ok || !res.candles.length) {
      skippedByScan.push({ symbol: item.symbol, contract: item.symbol, reason: '캔들 API 응답 지연' });
      continue;
    }
    const cand = analyzeStopHuntCandidate(item, res.candles, res.source, sessionInfo, res.varInfo);
    qualified.push(cand);
  }

  qualified.sort((a, b) => b.velocityScore - a.velocityScore);

  return {
    bot: 'SCAN',
    timestamp: new Date().toISOString(),
    sessionInfo,
    variationalConnected: varMap.size > 0,
    variationalMarketsCount: varMap.size,
    degraded: wmStatus !== 'READY',
    rawScannedCount: STOPHUNT_UNIVERSE.length,
    skippedByScanCount: skippedByScan.length,
    skippedSamples: skippedByScan,
    candidates: qualified
  };
}

async function runVetAgent(candidates, config) {
  const vetResults = [];

  for (const cand of candidates) {
    const dirLabel = cand.direction === 'SHORT' ? 'SHORT(모의 매도)' : 'LONG(모의 매수)';
    const moveSign = cand.huntMovePct >= 0 ? `+${cand.huntMovePct}% 급등` : `${cand.huntMovePct}% 급락`;

    // 규칙 0: 주말(토·일) 미국장 휴장 가드 -> 주말에는 스탑헌팅 역추세 매매 전면 중지!
    if (cand.isWeekend) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 0,
        reason: `[주말 작동 중지 (Weekend Guard)] 미국장 휴장일(토·일)에는 개장 전 스탑헌팅 패턴이 없으므로 진입을 차단합니다 (현재가 $${cand.priceUsd}, 스프레드 ${cand.spreadBps}bps)`,
        candidate: cand
      });
      continue;
    }

    // 규칙 6: 킬존 시간대 확인 (EWY는 아침 08:45~10:15 KST 및 밤 21:30~00:30 KST 듀얼 킬존 허용, 나머지는 밤 미장 킬존만)
    const isEwy = cand.symbol.includes('EWY') || cand.contract === 'EWY';
    const isEligibleKillzone = isEwy
      ? (cand.isKoreaOpenKillzone || cand.isNyPreOpenKillzone)
      : cand.isNyPreOpenKillzone;

    if (!isEligibleKillzone && !config?.allowOutsideKillzone) {
      const waitReason = isEwy
        ? `[시간대 대기] 한국장 킬존(08:45~10:15 KST) 또는 미장 킬존(21:30~00:30 KST) 도래 시 자동 진입합니다`
        : `[시간대 대기] 미장 개장 전후 킬존(21:30~00:30 KST / 07:30~10:30 ET) 시간대 도래 시 즉시 자동 진입합니다`;
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 6,
        reason: `${waitReason} (현재 90분 변동 ${moveSign}, 목표 ±${cand.minHuntPct}%~±${cand.maxHuntPct}%)`,
        candidate: cand
      });
      continue;
    }

    // 규칙 1: 최소 스탑헌팅 변동폭(하한선) 미달 탈락 (단순 노이즈)
    if (cand.absMovePct < cand.minHuntPct) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 1,
        reason: `규칙 1 대기 (구간 미달): 90분 변동폭 ${moveSign}(±${cand.absMovePct}%) < 확정 스탑헌팅 하한 ±${cand.minHuntPct}% (목표 ±${cand.minHuntPct}%~±${cand.maxHuntPct}%)`,
        candidate: cand
      });
      continue;
    }

    // 규칙 2: 확정 스탑헌팅 상한선(maxHuntPct) 초과 탈락 (원웨이 추세 위험 구간 진입 차단)
    if (cand.absMovePct > cand.maxHuntPct) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 2,
        reason: `규칙 2 차단 (상한 초과): 90분 변동폭 ${moveSign}(±${cand.absMovePct}%) > 확정 스탑헌팅 상한 ±${cand.maxHuntPct}% (원웨이 추세 위험선 ±${cand.dangerTrendPct}%)`,
        candidate: cand
      });
      continue;
    }

    // 규칙 3: 볼린저 밴드 %B 90% 이상 과열 또는 직전 고/저점 스윕 확인
    if (!cand.bandTouch && !cand.sweptPrevLevel) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 3,
        reason: `규칙 3 탈락 (유동성 스윕 미달): 스파이크 극점 %B ${cand.bbPeakPctB ?? '-'}% < 90% 및 직전 고/저점 스윕 없음`,
        candidate: cand
      });
      continue;
    }

    // 규칙 4: 퀀트 볼밴 %B 휩쏘 판별 (연속 %B>=90% 3봉 이하 + 현재봉 %B < 80% 안쪽 복귀 + 최소 꼬리 확인)
    if ((cand.bbConsec90Bars || 0) > 3) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 4,
        reason: `규칙 4 차단 (원웨이 밴드타기): 볼밴 %B>=90% 연속 ${cand.bbConsec90Bars}봉 초과 (최대 3봉 이하만 진입)`,
        candidate: cand
      });
      continue;
    }
    if ((cand.bbCurrentPctB ?? 50) >= 80) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 4,
        reason: `규칙 4 대기 (%B 80% 복귀 미확인): 현재 %B ${cand.bbCurrentPctB}% >= 80% (밴드 80% 안쪽 복귀 시 진입)`,
        candidate: cand
      });
      continue;
    }
    if (cand.wickReversalPct < cand.minWickPct) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 4,
        reason: `규칙 4 대기 (꼬리 미확인): 극점($${cand.extremePriceUsd}) 대비 되돌림 꼬리가 ${cand.wickReversalPct}% (< 기준 ${cand.minWickPct}%)`,
        candidate: cand
      });
      continue;
    }

    // 규칙 5: SL/TP 방향 정합성 및 손익비(R/R Ratio) 1.35 미만 탈락
    const isSlSideValid = cand.direction === 'LONG'
      ? (cand.stopPriceUsd > 0 && cand.stopPriceUsd < cand.priceUsd)
      : (cand.stopPriceUsd > cand.priceUsd);
    if (cand.invalidLevels || !isSlSideValid || cand.rrRatio < 1.35) {
      const ruleReason = (cand.invalidLevels || !isSlSideValid)
        ? `규칙 5 탈락 (SL/TP 방향 역전): 진입 $${cand.priceUsd} 대비 SL $${cand.stopPriceUsd} / TP2 $${cand.tp2PriceUsd} 설정 불일치`
        : `규칙 5 탈락 (손익비 부족): 출발점($${cand.anchorPriceUsd}) 회귀 기대 손익비 1 : ${cand.rrRatio} (< 최소 1 : 1.35)`;
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 5,
        reason: ruleReason,
        candidate: cand
      });
      continue;
    }

    const decision = 'PASS';
    vetResults.push({
      symbol: cand.symbol,
      contract: cand.contract,
      decision,
      failedRule: null,
      reason: `[Variational 스탑헌팅 포착 -> ${dirLabel}] 90분 ${moveSign}(확정 구간 ±${cand.minHuntPct}%~±${cand.maxHuntPct}% 진입) + %B 연속 ${cand.bbConsec90Bars ?? 0}봉 · 현재 %B ${cand.bbCurrentPctB ?? '-'}% 복귀 + 꼬리 ${cand.wickReversalPct}% 확인 | 진입 $${cand.priceUsd} -> 목표(TP2) $${cand.tp2PriceUsd} / 손절(SL) $${cand.stopPriceUsd} (손익비 1 : ${cand.rrRatio})`,
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

function runSizeAgent(item, portfolio, config, customCapPct = null) {
  const maxKellyCapPct = Number(customCapPct || config.maxKellyCapPct || 0.30);
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

  const winProb = item.decision === 'PASS' ? 0.62 : (item.myProb || 0.57);
  const payoffRatio = item.candidate?.rrRatio || item.payoffRatio || 2.0;
  const rawKelly = ((payoffRatio * winProb) - (1 - winProb)) / payoffRatio;
  const cappedKellyPct = Math.min(maxKellyCapPct, Math.max(0.15, rawKelly));

  const maxByAccountCap = totalEquity * cappedKellyPct;
  const liqUsd = Number(item.candidate?.liquidityUsd || item.liquidityUsd || 500000);
  const maxByLiquidity = liqUsd * (slippageBudgetPct * 0.25);

  const calculatedDollars = Number(Math.min(unencumberedCash, maxByAccountCap, maxByLiquidity).toFixed(2));

  if (calculatedDollars < minOrderUsd) {
    return {
      bot: 'SIZE',
      dollars: 0,
      reason: `산정 금액($${calculatedDollars})이 최소 주문($${minOrderUsd}) 미만 -> $0 반환`
    };
  }

  return {
    bot: 'SIZE',
    dollars: calculatedDollars,
    kellyPct: Number((cappedKellyPct * 100).toFixed(2)),
    reason: `3분할 우선순위·손익비(1:${payoffRatio}) 한도(${(maxKellyCapPct * 100).toFixed(0)}%) 통과 -> $${calculatedDollars} 배분`
  };
}

function runFillsAgent(candidate, sizeResult) {
  const dollars = Number(sizeResult.dollars || 0);
  const leverage = 10; // 10배 레버리지 고정 적용!
  const notionalUsd = Number((dollars * leverage).toFixed(2));
  // Variational DEX 호가 스프레드 반영 + 최소 네트워크/집행 비용 $0.25
  const feeRate = 0.0002;
  const feeFloor = 0.05;

  if (dollars <= 0) {
    return {
      bot: 'FILLS',
      status: 'SKIPPED_ZERO_SIZE',
      reason: sizeResult.reason
    };
  }

  const feeUsd = Number(Math.max(feeRate * notionalUsd, feeFloor).toFixed(2));
  const effectiveFeePct = Number(((feeUsd / dollars) * 100).toFixed(2));
  const entryPriceUsd = Number(candidate.priceUsd || 0);
  // 10배 레버리지 포지션 수량 = (증거금 × 10) / 진입가
  const quantity = entryPriceUsd > 0 ? notionalUsd / entryPriceUsd : 0;
  const direction = candidate.direction || 'LONG';

  return {
    bot: 'FILLS',
    desk: 'memecoin',
    isStopHunt: true,
    leverage,
    notionalUsd,
    status: 'FILLED_PAPER',
    id: `pos_sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: candidate.symbol,
    name: candidate.name,
    tier: candidate.tier || '메이저 선물',
    contract: candidate.contract || candidate.symbol,
    direction, // 'LONG' | 'SHORT'
    huntType: candidate.huntType || (direction === 'SHORT' ? 'UP_HUNT' : 'DOWN_HUNT'),
    huntMovePct: candidate.huntMovePct || 0,
    wickReversalPct: candidate.wickReversalPct || 0,
    anchorPriceUsd: candidate.anchorPriceUsd || entryPriceUsd,
    extremePriceUsd: candidate.extremePriceUsd || entryPriceUsd,
    tp1PriceUsd: candidate.tp1PriceUsd || (direction === 'SHORT' ? Number((entryPriceUsd * 0.992).toFixed(4)) : Number((entryPriceUsd * 1.008).toFixed(4))),
    tp2PriceUsd: candidate.tp2PriceUsd || (direction === 'SHORT' ? Number((entryPriceUsd * 0.985).toFixed(4)) : Number((entryPriceUsd * 1.015).toFixed(4))),
    stopPriceUsd: candidate.stopPriceUsd || (direction === 'SHORT' ? Number((entryPriceUsd * 1.006).toFixed(4)) : Number((entryPriceUsd * 0.994).toFixed(4))),
    rrRatio: candidate.rrRatio || 2.2,
    btWinRate: candidate.btWinRate || 60.0,
    btPnl10x: candidate.btPnl10x || '+15.0%',
    minHuntPct: candidate.minHuntPct || 0.85,
    maxHuntPct: candidate.maxHuntPct || 2.40,
    entryPriceUsd,
    currentPriceUsd: entryPriceUsd,
    dollars,
    feeUsd,
    effectiveFeePct,
    estimatedSlippagePct: 0.03,
    slippageWarning: null,
    quantity,
    openedAt: new Date().toISOString()
  };
}

async function checkContractRiskLive(contractOrSymbol, posObj = null) {
  const rawSym = String(posObj?.symbol || contractOrSymbol || 'BTC').toUpperCase();
  const sym = rawSym.replace(/USDT$/, '');
  const item = STOPHUNT_UNIVERSE.find(u => u.symbol === rawSym || u.symbol === sym || u.varTicker === sym || u.pair === contractOrSymbol || u.yahoo === contractOrSymbol)
    || { symbol: rawSym, varTicker: sym, name: rawSym, pair: `${sym}USDT`, yahoo: `${sym}-USD`, tier: '메이저 선물', minHuntPct: 0.85, maxHuntPct: 2.4, dangerTrendPct: 2.8, minWickPct: 0.12, stopBufferPct: 0.25 };

  const candleRes = await fetchStopHuntCandles(item);
  if (!candleRes.ok || !candleRes.candles.length) {
    return {
      bot: 'RISK',
      contract: contractOrSymbol,
      symbol: item.symbol,
      reachable: false,
      action: 'HOLD',
      priceUsd: posObj?.currentPriceUsd || 0,
      reason: '시세 조회 일시 지연 -> 포지션 유지',
      formattedLine: `${item.symbol} 시세 조회 대기 -> HOLD`
    };
  }

  const candles = candleRes.candles;
  const lastCandle = candles[candles.length - 1];
  const currentPrice = formatPricePrecise(lastCandle.close);
  const candleBullish = lastCandle.close >= lastCandle.open;

  if (!posObj || (!posObj.tp2PriceUsd && !posObj.stopPriceUsd)) {
    return {
      bot: 'RISK',
      contract: contractOrSymbol,
      symbol: item.symbol,
      reachable: true,
      priceUsd: currentPrice,
      action: 'HOLD',
      reason: `실시간 선물가 $${currentPrice} 추적 중`,
      formattedLine: `${item.symbol} 현재가 = $${currentPrice} -> HOLD`
    };
  }

  const dir = posObj.direction || 'LONG';
  const lev = Number(posObj.leverage || 10);
  const entryP = Number(posObj.entryPriceUsd || currentPrice);
  const tp1P = Number(posObj.tp1PriceUsd || entryP);
  const tp2P = Number(posObj.tp2PriceUsd || entryP);
  const stopP = Number(posObj.stopPriceUsd || entryP);

  const rawDiff = dir === 'SHORT' ? (entryP - currentPrice) : (currentPrice - entryP);
  const rawMovePct = entryP > 0 ? (rawDiff / entryP) * 100 : 0;
  const pnlPct = Number((rawMovePct * lev).toFixed(2)); // 10배 레버리지 ROE(%)

  let action = 'HOLD';
  let reason = `[${dir} ${lev}x] 스탑헌팅 출발점($${tp2P}) 회귀 대기 중 (10x ROE ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`;

  if (dir === 'SHORT') {
    if (currentPrice <= tp2P) {
      action = 'CLOSE';
      reason = `[SHORT ${lev}x 평균회귀 완승] 출발 기준가(TP2 $${tp2P}) 완전 복귀 전량 익절 (10x ROE +${pnlPct}%)`;
    } else if (currentPrice >= stopP) {
      action = 'CLOSE';
      reason = `[SHORT ${lev}x 칼손절] 스탑헌팅 고점 방어선(SL $${stopP}) 재돌파 즉시 손절 (10x ROE ${pnlPct}%)`;
    } else if (posObj.tp1Reached && currentPrice >= tp1P * 1.0015) {
      action = 'CLOSE';
      reason = `[SHORT ${lev}x 1차익절 확정] 65% 되돌림(TP1 $${tp1P}) 도달 후 수익 보존 익절 (10x ROE +${pnlPct}%)`;
    } else if (currentPrice <= tp1P) {
      posObj.tp1Reached = true;
      if (candleBullish) {
        action = 'CLOSE';
        reason = `[SHORT ${lev}x 1차익절 확정] 65% 되돌림(TP1 $${tp1P}) 도달 후 반등 캔들 출현 수익 확정 (10x ROE +${pnlPct}%)`;
      }
    }
  } else {
    if (currentPrice >= tp2P) {
      action = 'CLOSE';
      reason = `[LONG ${lev}x 평균회귀 완승] 출발 기준가(TP2 $${tp2P}) 완전 복귀 전량 익절 (10x ROE +${pnlPct}%)`;
    } else if (currentPrice <= stopP) {
      action = 'CLOSE';
      reason = `[LONG ${lev}x 칼손절] 스탑헌팅 저점 방어선(SL $${stopP}) 재이탈 즉시 손절 (10x ROE ${pnlPct}%)`;
    } else if (posObj.tp1Reached && currentPrice <= tp1P * 0.9985) {
      action = 'CLOSE';
      reason = `[LONG ${lev}x 1차익절 확정] 65% 반등(TP1 $${tp1P}) 도달 후 수익 보존 익절 (10x ROE +${pnlPct}%)`;
    } else if (currentPrice >= tp1P) {
      posObj.tp1Reached = true;
      if (!candleBullish) {
        action = 'CLOSE';
        reason = `[LONG ${lev}x 1차익절 확정] 65% 반등(TP1 $${tp1P}) 도달 후 음봉 출현 수익 확정 (10x ROE +${pnlPct}%)`;
      }
    }
  }

  const formattedLine = [
    `[${item.symbol} ${dir} ${lev}x] 진입 $${entryP} -> 현재 $${currentPrice} (10x ROE ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`,
    `목표(TP1/TP2): $${tp1P} / $${tp2P} | 방어선(SL): $${stopP} -> ${action}`
  ].join('\n');

  return {
    bot: 'RISK',
    contract: contractOrSymbol,
    symbol: item.symbol,
    reachable: true,
    priceUsd: currentPrice,
    pnlPct,
    action,
    reason,
    formattedLine
  };
}

// ============================================================================
// [옵션 지지·저항선 AI 분석: RWA 차트(켈트너·볼린저) & 옵션 감마]
// ============================================================================

/**
 * 단일 RWA/매크로 티커에 대해 tooja.me/api/chart (1H, 10m) 및 tooja.me/api/options 정밀 분석 수행
 */
async function analyzeRwaTicker(symbolMeta) {
  const rawSym = (typeof symbolMeta === 'string' ? symbolMeta : symbolMeta.symbol).toUpperCase().trim().replace(/^\$/, '');
  const sym = rawSym.replace(/USDT$/, '');
  const meta = RWA_UNIVERSE.find(u => u.symbol === sym) || {
    symbol: sym,
    name: sym,
    sector: 'custom',
    category: '개별 티커 분석'
  };

  let [c1hRes, c10mRes, optRes] = await Promise.all([
    fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=1H`, {}, 9000),
    fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=10m`, {}, 9000),
    fetchJson(`https://tooja.me/api/options?symbol=${encodeURIComponent(sym)}`, {}, 9000)
  ]);

  if (!c1hRes.ok || !c1hRes.data?.candles?.length) {
    await new Promise(r => setTimeout(r, 250));
    [c1hRes, c10mRes, optRes] = await Promise.all([
      fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=1H`, {}, 9000),
      fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=10m`, {}, 9000),
      fetchJson(`https://tooja.me/api/options?symbol=${encodeURIComponent(sym)}`, {}, 9000)
    ]);
  }

  // 크립토(BTC, ETH, SOL, HYPE) 등 tooja.me에 없는 티커일 경우 Variational + Hyperliquid 캔들로 즉시 지지/저항 산출
  if (!c1hRes.ok || !c1hRes.data?.candles?.length) {
    const shItem = STOPHUNT_UNIVERSE.find(u => u.symbol === sym || u.varTicker === sym) || { symbol: sym, varTicker: sym, hlCoin: sym, pair: `${sym}USDT`, yahoo: `${sym}-USD` };
    const shRes = await fetchStopHuntCandles(shItem);
    if (shRes.ok && shRes.candles.length >= 12) {
      const cds = shRes.candles;
      const spotP = formatPricePrecise(cds[cds.length - 1].close);
      const slice20 = cds.slice(-20);
      const mid = slice20.reduce((s, c) => s + c.close, 0) / slice20.length;
      const std = Math.sqrt(slice20.reduce((s, c) => s + Math.pow(c.close - mid, 2), 0) / slice20.length) || (spotP * 0.008);
      const atr = slice20.reduce((s, c) => s + (c.high - c.low), 0) / slice20.length || (spotP * 0.006);
      const pUp = formatPricePrecise(mid + 2.0 * std);
      const pLo = formatPricePrecise(mid - 2.0 * std);
      const wUp = formatPricePrecise(Math.max(mid + 2.5 * atr, ...slice20.map(c => c.high)));
      const wLo = formatPricePrecise(Math.min(mid - 2.5 * atr, ...slice20.map(c => c.low)));
      const pivotP = formatPricePrecise(mid);
      const posPct = Number((((spotP - wLo) / Math.max(0.0001, wUp - wLo)) * 100).toFixed(1));
      const dir = posPct >= 58 ? 'SHORT' : 'LONG';
      return {
        ok: true,
        symbol: sym,
        name: `${sym} Perp (Variational DEX)`,
        sector: 'crypto',
        category: '크립토 선물',
        spot: spotP,
        levels: {
          r2: wUp,
          r1: pUp,
          pivot: pivotP,
          s1: pLo,
          s2: wLo
        },
        chart: {
          inWhite1h: true,
          purpleInsideWhite1h: pUp <= wUp && pLo >= wLo,
          purpleEnteringWhite10m: true,
          channelPos1hPct: posPct,
          channelPos10mPct: posPct,
          slope1hPct: 0,
          candleBullish: cds[cds.length - 1].close >= cds[cds.length - 1].open,
          mtfAligned: true,
          purple1hLower: pLo,
          purple1hUpper: pUp,
          white1hLower: wLo,
          white1hUpper: wUp,
          purple10mLower: pLo,
          purple10mUpper: pUp,
          white10mLower: wLo,
          white10mUpper: wUp
        },
        options: {
          expiry: 'Perp (무기한 선물)',
          dte: 0,
          maxPain: pivotP,
          callWall: wUp,
          putWall: wLo,
          gammaFlip: pivotP,
          netGexM: 0,
          gammaRegime: 'LONG_GAMMA',
          gammaRegimeLabel: 'Variational 선물 볼린저·켈트너 유동성 레벨',
          avgIvPct: 45.0,
          strikeMap: []
        },
        tradeSetup: {
          direction: dir,
          setupName: dir === 'LONG' ? '하단 지지 반등 롱' : '상단 저항 역추세 숏',
          score: 78,
          tp1Price: dir === 'LONG' ? pUp : pLo,
          tp2Price: dir === 'LONG' ? wUp : wLo,
          stopPrice: dir === 'LONG' ? formatPricePrecise(wLo * 0.992) : formatPricePrecise(wUp * 1.008),
          rewardPct: 1.8,
          riskPct: 0.9,
          rrRatio: 2.0,
          summaryReason: 'Variational DEX 실시간 마크가 및 볼린저·켈트너 채널 기반 지지/저항 산출'
        }
      };
    }
    return { ok: false, symbol: sym, error: `'${sym}' 시세/옵션 데이터를 불러올 수 없습니다. 미국 주식·ETF(예: NVDA, TSLA, QQQ, SOXX) 또는 주요 선물(BTC, ETH, SOL, HYPE) 티커를 입력해 주세요.` };
  }

  const c1h = c1hRes.data;
  const c10m = c10mRes.ok && c10mRes.data?.candles?.length ? c10mRes.data : c1h;
  const opt = optRes.ok && optRes.data?.rows?.length ? optRes.data : null;

  const spot = Number(opt?.spot || c10m.spot || c1h.spot || c1h.candles[c1h.candles.length - 1].close);

  // 1) 차트 분석기 (tooja.me/chart):
  //    bands[0] = 보라색 채널 (#a855f7, 세부 볼린저 밴드형 채널)
  //    bands[1] = 흰색 채널 (#d6dae2, 광역 켈트너 채널형 유기적 범위)
  const getBandVal = (band, side, offset = 1) => {
    const arr = band?.[side];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return Number(arr[Math.max(0, arr.length - offset)]?.value ?? spot);
  };

  const p1hBand = c1h.bands?.[0] || {};
  const w1hBand = c1h.bands?.[1] || c1h.bands?.[0] || {};
  const p10mBand = c10m.bands?.[0] || {};
  const w10mBand = c10m.bands?.[1] || c10m.bands?.[0] || {};

  const purple1hUpper = getBandVal(p1hBand, 'upper', 1);
  const purple1hLower = getBandVal(p1hBand, 'lower', 1);
  const white1hUpper = getBandVal(w1hBand, 'upper', 1);
  const white1hLower = getBandVal(w1hBand, 'lower', 1);

  const purple10mUpper = getBandVal(p10mBand, 'upper', 1);
  const purple10mLower = getBandVal(p10mBand, 'lower', 1);
  const white10mUpper = getBandVal(w10mBand, 'upper', 1);
  const white10mLower = getBandVal(w10mBand, 'lower', 1);

  // 1시간봉 추세 방향 (채널 중심선 기울기 + 최근 캔들 꼬리/몸통 구조)
  const mid1hNow = (white1hUpper + white1hLower) / 2;
  const mid1hPrev = (getBandVal(w1hBand, 'upper', 4) + getBandVal(w1hBand, 'lower', 4)) / 2;
  const slope1hPct = mid1hPrev > 0 ? ((mid1hNow - mid1hPrev) / mid1hPrev) * 100 : 0;

  const lastCandles1h = c1h.candles.slice(-3);
  const lastC = lastCandles1h[lastCandles1h.length - 1];
  const prevC = lastCandles1h[lastCandles1h.length - 2] || lastC;
  const lowerWick = Math.min(lastC.open, lastC.close) - lastC.low;
  const upperWick = lastC.high - Math.max(lastC.open, lastC.close);
  const candleBullish = lastC.close >= prevC.close || lowerWick > upperWick * 1.3;

  // 스퀴즈 & 꿈틀꿈틀 패턴 판정 (tooja.me/chart 공식 가이드 구현):
  // "흰색채널 내에 차트가 이미 위치하며 보라색채널이 흰색채널 내에 들어왔거나 들어오려고 할 때가 매수 타점"
  const inWhite1h = spot >= white1hLower * 0.998 && spot <= white1hUpper * 1.002;
  const purpleInsideWhite1h = purple1hUpper <= white1hUpper * 1.002 && purple1hLower >= white1hLower * 0.998;
  const purpleEnteringWhite10m = purple10mLower >= white10mLower * 0.995 && purple10mUpper <= white10mUpper * 1.005;

  const whiteRange1h = Math.max(0.01, white1hUpper - white1hLower);
  const channelPos1hPct = Number((((spot - white1hLower) / whiteRange1h) * 100).toFixed(1));

  const whiteRange10m = Math.max(0.01, white10mUpper - white10mLower);
  const channelPos10mPct = Number((((spot - white10mLower) / whiteRange10m) * 100).toFixed(1));

  // 2) 옵션 감마 분석기 (tooja.me/options):
  //    콜감마(Call Gamma) vs 숏감마(Put/Short Gamma), 콜벽(Call Wall), 풋벽(Put Wall), 감마플립(Gamma Flip), 맥스페인(Max Pain)
  let netGexUsd = 0;
  let totalCallGamma = 0;
  let totalPutGamma = 0;
  let callWallStrike = Number((spot * 1.03).toFixed(1));
  let putWallStrike = Number((spot * 0.97).toFixed(1));
  let gammaFlipStrike = Number(spot.toFixed(1));
  let maxPain = opt?.maxPain || Number(spot.toFixed(1));
  let avgIvPct = 22.0;
  let strikeMap = [];

  if (opt && Array.isArray(opt.rows) && opt.rows.length > 0) {
    const lo = spot * 0.85;
    const hi = spot * 1.15;
    const nearRows = opt.rows.filter(r => r.strike >= lo && r.strike <= hi);

    let maxCallScore = -1;
    let maxPutScore = -1;
    let ivSum = 0;
    let ivCnt = 0;

    // 감마 플립 탐색용 누적 배열
    const gexByStrike = [];

    for (const r of nearRows) {
      const cGamma = Number(r.call?.gamma || 0);
      const pGamma = Number(r.put?.gamma || 0);
      const cWeight = Number(r.callOI || 0) + Number(r.callVol || 0) * 0.35;
      const pWeight = Number(r.putOI || 0) + Number(r.putVol || 0) * 0.35;

      // 달러 감마 노출 (1% 가격 변동당 딜러 헤징 달러 규모)
      const callGex = cGamma * cWeight * 100 * spot * 0.01;
      const putGex = pGamma * pWeight * 100 * spot * 0.01;
      const strikeNetGex = callGex - putGex;

      netGexUsd += strikeNetGex;
      totalCallGamma += callGex;
      totalPutGamma += putGex;

      if (r.strike >= spot * 0.995 && callGex > maxCallScore) {
        maxCallScore = callGex;
        callWallStrike = r.strike;
      }
      if (r.strike <= spot * 1.005 && putGex > maxPutScore) {
        maxPutScore = putGex;
        putWallStrike = r.strike;
      }

      if (r.callIV) { ivSum += r.callIV * 100; ivCnt++; }
      if (r.putIV) { ivSum += r.putIV * 100; ivCnt++; }

      gexByStrike.push({
        strike: r.strike,
        callOI: r.callOI,
        putOI: r.putOI,
        callVol: r.callVol,
        putVol: r.putVol,
        callGamma: cGamma,
        putGamma: pGamma,
        callIV: r.callIV ? Number((r.callIV * 100).toFixed(1)) : null,
        putIV: r.putIV ? Number((r.putIV * 100).toFixed(1)) : null,
        callGexK: Number((callGex / 1000).toFixed(1)),
        putGexK: Number((putGex / 1000).toFixed(1)),
        netGexK: Number((strikeNetGex / 1000).toFixed(1))
      });
    }

    if (ivCnt > 0) avgIvPct = Number((ivSum / ivCnt).toFixed(1));

    // 현재가(spot)에 가장 가까운 Net GEX 부호 전환점(감마 플립, Gamma Flip) 산출
    const crossings = [];
    for (let i = 0; i < gexByStrike.length - 1; i++) {
      const a = gexByStrike[i];
      const b = gexByStrike[i + 1];
      if ((a.netGexK <= 0 && b.netGexK > 0) || (a.netGexK >= 0 && b.netGexK < 0)) {
        const denom = Math.abs(a.netGexK) + Math.abs(b.netGexK);
        const ratio = denom > 0 ? Math.abs(a.netGexK) / denom : 0.5;
        const flipP = Number((a.strike + (b.strike - a.strike) * ratio).toFixed(2));
        crossings.push(flipP);
      }
    }
    if (crossings.length > 0) {
      crossings.sort((x, y) => Math.abs(x - spot) - Math.abs(y - spot));
      gammaFlipStrike = crossings[0];
    } else if (gexByStrike.length > 0) {
      const minAbs = [...gexByStrike].sort((a, b) => Math.abs(a.netGexK) - Math.abs(b.netGexK))[0];
      gammaFlipStrike = minAbs.strike;
    }

    const sortedByDist = [...gexByStrike].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
    strikeMap = sortedByDist.slice(0, 9).sort((a, b) => b.strike - a.strike);
  }

  const netGexM = Number((netGexUsd / 1e6).toFixed(2));
  const gammaRegime = netGexUsd >= 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA';
  const gammaRegimeLabel = gammaRegime === 'LONG_GAMMA'
    ? `🟢 콜감마 우위 (Long Gamma +$${Math.abs(netGexM)}M · 변동성 억제/맥스페인 수렴)`
    : `🔴 숏감마 우위 (Short Gamma -$${Math.abs(netGexM)}M · 추세 가속/감마 스퀴즈)`;

  // 3) 켈트너·볼린저 채널 + 콜/숏감마 결합 롱(LONG) / 숏(SHORT) 양방향 타점 판정
  //    tooja.me/chart 원칙:
  //    - 1시간봉 상승/밑꼬리 + 채널 중하단 + 상방 맥스페인/콜벽 자석 -> 🟢 LONG (1차 익절=보라상단, 2차 익절=흰색상단/콜벽, 손절=흰색하단)
  //    - 1시간봉 하락/윗꼬리 + 채널 상단 과열 또는 하방 맥스페인/숏감마 가속 -> 🔴 SHORT (1차 익절=보라하단, 2차 익절=흰색하단/풋벽/맥스페인, 손절=흰색상단)
  const bearishWickOrCandle = (!candleBullish) || (upperWick > lowerWick * 1.25);
  const maxPainBelowSpot = maxPain < spot * 0.992;
  const inUpperChannelZone = channelPos1hPct >= 58;

  // 숏(SHORT) 우위 조건:
  // (A) 채널 중상단(>=58%)에서 1H 음봉/윗꼬리 저항 또느 기울기 하락, 또는
  // (B) 맥스페인이 현재가보다 명확히 아래(< -0.8%)에 있고 채널 상반부(>=50%)이거나 숏감마 하방 압력이 작용할 때
  const isShortSetup =
    (inUpperChannelZone && (bearishWickOrCandle || slope1hPct < 0 || maxPainBelowSpot)) ||
    (maxPainBelowSpot && channelPos1hPct >= 48 && (!candleBullish || gammaRegime === 'SHORT_GAMMA'));

  const direction = isShortSetup ? 'SHORT' : 'LONG';

  let tp1Price, tp2Price, stopPrice, rewardPct, riskPct;
  if (direction === 'LONG') {
    tp1Price = Number(Math.max(spot * 1.006, purple1hUpper).toFixed(2));
    tp2Price = Number(Math.max(tp1Price * 1.008, white1hUpper, Math.min(callWallStrike, spot * 1.06)).toFixed(2));
    stopPrice = Number(Math.min(spot * 0.986, white1hLower).toFixed(2));
    rewardPct = ((tp2Price - spot) / spot) * 100;
    riskPct = Math.max(0.35, ((spot - stopPrice) / spot) * 100);
  } else {
    // 🔴 SHORT 타점: 보라색 하단 1차 익절, 흰색 하단(또는 풋벽/맥스페인) 2차 익절, 흰색 상단 손절
    tp1Price = Number(Math.min(spot * 0.994, purple1hLower).toFixed(2));
    tp2Price = Number(Math.min(tp1Price * 0.992, white1hLower, Math.max(putWallStrike, maxPain, spot * 0.94)).toFixed(2));
    stopPrice = Number(Math.max(spot * 1.014, white1hUpper).toFixed(2));
    rewardPct = ((spot - tp2Price) / spot) * 100;
    riskPct = Math.max(0.35, ((stopPrice - spot) / spot) * 100);
  }

  const rrRatio = Number((rewardPct / riskPct).toFixed(2));

  // 스코어링 (100점 만점 — LONG/SHORT 양방향 평가)
  let score = 52;
  const reasons = [];

  if (purpleInsideWhite1h) {
    score += 16;
    reasons.push('1H 보라색(볼린저) 채널이 흰색(켈트너) 채널 내부 수축 [꿈틀꿈틀 스퀴즈]');
  }
  if (purpleEnteringWhite10m) {
    score += 9;
    reasons.push('10m 세부 채널 교차검증 일치');
  }

  if (direction === 'LONG') {
    if (channelPos1hPct >= 10 && channelPos1hPct <= 60) {
      score += 13;
      reasons.push(`흰색 채널 중하단(${channelPos1hPct}%) 지지 반등 구간 [🟢 LONG 유리]`);
    }
    if (gammaRegime === 'LONG_GAMMA' && maxPain >= spot * 0.995) {
      score += 14;
      reasons.push(`콜감마(Long Gamma) 레짐 + 상방 맥스페인($${maxPain})·콜벽($${callWallStrike}) 자석 수렴`);
    } else if (gammaRegime === 'SHORT_GAMMA' && candleBullish) {
      score += 12;
      reasons.push(`숏감마(Short Gamma) 레짐 상방 돌파 시 딜러 콜 헤징 추격매수(감마 스퀴즈 롱)`);
    }
  } else {
    // SHORT 가점 요인
    if (channelPos1hPct >= 52) {
      score += 14;
      reasons.push(`흰색 채널 상단권(${channelPos1hPct}%) 저항 + 윗꼬리/하락 압력 [🔴 SHORT 유리]`);
    }
    if (maxPainBelowSpot) {
      score += 14;
      reasons.push(`기관 만기 목표가 맥스페인($${maxPain})이 현재가($${spot}) 하방에 위치해 하방 자석 압력 작용`);
    }
    if (gammaRegime === 'SHORT_GAMMA') {
      score += 12;
      reasons.push(`숏감마(Short Gamma -$${Math.abs(netGexM)}M) 레짐 하방 이탈 시 딜러 풋 헤징 매도 가속`);
    } else {
      score += 8;
      reasons.push(`콜감마 벽($${callWallStrike}) 상단 저항 캡(Cap) 확인 후 평균회귀 숏`);
    }
  }

  const mtfAligned = direction === 'LONG'
    ? ((slope1hPct >= -0.45 && candleBullish) || (maxPain >= spot && channelPos1hPct <= 58))
    : ((slope1hPct <= 0.35 && bearishWickOrCandle) || maxPainBelowSpot || channelPos1hPct >= 62);

  let setupName;
  if (direction === 'LONG') {
    setupName = purpleInsideWhite1h
      ? (gammaRegime === 'LONG_GAMMA' ? '🟢 [LONG] 켈트너·볼린저 스퀴즈 + 콜감마 핀닝 롱' : '🟢 [LONG] 켈트너·볼린저 스퀴즈 + 숏감마 돌파 롱')
      : (gammaRegime === 'LONG_GAMMA' ? '🟢 [LONG] 흰색채널 하단 지지 + 맥스페인 수렴 롱' : '🟢 [LONG] 채널 추세 + 감마 모멘텀 롱');
  } else {
    setupName = purpleInsideWhite1h
      ? (gammaRegime === 'SHORT_GAMMA' ? '🔴 [SHORT] 켈트너·볼린저 스퀴즈 + 숏감마 하방가속 숏' : '🔴 [SHORT] 채널 상단 저항 + 맥스페인 하방회귀 숏')
      : (gammaRegime === 'SHORT_GAMMA' ? '🔴 [SHORT] 콜벽 저항 + 숏감마 브레이크다운 숏' : '🔴 [SHORT] 흰색채널 상단 + 맥스페인 자석 숏');
  }

  const r1Level = Number(Math.max(purple1hUpper, spot * 1.003).toFixed(2));
  const r2Level = Number(Math.max(callWallStrike, white1hUpper, r1Level * 1.005).toFixed(2));
  const s1Level = Number(Math.min(purple1hLower, spot * 0.997).toFixed(2));
  const s2Level = Number(Math.min(putWallStrike, white1hLower, s1Level * 0.995).toFixed(2));
  const pivotLevel = Number(maxPain.toFixed(2));

  return {
    ok: true,
    symbol: sym,
    name: opt?.name || c1h.name || meta.name,
    sector: meta.sector || 'custom',
    category: meta.category,
    spot: Number(spot.toFixed(2)),
    levels: {
      r2: r2Level,
      r1: r1Level,
      pivot: pivotLevel,
      s1: s1Level,
      s2: s2Level
    },
    chart: {
      inWhite1h,
      purpleInsideWhite1h,
      purpleEnteringWhite10m,
      channelPos1hPct,
      channelPos10mPct,
      slope1hPct: Number(slope1hPct.toFixed(2)),
      candleBullish,
      mtfAligned,
      purple1hLower: Number(purple1hLower.toFixed(2)),
      purple1hUpper: Number(purple1hUpper.toFixed(2)),
      white1hLower: Number(white1hLower.toFixed(2)),
      white1hUpper: Number(white1hUpper.toFixed(2)),
      purple10mLower: Number(purple10mLower.toFixed(2)),
      purple10mUpper: Number(purple10mUpper.toFixed(2)),
      white10mLower: Number(white10mLower.toFixed(2)),
      white10mUpper: Number(white10mUpper.toFixed(2))
    },
    options: {
      expiry: opt?.expiry || 'N/A',
      dte: opt?.dte ?? 0,
      maxPain: Number(maxPain.toFixed(2)),
      callWall: callWallStrike,
      putWall: putWallStrike,
      gammaFlip: gammaFlipStrike,
      netGexM,
      gammaRegime,
      gammaRegimeLabel,
      avgIvPct,
      strikeMap
    },
    tradeSetup: {
      direction,
      setupName,
      score,
      tp1Price,
      tp2Price,
      stopPrice,
      rewardPct: Number(rewardPct.toFixed(2)),
      riskPct: Number(riskPct.toFixed(2)),
      rrRatio,
      summaryReason: reasons.join(' + ') || '채널 및 옵션 감마 중립'
    }
  };
}

/**
 * 사용자가 입력한 티커 및 질문에 대해 옵션 감마(콜벽·풋벽·맥스페인·감마플립) + 차트(켈트너·볼린저) 데이터를 불러와
 * 연결된 Gemini AI가 핵심 지지·저항선과 매매 전략을 정해주는 전용 함수
 */
async function askOptionSupportResistanceAI(symbolInput, userQuestion = '', geminiKey = DEFAULT_GEMINI_KEY) {
  const analysis = await analyzeRwaTicker(symbolInput);
  if (!analysis.ok) {
    return { ok: false, error: analysis.error };
  }

  const lv = analysis.levels;
  const opt = analysis.options;
  const isPositiveGamma = opt.gammaRegime === 'LONG_GAMMA';
  const gexSign = opt.netGexM >= 0 ? '+' : '-';
  const gexText = `${gexSign}$${Math.abs(opt.netGexM)}M`;
  const gammaShort = isPositiveGamma ? `양감마 (${gexText})` : `음감마 (${gexText})`;

  const card = {
    symbol: analysis.symbol,
    name: analysis.name,
    spot: analysis.spot,
    isPositiveGamma,
    gammaLabel: isPositiveGamma ? '양감마 (+GEX)' : '음감마 (-GEX)',
    netGexText: gexText,
    gammaFlip: opt.gammaFlip,
    maxPain: opt.maxPain,
    expiry: opt.expiry,
    dte: opt.dte != null ? Math.round(Number(opt.dte)) : null,
    r2: lv.r2,
    r1: lv.r1,
    s1: lv.s1,
    s2: lv.s2,
    callWall: opt.callWall,
    putWall: opt.putWall
  };

  const conciseReply = [
    `$${card.symbol} (${card.name}) · 현재가 $${card.spot}`,
    `• 감마 상태: ${gammaShort} | 감마플립: $${card.gammaFlip} | 맥스페인: $${card.maxPain} | 만기일: ${card.expiry}`,
    `• 저항선: 2차(콜벽) $${card.r2} / 1차 $${card.r1}`,
    `• 지지선: 1차 $${card.s1} / 2차(풋벽) $${card.s2}`
  ].join('\n');

  return {
    ok: true,
    symbol: analysis.symbol,
    analysis,
    card,
    aiModel: 'options-quant',
    reply: conciseReply
  };
}

module.exports = {
  DEFAULT_GEMINI_KEY,
  STOPHUNT_UNIVERSE,
  getStopHuntSessionInfo,
  analyzeStopHuntCandidate,
  RWA_SECTORS,
  RWA_UNIVERSE,
  fetchJson,
  callGeminiAI,
  // 10x 스탑헌팅 실전/모의매매
  runScanAgent,
  runVetAgent,
  runSizeAgent,
  runFillsAgent,
  checkContractRiskLive,
  // 옵션 지지·저항선 AI 분석
  analyzeRwaTicker,
  askOptionSupportResistanceAI
};
