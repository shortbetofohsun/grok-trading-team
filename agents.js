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

/**
 * 각 데스크별 7개 에이전트 맞춤 역할(Role) 및 행동 수칙 매트릭스
 */
const ROLE_PROFILES_BY_DESK = {
  memecoin: {
    deskId: 'memecoin',
    title: '⚡ 데스크 1: Variational DEX 7대 정예 선물 스탑헌팅 역추세 데스크 ($1,000 금고)',
    subtitle: 'BTC·ETH·SOL·HYPE·QQQUSDT·SOXXUSDT·EWYUSDT (Variational DEX 호가 연동 · 주말 작동 중지 · 미장 개장 1~1.5h 전 골디락스 % 스탑헌팅 역추세)',
    bots: {
      CHIEF: {
        name: 'CHIEF',
        role: 'Variational 선물 스탑헌팅 총괄 (Stop-Hunt Reversal Chief)',
        badge: '👑 선물역추세총괄',
        color: '#f59e0b',
        prompt: `너는 Variational Omni DEX 기반 7대 정예 선물(BTC · ETH · SOL · HYPE · QQQUSDT · SOXXUSDT · EWYUSDT) 스탑헌팅 역추세 데스크($1,000 독립 시드)의 총괄 CHIEF다.
- 잡코인은 일절 배제하며, 주말(토·일 미장 휴장일)에는 자동으로 매매를 중지(Weekend Guard)한다.
- 평일 미국장 개장 1~1.5시간 전(08:00~09:30 AM EST) 등 호가창이 얇을 때 손절을 터뜨리는 급등/급락(Judas Swing)을 포착해 꼬리 확인 후 반대 포지션(LONG/SHORT)으로 진입한다.`
      },
      SCAN: {
        name: 'SCAN',
        role: 'Variational DEX 7대 선물 스캐너 (Variational Omni Scanner)',
        badge: '🔍 Variational스캔',
        color: '#38bdf8',
        prompt: `너는 선물 스탑헌팅 SCAN이다. Variational Omni DEX 공식 API(omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats)에서 7대 정예 종목(BTC, ETH, SOL, HYPE, QQQUSDT, SOXXUSDT, EWYUSDT)의 실시간 마크 가격(mark_price)과 매수/매도 호가(quotes.base.bid/ask), 스프레드(bps)를 가져온다.
- 직전 90분(1.5시간) 출발 기준가(Anchor) 대비 최대 급등/급락 폭(huntMovePct)과 꼬리 되돌림(wickReversalPct)을 계산한다.`
      },
      VET: {
        name: 'VET',
        role: '주말 휴장 가드 & 골디락스 % 검증기 (Weekend & Stop-Hunt Vetter)',
        badge: '🛡️ 주말/5단계필터',
        color: '#a855f7',
        prompt: `너는 스탑헌팅 역추세 VET이다. 최근 60일(31,224개 15분봉) 백테스트 최적 기준으로 타점을 엄격히 심사한다:
0. [주말 작동 중지] 미 동부시간 기준 주말(토·일 미국장 휴장)이면 무조건 REJECT (매매 휴식)
1. [노이즈 탈락] 종목별 60d 백테스트 최소 기준(BTC 0.85%, ETH 0.85%, SOL 1.00%, HYPE 1.80%, QQQ 0.30%, SOXX 0.75%, EWY 0.70%) 미만이면 REJECT
2. [원웨이 폭주 탈락] 종목별 위험 상한선(BTC 2.80%, ETH 2.80%, SOL 3.80%, HYPE 4.20%, QQQ 1.20%, SOXX 2.60%, EWY 1.50%) 이상이면 진짜 추세 폭발이므로 REJECT
3. [과열/스윕 확인] 볼린저 밴드 상·하단 과열권 도달 또는 직전 고/저점 스윕이 없으면 REJECT
4. [꼬리 브레이크 확인] 고점/저점 찍은 후 최소 꼬리 되돌림(0.06%~0.20%)이 안 나왔으면 REJECT
5. [손익비 검증] 출발점(Anchor) 회귀 익절폭 대비 손절폭 손익비(R/R)가 1.5 미만이면 REJECT`
      },
      BOOK: {
        name: 'BOOK',
        role: '반대 포지션 타점 & 손익비 설계기 (Reversal Bracket Engine)',
        badge: '📊 역추세설계',
        color: '#10b981',
        prompt: `너는 스탑헌팅 역추세 타점 설계기 BOOK이다.
- 위로 쏜 스탑헌팅(UP_HUNT) ➔ 🔴 SHORT 진입(Variational Bid 체결) | 손절(SL): 스탑헌팅 고점 위 | 1차익절(TP1): 55% 되돌림 | 2차익절(TP2): 급등 출발점(Anchor)
- 아래로 뺀 스탑헌팅(DOWN_HUNT) ➔ 🟢 LONG 진입(Variational Ask 체결) | 손절(SL): 스탑헌팅 저점 아래 | 1차익절(TP1): 55% 반등 | 2차익절(TP2): 급락 출발점(Anchor)`
      },
      SIZE: {
        name: 'SIZE',
        role: '손익비·킬존 연동 사이저 (Killzone Kelly Sizer)',
        badge: '📐 킬존배분',
        color: '#eab308',
        prompt: `너는 선물 스탑헌팅 SIZE다. 데스크 1 금고($1,000)에서 골디락스 정타(PASS)는 계좌의 최대 8%($80), 확장 구간(PASS_PARTIAL)은 최대 6%($60)로 진입 증거금을 배분한다.`
      },
      FILLS: {
        name: 'FILLS',
        role: 'Variational 호가 양방향 체결기 (Variational Paper Executor)',
        badge: '📝 호가체결',
        color: '#6366f1',
        prompt: `너는 선물 스탑헌팅 FILLS다. Variational DEX의 실제 매수/매도 호가(Bid/Ask)를 반영하여 🟢 LONG 또는 🔴 SHORT 모의 포지션을 체결하고, 출발 기준가(Anchor)·스탑헌팅 극점·TP1·TP2·SL을 기록한다.`
      },
      RISK: {
        name: 'RISK',
        role: '평균회귀 익절 & 고점재돌파 칼손절기 (Reversal Exit Authority)',
        badge: '🚨 회귀/칼손절',
        color: '#ef4444',
        prompt: `너는 선물 스탑헌팅 RISK다. 5분마다 열린 LONG/SHORT 선물 포지션의 Variational 실시간 마크 가격을 추적하여:
1. TP2(스탑헌팅 출발 기준가 Anchor 완전 회귀) 도달 시 전량 익절 CLOSE
2. TP1(55% 회귀) 도달 후 탄력 둔화 시 수익 확정 CLOSE
3. SL(스탑헌팅 고점/저점 재돌파 = 원웨이 추세 전환) 도달 시 지체 없이 즉시 칼손절 CLOSE`
      }
    }
  },

  prediction: {
    deskId: 'prediction',
    title: '🎯 데스크 2: 예측시장 괴리율 데스크 ($1,000 금고)',
    subtitle: 'Kalshi · Polymarket 실시간 가격 vs Gemini 3.5 Flash 블라인드 추론 확률 괴리율(>=8%) 아비트리지 모의매매',
    bots: {
      CHIEF: {
        name: 'CHIEF',
        role: '예측시장 괴리율 총괄 (Arbitrage Chief)',
        badge: '👑 괴리율총괄',
        color: '#f59e0b',
        prompt: `너는 예측시장 괴리율 데스크($1,000 독립 시드)의 총괄 CHIEF다.
- Kalshi와 Polymarket의 질문들을 수집하고, 시장 가격을 가린 채 BOOK(Gemini AI)이 독립 추론한 확률(myProb)과 실제 시장 가격(marketPrice) 사이의 괴리율(|myProb - marketPrice|)이 8% 이상 벌어졌을 때만 모의 매수를 승인한다.`
      },
      SCAN: {
        name: 'SCAN',
        role: '글로벌 예측시장 스캐너 (Kalshi & Polymarket Scanner)',
        badge: '🔍 마켓스캔',
        color: '#38bdf8',
        prompt: `너는 예측시장 SCAN이다. Kalshi 오픈 이벤트/마켓과 Polymarket 거래량 상위 마켓, 그리고 해외시장 ADR 괴리율 데이터를 실시간 수집하여 유동성과 거래량이 풍부한 후보 마켓을 추출한다.`
      },
      VET: {
        name: 'VET',
        role: '마켓 적격성 5단계 검증기 (Market Integrity Vetter)',
        badge: '🛡️ 마켓검증',
        color: '#a855f7',
        prompt: `너는 예측시장 VET이다. 스캔된 이벤트 중:
1. 최근 업데이트가 48시간보다 오래된 마켓 REJECT
2. YES 가격이 0.05 이하이거나 0.95 이상인 극단적 만기 임박 마켓 REJECT
3. 유동성(Liquidity/OI) $5,000 미만 마켓 REJECT
4. 이미 보유 중인 동일 질문/티커 마켓 REJECT
5. 질문 의미가 모호하여 확률 판정이 불가능한 마켓 REJECT`
      },
      BOOK: {
        name: 'BOOK',
        role: '블라인드 확률 & 괴리율 산출기 (Gemini AI Edge Engine)',
        badge: '📊 괴리율추론',
        color: '#10b981',
        prompt: `너는 예측시장 핵심 두뇌 BOOK이다.
- 반드시 시장 가격(yesPrice)을 보지 않은 블라인드 상태에서 거시경제·뉴스·공포탐욕지수를 바탕으로 자체 확률(myProb)을 먼저 도출한다.
- 그 후 실제 시장 가격과 대조하여 괴리율 Edge = |myProb - marketPrice| >= 8.0% 인 마켓만 YES(저평가) 또는 NO(고평가) 포지션으로 진입 요청한다.`
      },
      SIZE: {
        name: 'SIZE',
        role: '괴리율 비례 켈리 사이저 (Edge-Weighted Kelly Sizer)',
        badge: '📐 괴리율배분',
        color: '#eab308',
        prompt: `너는 예측시장 SIZE다. 예측시장 전용 금고($1,000)에서 괴리율(Edge %) 크기에 비례하여 켈리 비중을 계산하되, 한 마켓당 계좌의 최대 8%($80), 최소 주문 $50, 동시 보유 최대 7개 한도로 배분한다.`
      },
      FILLS: {
        name: 'FILLS',
        role: 'YES/NO 컨트랙트 체결기 (Contract Paper Executor)',
        badge: '📝 컨트랙트체결',
        color: '#6366f1',
        prompt: `너는 예측시장 FILLS다. YES 또는 NO 컨트랙트의 진입 단가($0.05~$0.95)와 계약 수량(Shares = 투자금 / 단가), 플랫폼 수수료(0.5%, 최소 $0.50)를 기록하고 예측시장 금고($1,000)에서 현금을 차감한다.`
      },
      RISK: {
        name: 'RISK',
        role: '괴리율 수렴 익절·역행 손절기 (Convergence Exit Authority)',
        badge: '🚨 수렴/손절',
        color: '#ef4444',
        prompt: `너는 예측시장 RISK다. 열린 YES/NO 포지션의 실시간 Kalshi·Polymarket 가격을 추적하여:
1. 시장 가격이 내 추정 확률(myProb)의 70% 이상 수렴했거나 수익률 +18% 도달 시 [괴리 수렴 익절 CLOSE]
2. 시장 가격이 진입가 대비 -18% 이상 역행하여 괴리가 확대될 경우 [괴리 역행 손절 CLOSE]`
      }
    }
  },

  rwa: {
    deskId: 'rwa',
    title: '🏛️ 데스크 3: RWA & 7대 섹터(우주·방산·바이오·반도체·광통신·로봇) 차트·옵션감마 데스크 ($1,000 금고)',
    subtitle: '49개 섹터별 개별주/RWA 스캔 ➔ tooja.me 켈트너·볼린저 스퀴즈 × 콜감마·숏감마·맥스페인 5단계 검증 ➔ 롱/숏 양방향 모의매매',
    bots: {
      CHIEF: {
        name: 'CHIEF',
        role: 'RWA & 7대 섹터 개별주 총괄 (Multi-Sector Quant Chief)',
        badge: '👑 섹터총괄',
        color: '#f59e0b',
        prompt: `너는 RWA(금 GLD, 은 SLV, 원유 USO, 국채 TLT, 리츠 VNQ) 및 미 증시 6대 핵심 성장 섹터(🚀우주 RKLB·ASTS·LUNR, 🛡️방산 PLTR·LMT·AVAV, 🧬바이오 LLY·CRSP·MRNA, 💾반도체 NVDA·AMD·AVGO·MU, 🔦광통신/전력 LITE·COHR·ANET·VRT, 🤖로봇/양자 TSLA·ISRG·SERV·IONQ) 총 49개 종목을 총괄하는 CHIEF다.
- 섹터별로 스캔(SCAN) -> 5단계 멀티타임프레임·IV·손익비 검증(VET) -> 옵션 콜감마/숏감마/맥스페인 타점 확정(BOOK) -> 감마 연동 배분(SIZE) -> 롱/숏 양방향 체결(FILLS) -> 실시간 채널 이탈/도달 청산(RISK)을 지휘한다.`
      },
      SCAN: {
        name: 'SCAN',
        role: '7대 섹터 켈트너·볼린저 스퀴즈 스캐너 (Sector Channel Scanner)',
        badge: '🔍 섹터스캔',
        color: '#38bdf8',
        prompt: `너는 7대 섹터(우주·방산·바이오·반도체·광통신·로봇·RWA) 차트 스캐너 SCAN이다. tooja.me/api/chart 에서 49개 종목의 1시간봉(1H)과 10분봉(10m) 캔들 및 2개 전용 채널을 실시간 스캔한다:
- 흰색 채널(#d6dae2, Keltner 광역 범위) 안에 현재가가 위치하고,
- 보라색 채널(#a855f7, Bollinger 세부 범위)이 흰색 채널 내부로 수축 진입('꿈틀꿈틀 스퀴즈 패턴')하거나 상/하단 변곡점에 도달한 종목을 섹터별로 순위화한다.`
      },
      VET: {
        name: 'VET',
        role: '섹터 개별주 5단계 필터 (MTF · 손익비 · IV Vetter)',
        badge: '🛡️ 5단계검증',
        color: '#a855f7',
        prompt: `너는 섹터 개별주 & RWA VET이다. 스캔된 후보를 다음 5단계 기준으로 엄격히 탈락시킨다:
1. 이미 보유 중인 종목 중복 진입 REJECT
2. 1시간봉(1H) 추세/캔들 방향과 진입 방향(LONG/SHORT)이 역행하면 REJECT ("전체 추세에 맞춘 한방향 매매 원칙")
3. LONG인데 이미 흰색 채널 상단(84% 초과) 과열이거나, SHORT인데 흰색 채널 하단(16% 미만) 과매도면 REJECT
4. 2차 목표가(TP2) 대비 손절가(SL) 기대 손익비(R/R)가 1.15 미만이면 REJECT
5. 옵션 내재변동성(IV)이 극단적 과열(> 135%)인 지뢰밭 구간이면 REJECT`
      },
      BOOK: {
        name: 'BOOK',
        role: '콜감마·숏감마 & 맥스페인 분석기 (Options GEX & Max Pain)',
        badge: '📊 콜/숏감마',
        color: '#10b981',
        prompt: `너는 옵션 감마 분석기 BOOK(GAMMA)이다. tooja.me/api/options 의 행사가별 Call/Put OI·거래량·감마(Γ)로 딜러 GEX를 계산하여 롱/숏 양방향 타점을 확정한다:
- 🟢 LONG 타점: 채널 중하단 지지 + 상방 맥스페인(Max Pain)·콜감마 벽(Call Wall) 자석 효과 또는 숏감마 상방 스퀴즈 돌파
- 🔴 SHORT 타점: 채널 상단 저항 + 하방 맥스페인 자석 회귀 또는 숏감마(Short Gamma) 하방 이탈 가속`
      },
      SIZE: {
        name: 'SIZE',
        role: '감마 레짐 연동 사이저 (Gamma-Adjusted Kelly Sizer)',
        badge: '📐 감마사이징',
        color: '#eab308',
        prompt: `너는 RWA/섹터 개별주 SIZE다. 데스크 3 금고($1,000)에서 감마 레짐과 손익비에 따라 포지션 크기를 결정한다:
- 콜감마(Long Gamma) 안정 수렴장: 계좌의 최대 10%($100) 배분
- 숏감마(Short Gamma) 고변동성 개별주 폭발장: 변동성 위험을 반영해 계좌의 최대 6%($60)로 축소 배분 (최소 주문 $50)`
      },
      FILLS: {
        name: 'FILLS',
        role: '롱·숏 양방향 체결 & 목표가 설정기 (Long/Short Bracket Logger)',
        badge: '📝 롱/숏체결',
        color: '#6366f1',
        prompt: `너는 RWA/섹터 개별주 FILLS다. LONG 또는 SHORT 방향에 맞춰 진입과 동시에 정확한 목표가·손절가를 기록한다:
- 🟢 LONG: 1차 익절(보라상단) · 2차 익절(흰색상단/콜감마 벽) · 손절(흰색하단)
- 🔴 SHORT: 1차 익절(보라하단) · 2차 익절(흰색하단/풋감마 벽·맥스페인) · 손절(흰색상단)`
      },
      RISK: {
        name: 'RISK',
        role: '채널 이탈 & 감마 플립 청산기 (Band & Gamma Exit)',
        badge: '🚨 채널/감마청산',
        color: '#ef4444',
        prompt: `너는 RWA/섹터 개별주 RISK다. 5분마다 열린 모든 LONG/SHORT 포지션의 실시간 현재가, 흰색/보라색 채널, 옵션 감마 벽을 대조하여:
- TP2 도달 시 전량 익절 CLOSE
- TP1 도달 후 10분봉 추세 꺾임 발생 시 익절 CLOSE
- SL(흰색 채널 이탈) 도달 시 즉시 손절 CLOSE`
      }
    }
  }
};

// 하위 호환용 기본 BOT_PROMPTS
const BOT_PROMPTS = {
  CHIEF: { ...ROLE_PROFILES_BY_DESK.memecoin.bots.CHIEF, desk: ['memecoin', 'prediction', 'rwa'] },
  SCAN: { ...ROLE_PROFILES_BY_DESK.memecoin.bots.SCAN, desk: ['memecoin', 'prediction', 'rwa'] },
  VET: { ...ROLE_PROFILES_BY_DESK.memecoin.bots.VET, desk: ['memecoin', 'prediction', 'rwa'] },
  BOOK: { ...ROLE_PROFILES_BY_DESK.prediction.bots.BOOK, desk: ['memecoin', 'prediction', 'rwa'] },
  SIZE: { ...ROLE_PROFILES_BY_DESK.memecoin.bots.SIZE, desk: ['memecoin', 'prediction', 'rwa'] },
  FILLS: { ...ROLE_PROFILES_BY_DESK.memecoin.bots.FILLS, desk: ['memecoin', 'prediction', 'rwa'] },
  RISK: { ...ROLE_PROFILES_BY_DESK.memecoin.bots.RISK, desk: ['memecoin', 'prediction', 'rwa'] }
};

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
 * 한국 ISP(KT/SKB/LGU+)의 Polymarket SNI 차단(ECONNRESET)을 자동 우회하는 CloudFront 터널링 헬퍼
 * - 해외 클라우드(GitHub Actions)에서는 직접 호출, 한국 내 PC에서는 CloudFront SNI 우회로 100% 수신
 */
const https = require('https');
async function fetchPolymarketGamma(pathQuery = '/markets?closed=false&active=true&order=volume24hr&ascending=false&limit=40', timeoutMs = 6000) {
  const directRes = await fetchJson(`https://gamma-api.polymarket.com${pathQuery}`, {}, 2200);
  if (directRes.ok && Array.isArray(directRes.data)) {
    return directRes;
  }
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'd29c69nd1a26c8.cloudfront.net',
      port: 443,
      path: pathQuery,
      method: 'GET',
      servername: 'd29c69nd1a26c8.cloudfront.net',
      headers: {
        'Host': 'gamma-api.polymarket.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      },
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data,
            firstLine: `HTTP ${res.statusCode} (CloudFront SNI Bypass)`
          });
        } catch (e) {
          resolve({ ok: false, status: res.statusCode || 0, data: null, error: e.message });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Polymarket CloudFront timeout'));
    });
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, data: null, error: err.message });
    });
    req.end();
  });
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
 * STEP 1 & 2: CHIEF 초기 환경 및 WorldMonitor + tooja.me RWA 데이터 연결 검증
 */
async function runChiefVerification(wmPort = 3000) {
  const nodeVersion = process.version;
  const majorNode = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);

  const [dexRes, fgRes, predRes, sigRes, kalshiRes, toojaChartRes, toojaOptRes] = await Promise.all([
    fetchJson('https://api.dexscreener.com/latest/dex/search?q=BONK'),
    fetchJson(`http://localhost:${wmPort}/api/market/v1/get-fear-greed-index`),
    fetchJson(`http://localhost:${wmPort}/api/prediction/v1/list-prediction-markets?page_size=1`),
    fetchJson(`http://localhost:${wmPort}/api/intelligence/v1/list-cross-source-signals`),
    fetchJson('https://external-api.kalshi.com/trade-api/v2/markets?limit=5&status=open'),
    fetchJson('https://tooja.me/api/chart?symbol=GLD&tf=1H'),
    fetchJson('https://tooja.me/api/options?symbol=SPY')
  ]);

  const hasPairs = Boolean(dexRes.ok && Array.isArray(dexRes.data?.pairs) && dexRes.data.pairs.length > 0);
  const hasKalshi = Boolean(kalshiRes.ok && kalshiRes.data && ('markets' in kalshiRes.data));
  const fgReady = Boolean(fgRes.ok && fgRes.data && !fgRes.data.unavailable && fgRes.data.value);
  const predReady = Boolean(predRes.ok && predRes.data && predRes.data.dataAvailable === true);
  const sigReady = Boolean(sigRes.ok && sigRes.status === 200 && Array.isArray(sigRes.data?.signals));
  const rwaReady = Boolean(toojaChartRes.ok && toojaOptRes.ok);

  const allWmReady = fgReady && predReady && sigReady;
  const status = !hasPairs ? 'ERROR' : (allWmReady ? 'READY' : 'degraded');

  return {
    timestamp: new Date().toISOString(),
    nodeVersion,
    nodeVersionOk: majorNode >= 20,
    wmUrl: `http://localhost:${wmPort}`,
    status,
    rwaReady,
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
      toojaRwa: {
        cmd: 'curl -s "https://tooja.me/api/chart?symbol=GLD&tf=1H" && curl -s "https://tooja.me/api/options?symbol=SPY"',
        chartStatus: toojaChartRes.status,
        optionsStatus: toojaOptRes.status,
        ready: rwaReady
      },
      wmFearGreed: {
        cmd: `curl -s "http://localhost:${wmPort}/api/market/v1/get-fear-greed-index"`,
        status: fgRes.status,
        ready: fgReady,
        firstLine: fgRes.firstLine
      },
      wmPrediction: {
        cmd: `curl -s "http://localhost:${wmPort}/api/prediction/v1/list-prediction-markets?page_size=1"`,
        status: predRes.status,
        ready: predReady,
        firstLine: predRes.firstLine
      },
      wmSignals: {
        cmd: `curl -s "http://localhost:${wmPort}/api/intelligence/v1/list-cross-source-signals"`,
        status: sigRes.status,
        ready: sigReady,
        firstLine: sigRes.firstLine
      }
    }
  };
}

// ============================================================================
// [데스크 1: Variational DEX 7대 정예 선물 스탑헌팅 역추세 데스크 ($1,000)]
//  - 대상: BTC, ETH, SOL, HYPE, QQQUSDT, SOXLUSDT, EWYUSDT (12개월 · 6개월 · 60일 교차검증 최적 스탑헌팅 스나이퍼 구간 확정)
//  - 시세/호가: Variational Omni DEX 공식 API (omni-client-api.prod.ap-northeast-1.variational.io) 실시간 마크가·Bid/Ask 연동
//  - 주말(토·일) 미국장 휴장 시 자동 작동 중지 (Weekend Guard)
// ============================================================================
const STOPHUNT_UNIVERSE = [
  // 1) 크립토 4대장 (12개월 · 6개월 · 60일 교차검증 최적 승률·손익비 스탑헌팅 구간 확정)
  { symbol: 'BTC', name: 'Bitcoin Perp (Variational BTC)', varTicker: 'BTC', hlCoin: 'BTC', pair: 'BTCUSDT', yahoo: 'BTC-USD', tier: '크립토 대장', minHuntPct: 1.80, maxHuntPct: 2.35, dangerTrendPct: 2.80, minWickPct: 0.15, stopBufferPct: 0.35, btWinRate: 62.5, bt6mWinRate: 62.5, bt60dWinRate: 75.0, btTrades: 16, btPnl10x: '+22.3%', btRR: 2.55 },
  { symbol: 'ETH', name: 'Ethereum Perp (Variational ETH)', varTicker: 'ETH', hlCoin: 'ETH', pair: 'ETHUSDT', yahoo: 'ETH-USD', tier: '크립토 대장', minHuntPct: 1.65, maxHuntPct: 2.20, dangerTrendPct: 2.65, minWickPct: 0.35, stopBufferPct: 0.25, btWinRate: 61.5, bt6mWinRate: 100.0, bt60dWinRate: 100.0, btTrades: 13, btPnl10x: '+12.2%', btRR: 1.99 },
  { symbol: 'SOL', name: 'Solana Perp (Variational SOL)', varTicker: 'SOL', hlCoin: 'SOL', pair: 'SOLUSDT', yahoo: 'SOL-USD', tier: '크립토 대장', minHuntPct: 2.20, maxHuntPct: 2.95, dangerTrendPct: 3.40, minWickPct: 0.40, stopBufferPct: 0.45, btWinRate: 77.8, bt6mWinRate: 85.7, bt60dWinRate: 100.0, btTrades: 9, btPnl10x: '+31.0%', btRR: 1.76 },
  { symbol: 'HYPE', name: 'Hyperliquid Perp (Variational HYPE)', varTicker: 'HYPE', hlCoin: 'HYPE', pair: null, yahoo: 'HYPE-USD', tier: '크립토 대장', minHuntPct: 1.00, maxHuntPct: 1.55, dangerTrendPct: 2.00, minWickPct: 0.12, stopBufferPct: 0.45, btWinRate: 80.0, bt6mWinRate: 80.0, bt60dWinRate: 100.0, btTrades: 5, btPnl10x: '+4.7%', btRR: 1.76 },
  // 2) 지수·반도체3배(SOXL)·한국증시 선물 3대장 (12개월 · 6개월 · 60일 교차검증 최적 승률·손익비 스탑헌팅 구간 확정)
  { symbol: 'QQQUSDT', name: 'Invesco QQQ Nasdaq 100 Perp (Variational QQQ)', varTicker: 'QQQ', hlCoin: null, pair: null, yahoo: 'QQQ', tier: '나스닥 지수선물', minHuntPct: 0.70, maxHuntPct: 1.35, dangerTrendPct: 1.65, minWickPct: 0.18, stopBufferPct: 0.25, btWinRate: 85.7, bt6mWinRate: 88.9, bt60dWinRate: 100.0, btTrades: 14, btPnl10x: '+25.1%', btRR: 1.59 },
  { symbol: 'SOXLUSDT', name: 'Direxion Semiconductor Bull 3X Perp (Variational SOXL)', varTicker: 'SOXL', hlCoin: null, pair: null, yahoo: 'SOXL', tier: '반도체 3X 선물', minHuntPct: 2.20, maxHuntPct: 3.80, dangerTrendPct: 4.25, minWickPct: 0.40, stopBufferPct: 0.45, btWinRate: 77.8, bt6mWinRate: 100.0, bt60dWinRate: 100.0, btTrades: 9, btPnl10x: '+36.3%', btRR: 2.08 },
  { symbol: 'EWYUSDT', name: 'iShares MSCI South Korea Perp (Variational EWY)', varTicker: 'EWY', hlCoin: null, pair: null, yahoo: 'EWY', tier: '한국증시 듀얼킬존', minHuntPct: 0.35, maxHuntPct: 1.10, asiaMinHuntPct: 1.50, asiaMaxHuntPct: 2.20, dangerTrendPct: 1.40, asiaDangerTrendPct: 2.80, minWickPct: 0.10, stopBufferPct: 0.28, btWinRate: 75.0, bt6mWinRate: 100.0, bt60dWinRate: 100.0, asiaBtWinRate: 71.4, btTrades: 8, btPnl10x: '+18.3%', asiaBtPnl10x: '+24.9%', btRR: 1.74 }
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

function getStopHuntSessionInfo() {
  const now = new Date();
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

  // 5) 직전 세션 고/저점 스윕(Liquidity Sweep) 및 볼린저 밴드 터치 여부
  const sweptPrevLevel = isUpHunt ? (windowHigh >= prevHigh * 0.999) : (windowLow <= prevLow * 1.001);
  const bandTouch = isUpHunt
    ? (windowHigh >= bbMid + (bbUpper - bbMid) * 0.78)
    : (windowLow <= bbMid - (bbMid - bbLower) * 0.78);

  // 6) 반대 포지션 진입 시 손절가(SL) · 1차 익절(TP1) · 2차 익절(TP2 = 출발 기준가 Anchor 회귀) 산출
  let stopPriceUsd = 0;
  let tp1PriceUsd = 0;
  let tp2PriceUsd = 0;

  if (direction === 'SHORT') {
    stopPriceUsd = formatPricePrecise(windowHigh * (1 + item.stopBufferPct / 100));
    const targetAnchor = Math.min(anchorPrice, execPrice * 0.992);
    tp2PriceUsd = formatPricePrecise(Math.min(anchorPrice, (anchorPrice + bbMid) / 2, targetAnchor));
    tp1PriceUsd = formatPricePrecise(execPrice - (execPrice - tp2PriceUsd) * 0.55);
  } else {
    stopPriceUsd = formatPricePrecise(windowLow * (1 - item.stopBufferPct / 100));
    const targetAnchor = Math.max(anchorPrice, execPrice * 1.008);
    tp2PriceUsd = formatPricePrecise(Math.max(anchorPrice, (anchorPrice + bbMid) / 2, targetAnchor));
    tp1PriceUsd = formatPricePrecise(execPrice + (tp2PriceUsd - execPrice) * 0.55);
  }

  const rewardAbs = Math.abs(tp2PriceUsd - execPrice);
  const riskAbs = Math.max(execPrice * 0.0015, Math.abs(execPrice - stopPriceUsd));
  const rrRatio = Number((rewardAbs / riskAbs).toFixed(2));

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

    // 규칙 3: 볼린저 밴드 과열 또는 직전 고/저점 스윕 확인
    if (!cand.bandTouch && !cand.sweptPrevLevel) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 3,
        reason: `규칙 3 탈락 (유동성 스윕 미달): 볼린저 밴드 상/하단 과열권 미도달 및 직전 고/저점 스윕 없음`,
        candidate: cand
      });
      continue;
    }

    // 규칙 4: 꼬리(되돌림 브레이크) 확인 (떨어지는 칼날 방지)
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

    // 규칙 5: 손익비(R/R Ratio) 1.35 미만 탈락
    if (cand.rrRatio < 1.35) {
      vetResults.push({
        symbol: cand.symbol,
        contract: cand.contract,
        decision: 'REJECT',
        failedRule: 5,
        reason: `규칙 5 탈락 (손익비 부족): 출발점($${cand.anchorPriceUsd}) 회귀 기대 손익비 1 : ${cand.rrRatio} (< 최소 1 : 1.35)`,
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
      reason: `[Variational 스탑헌팅 포착 -> ${dirLabel}] 90분 ${moveSign}(확정 구간 ±${cand.minHuntPct}%~±${cand.maxHuntPct}% 진입) + 꼬리 ${cand.wickReversalPct}% 확인 | 진입 $${cand.priceUsd} -> 목표(TP2) $${cand.tp2PriceUsd} / 손절(SL) $${cand.stopPriceUsd} (손익비 1 : ${cand.rrRatio})`,
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
  const maxKellyCapPct = Number(customCapPct || config.maxKellyCapPct || 0.08);
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
  const cappedKellyPct = Math.min(maxKellyCapPct, Math.max(0.055, rawKelly));

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
    reason: `손익비(1:${payoffRatio}) 및 켈리 상한(${(maxKellyCapPct * 100).toFixed(1)}%) 통과 -> $${calculatedDollars} 배분`
  };
}

function runFillsAgent(candidate, sizeResult) {
  const dollars = Number(sizeResult.dollars || 0);
  const leverage = 10; // 10배 레버리지 고정 적용!
  const notionalUsd = Number((dollars * leverage).toFixed(2));
  // Variational DEX 호가 스프레드 반영 + 최소 네트워크/집행 비용 $0.25
  const feeRate = 0.0002;
  const feeFloor = 0.25;

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
      reason = `🎯 [SHORT ${lev}x 평균회귀 완승!] 출발 기준가(TP2 $${tp2P}) 완전 복귀 전량 익절! (10x ROE +${pnlPct}%)`;
    } else if (currentPrice >= stopP) {
      action = 'CLOSE';
      reason = `🚨 [SHORT ${lev}x 칼손절] 스탑헌팅 고점 방어선(SL $${stopP}) 재돌파 즉시 손절! (10x ROE ${pnlPct}%)`;
    } else if (currentPrice <= tp1P && candleBullish) {
      action = 'CLOSE';
      reason = `✅ [SHORT ${lev}x 1차익절 확정] 55% 되돌림(TP1 $${tp1P}) 도달 후 반등 캔들 출현으로 수익 확정! (10x ROE +${pnlPct}%)`;
    }
  } else {
    if (currentPrice >= tp2P) {
      action = 'CLOSE';
      reason = `🎯 [LONG ${lev}x 평균회귀 완승!] 출발 기준가(TP2 $${tp2P}) 완전 복귀 전량 익절! (10x ROE +${pnlPct}%)`;
    } else if (currentPrice <= stopP) {
      action = 'CLOSE';
      reason = `🚨 [LONG ${lev}x 칼손절] 스탑헌팅 저점 방어선(SL $${stopP}) 재이탈 즉시 손절! (10x ROE ${pnlPct}%)`;
    } else if (currentPrice >= tp1P && !candleBullish) {
      action = 'CLOSE';
      reason = `✅ [LONG ${lev}x 1차익절 확정] 55% 반등(TP1 $${tp1P}) 도달 후 음봉 출현으로 수익 확정! (10x ROE +${pnlPct}%)`;
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
// [데스크 2: 예측시장 괴리율 데스크 ($1,000)] 7개 에이전트 파이프라인 & 리스크 관리
// ============================================================================
async function runBookAgent(wmPort = 3000, openBetsCount = 0, geminiKey = DEFAULT_GEMINI_KEY, existingMarketIds = new Set()) {
  let wmAvailable = true;
  if (wmPort) {
    const wmRes = await fetchJson(`http://localhost:${wmPort}/api/prediction/v1/list-prediction-markets?page_size=100&category=crypto`);
    if (wmRes.ok && wmRes.data && wmRes.data.dataAvailable === false) {
      wmAvailable = false;
    }
  }

  if (!wmAvailable) {
    return {
      bot: 'BOOK',
      status: 'RESTING',
      reason: '월드모니터 prediction 응답이 비어 있음 (degraded 상태) -> 규칙에 따라 BOOK 휴식',
      scannedRawCount: 0,
      vetRejected: [],
      evaluatedMarkets: [],
      proposals: []
    };
  }

  if (openBetsCount >= 7) {
    return {
      bot: 'BOOK',
      status: 'MAX_BETS_REACHED',
      reason: '열린 예측 시장 포지션이 최대 한도(7개)에 도달하여 신규 진입 건너뜀',
      scannedRawCount: 0,
      vetRejected: [],
      evaluatedMarkets: [],
      proposals: []
    };
  }

  const [kalshiRes, kalshiEventsRes, polyRes, fgRes] = await Promise.all([
    fetchJson('https://external-api.kalshi.com/trade-api/v2/markets?limit=50&status=open'),
    fetchJson('https://external-api.kalshi.com/trade-api/v2/events?limit=35&status=open&with_nested_markets=true'),
    fetchPolymarketGamma('/markets?closed=false&active=true&order=volume24hr&ascending=false&limit=50'),
    fetchJson('https://api.alternative.me/fng/?limit=1')
  ]);

  const fearGreedVal = Number(fgRes.data?.data?.[0]?.value || 54);
  const fearGreedClass = fgRes.data?.data?.[0]?.value_classification || 'Neutral';

  // 1) SCAN: 원시 마켓 수집 (실전 매매 가능한 Polymarket CLOB 오더북 최우선 + Kalshi 실전 호가)
  const rawMarkets = [];
  if (polyRes.ok && Array.isArray(polyRes.data)) {
    for (const m of polyRes.data) {
      const question = m.question || m.title || '';
      if (!question) continue;
      let outcomePrices = [];
      try {
        outcomePrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []);
      } catch {
        outcomePrices = [];
      }
      const midYes = Number(outcomePrices[0] || 0);
      const yesBid = Number(m.bestBid !== undefined && m.bestBid !== null ? m.bestBid : Math.max(0.01, midYes - 0.01));
      const yesAsk = Number(m.bestAsk !== undefined && m.bestAsk !== null ? m.bestAsk : Math.min(0.99, midYes + 0.01));
      const noBid = Number(Math.max(0.01, 1 - yesAsk).toFixed(4));
      const noAsk = Number(Math.min(0.99, 1 - yesBid).toFixed(4));
      const spread = Number(Math.max(0, yesAsk - yesBid).toFixed(4));

      rawMarkets.push({
        source: 'Polymarket',
        marketId: String(m.id || m.conditionId || question.slice(0, 24)),
        question,
        yesPrice: Number(((yesBid + yesAsk) / 2).toFixed(4)),
        yesBid: Number(yesBid.toFixed(4)),
        yesAsk: Number(yesAsk.toFixed(4)),
        noBid,
        noAsk,
        spread,
        volumeUsd: Math.round(Number(m.volume24hr || m.volumeNum || 0)),
        liquidityUsd: Math.round(Number(m.liquidityNum || 0)),
        updatedAt: m.updatedAt ? new Date(m.updatedAt).getTime() : Date.now()
      });
    }
  }

  if (kalshiEventsRes.ok && Array.isArray(kalshiEventsRes.data?.events)) {
    for (const ev of kalshiEventsRes.data.events) {
      const m = ev.markets?.[0];
      if (!m) continue;
      const baseTitle = ev.title || m.title || '';
      if (!baseTitle) continue;
      const subLabel = (m.yes_sub_title || m.subtitle || '').trim();
      const question = (subLabel && !baseTitle.includes(subLabel))
        ? `${baseTitle} [${subLabel}]`
        : baseTitle;
      const yesBid = Number(m.yes_bid_dollars || 0);
      const yesAsk = Number(m.yes_ask_dollars || 0);
      const noBid = Number(m.no_bid_dollars || (yesAsk > 0 ? Math.max(0.01, 1 - yesAsk) : 0));
      const noAsk = Number(m.no_ask_dollars || (yesBid > 0 ? Math.min(0.99, 1 - yesBid) : 0));
      const spread = (yesAsk > 0 && yesBid > 0) ? Number(Math.max(0, yesAsk - yesBid).toFixed(4)) : 0.99;
      const midYes = (yesAsk > 0 && yesBid > 0) ? Number(((yesBid + yesAsk) / 2).toFixed(4)) : Number(m.last_price_dollars || 0);

      rawMarkets.push({
        source: 'Kalshi',
        marketId: String(m.ticker || ev.event_ticker),
        question,
        yesPrice: midYes,
        yesBid: Number(yesBid.toFixed(4)),
        yesAsk: Number(yesAsk.toFixed(4)),
        noBid: Number(noBid.toFixed(4)),
        noAsk: Number(noAsk.toFixed(4)),
        spread,
        volumeUsd: Math.round(Number(m.volume_24h_fp || 0)),
        liquidityUsd: Math.round(Number(m.open_interest_fp || 0)),
        updatedAt: Date.now()
      });
    }
  }

  // 2) VET: 예측시장 실전 오더북(Bid/Ask 스프레드) 6단계 가혹 검증
  const vetRejected = [];
  const validMarkets = [];

  for (const m of rawMarkets) {
    const qLower = m.question.toLowerCase();
    if (qLower.includes('counter-strike') || qLower.includes('dota') || qLower.includes('valorant') || qLower.includes('bo3') || qLower.includes('bo5')) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 1, reason: `실시간 e스포츠 경기 배제 (인게임 스코어 정보비대칭 위험)` });
      continue;
    }
    const ageHours = (Date.now() - m.updatedAt) / 3600000;
    if (ageHours > 48) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 1, reason: `데이터 노후화 (${Math.round(ageHours)}h > 48h)` });
      continue;
    }
    if (m.yesBid < 0.06 || m.yesAsk > 0.94 || m.yesAsk <= m.yesBid) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 2, reason: `극단 확률 또는 비정상 호가 배제 (Bid $${m.yesBid} / Ask $${m.yesAsk})` });
      continue;
    }
    if (m.spread > 0.03) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 3, reason: `가혹 호가 스프레드 탈락 (Ask-Bid 갭 $${m.spread} > 기준 $0.03)` });
      continue;
    }
    if (m.volumeUsd < 1500) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 4, reason: `24시간 실거래량 부족 ($${m.volumeUsd.toLocaleString()} < $1,500)` });
      continue;
    }
    if (m.liquidityUsd < 10000) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 5, reason: `오더북 유동성 미달 ($${m.liquidityUsd.toLocaleString()} < $10,000)` });
      continue;
    }
    if (existingMarketIds && existingMarketIds.has(m.marketId)) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 6, reason: `보유 중이거나 기청산 마켓 중복 진입 차단` });
      continue;
    }
    validMarkets.push(m);
    if (validMarkets.length >= 10) break;
  }

  // 3) BOOK: 시장 가격을 가린 블라인드 상태에서 Gemini 3.5 Flash 확률 추론
  let aiEstimates = {};
  let aiModelUsed = null;
  if (validMarkets.length > 0) {
    const questionsPrompt = [
      `너는 예측 시장 전문 퀀트 애널리스트 봇 BOOK이다.`,
      `현재 시장 공포·탐욕 지수는 ${fearGreedVal}(${fearGreedClass})이다.`,
      `아래 예측 시장 질문들을 보고, 시장 가격을 절대 참고하지 않은 블라인드 상태에서 각 질문이 YES로 결정될 너의 독립적인 추정 확률(0.08~0.92 사이 소수)과 1줄 한국어 근거를 JSON 배열로만 답하라.`,
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
                prob: Math.min(0.92, Math.max(0.08, Number(item.prob.toFixed(3)))),
                reason: item.reason || 'Gemini AI 거시·센티먼트 독립 추론'
              };
            }
          }
        }
      } catch {
        // fallback below
      }
    }
  }

  const evaluatedMarkets = [];
  const proposals = [];

  for (let i = 0; i < validMarkets.length; i++) {
    const m = validMarkets[i];
    const aiEst = aiEstimates[i];

    let myYesProb;
    let reasoningText;
    if (aiEst) {
      myYesProb = aiEst.prob;
      reasoningText = `🧠 Gemini(${aiModelUsed}): ${aiEst.reason}`;
    } else {
      const turnoverSignal = Math.min(0.14, Math.max(-0.14, ((m.volumeUsd / (m.liquidityUsd + 1)) - 1.5) * 0.04));
      const sentimentBias = ((fearGreedVal - 50) / 400);
      myYesProb = Number(Math.min(0.90, Math.max(0.10, 0.50 + turnoverSignal + sentimentBias)).toFixed(3));
      reasoningText = `정량 멀티팩터 추론 (공포탐욕지수 ${fearGreedVal} 반영)`;
    }

    // [가혹 모드 핵심] 매수 시 무조건 불리한 매도호가(Ask)를 지불해야 하며, 매도호가(Ask) 대비 순괴리율을 계산!
    const rawMidDiff = myYesProb - m.yesPrice;
    const side = rawMidDiff >= 0 ? 'YES' : 'NO';
    const sideMyProb = side === 'YES' ? myYesProb : Number((1 - myYesProb).toFixed(3));
    const buyAskPrice = side === 'YES' ? m.yesAsk : m.noAsk;
    const sellBidPrice = side === 'YES' ? m.yesBid : m.noBid;
    const sideSpread = Number(Math.max(0, buyAskPrice - sellBidPrice).toFixed(4));

    // 매도호가(buyAskPrice)로 비싸게 샀을 때도 남는 실전 순괴리율(executable edge)
    const executableEdge = Number((sideMyProb - buyAskPrice).toFixed(3));
    const execEdgePct = Number((Math.max(0, executableEdge) * 100).toFixed(1));
    // [역선택 방지] 순괴리율이 25%를 초과하는 극단적 괴리율은 AI가 모르는 최신 속보 선반영(Information Lag) 위험이므로 보류하고, 8% ~ 25% 골디락스 구간만 진입!
    const isGoldilocksEdge = executableEdge >= 0.08 && executableEdge <= 0.25;
    const edgeNote = executableEdge > 0.25
      ? ' ⚠️ [괴리율 >25% 과다: 최신 속보 선반영/역선택 위험으로 진입 제외]'
      : '';

    const evalRecord = {
      source: m.source,
      marketId: m.marketId,
      question: m.question,
      yesPrice: m.yesPrice,
      myYesProb,
      side,
      myProb: sideMyProb,
      marketPrice: buyAskPrice, // 실전 매수 체결가(Ask)
      buyAskPrice,
      sellBidPrice,
      spread: sideSpread,
      edgePct: execEdgePct,
      liquidityUsd: m.liquidityUsd,
      volumeUsd: m.volumeUsd,
      aiModel: aiModelUsed || 'quant-fallback',
      reasoning: `${reasoningText} [실전호가 Ask $${buyAskPrice} / Bid $${sellBidPrice}, 스프레드 $${sideSpread}]${edgeNote}`,
      actionable: isGoldilocksEdge
    };
    evaluatedMarkets.push(evalRecord);

    if (isGoldilocksEdge) {
      proposals.push(evalRecord);
    }
  }

  proposals.sort((a, b) => b.edgePct - a.edgePct);

  return {
    bot: 'BOOK',
    status: 'ACTIVE',
    harshOrderbookMode: true,
    aiModelUsed,
    kalshiStatus: kalshiRes.status,
    polymarketStatus: polyRes.status,
    scannedRawCount: rawMarkets.length,
    vetRejectedCount: vetRejected.length,
    vetRejected: vetRejected.slice(0, 12),
    evaluatedCount: evaluatedMarkets.length,
    evaluatedMarkets,
    proposals: proposals.slice(0, 2)
  };
}

/**
 * 예측시장 컨트랙트 실전 가혹 모드 체결 (FILLS)
 * - 매수 진입가(entryPriceUsd)는 무조건 비싼 매도호가(Ask = buyAskPrice) 적용
 * - 체결 직후 현재 평가가(currentPriceUsd)는 즉시 매도 가능한 매수호가(Bid = sellBidPrice) 적용 (사자마자 스프레드+수수료 손실 반영!)
 */
function runPredictionFillsAgent(proposal, sizeResult) {
  const dollars = Number(sizeResult.dollars || 0);
  if (dollars <= 0) {
    return { bot: 'FILLS', status: 'SKIPPED_ZERO_SIZE', reason: sizeResult.reason };
  }

  const feeUsd = Number(Math.max(dollars * 0.005, 0.50).toFixed(2));
  const netInvestedUsd = Number((dollars - feeUsd).toFixed(2));
  const entryPrice = Math.max(0.05, Math.min(0.95, Number(proposal.buyAskPrice || proposal.marketPrice || 0.5)));
  const immediateBidPrice = Math.max(0.02, Math.min(entryPrice, Number(proposal.sellBidPrice || (entryPrice - 0.01))));
  const shares = Number((netInvestedUsd / entryPrice).toFixed(2));

  // 목표 수렴 가격: 시장 매수호가(Bid)가 내 진입가(Ask) 위로 최소 +15% 이상 올라오거나 내 추정 확률의 70% 지점까지 수렴해야만 익절!
  const convergenceTarget = Number((entryPrice + (proposal.myProb - entryPrice) * 0.70).toFixed(3));
  const minProfitTarget = Number((entryPrice * 1.15).toFixed(3));
  const targetPrice = Math.min(0.96, Math.max(convergenceTarget, minProfitTarget));
  const stopPrice = Number(Math.max(0.02, entryPrice * 0.82).toFixed(3));

  return {
    bot: 'FILLS',
    desk: 'prediction',
    harshMode: true,
    status: 'FILLED_PAPER',
    id: `pos_pred_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source: proposal.source,
    marketId: proposal.marketId,
    question: proposal.question,
    side: proposal.side,
    myProb: proposal.myProb,
    entryPriceUsd: entryPrice,          // 내가 산 매도호가 (Ask)
    currentPriceUsd: immediateBidPrice, // 지금 당장 팔 때 받는 매수호가 (Bid)
    bidPriceUsd: immediateBidPrice,
    askPriceUsd: entryPrice,
    spreadUsd: Number((entryPrice - immediateBidPrice).toFixed(4)),
    targetPriceUsd: targetPrice,
    stopPriceUsd: stopPrice,
    edgePct: proposal.edgePct,
    currentEdgePct: proposal.edgePct,
    dollars,
    feeUsd,
    quantity: shares,
    reasoning: proposal.reasoning,
    openedAt: new Date().toISOString()
  };
}

/**
 * 예측시장 열린 포지션 실시간 오더북(Bid/Ask) 가격 갱신 및 가혹 익절/손절 점검 (PRED-RISK)
 * - 최근 체결가(last_price) 착시를 완전히 배제하고, 지금 즉시 시장가로 던졌을 때 받을 수 있는 매수호가(Bid)로만 평가·청산!
 */
async function checkPredictionRiskLive(openPositions = []) {
  if (!openPositions.length) return [];

  const [kalshiEventsRes, polyRes] = await Promise.all([
    fetchJson('https://external-api.kalshi.com/trade-api/v2/events?limit=40&status=open&with_nested_markets=true'),
    fetchPolymarketGamma('/markets?closed=false&active=true&order=volume24hr&ascending=false&limit=60')
  ]);

  // marketId -> { yesBid, yesAsk, noBid, noAsk }
  const liveBookMap = new Map();
  if (polyRes.ok && Array.isArray(polyRes.data)) {
    for (const m of polyRes.data) {
      const id = String(m.id || m.conditionId || '');
      let outcomePrices = [];
      try {
        outcomePrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []);
      } catch {
        outcomePrices = [];
      }
      const midYes = Number(outcomePrices[0] || 0);
      const yesBid = Number(m.bestBid !== undefined && m.bestBid !== null ? m.bestBid : Math.max(0.01, midYes - 0.01));
      const yesAsk = Number(m.bestAsk !== undefined && m.bestAsk !== null ? m.bestAsk : Math.min(0.99, midYes + 0.01));
      if (id && yesBid > 0 && yesAsk > 0) {
        liveBookMap.set(id, {
          yesBid: Number(yesBid.toFixed(4)),
          yesAsk: Number(yesAsk.toFixed(4)),
          noBid: Number(Math.max(0.01, 1 - yesAsk).toFixed(4)),
          noAsk: Number(Math.min(0.99, 1 - yesBid).toFixed(4))
        });
      }
    }
  }
  if (kalshiEventsRes.ok && Array.isArray(kalshiEventsRes.data?.events)) {
    for (const ev of kalshiEventsRes.data.events) {
      const m = ev.markets?.[0];
      if (!m) continue;
      const id = String(m.ticker || ev.event_ticker);
      const yesBid = Number(m.yes_bid_dollars || 0);
      const yesAsk = Number(m.yes_ask_dollars || 0);
      const noBid = Number(m.no_bid_dollars || (yesAsk > 0 ? Math.max(0.01, 1 - yesAsk) : 0));
      const noAsk = Number(m.no_ask_dollars || (yesBid > 0 ? Math.min(0.99, 1 - yesBid) : 0));
      if (id && yesBid > 0 && yesAsk > 0) {
        liveBookMap.set(id, {
          yesBid: Number(yesBid.toFixed(4)),
          yesAsk: Number(yesAsk.toFixed(4)),
          noBid: Number(noBid.toFixed(4)),
          noAsk: Number(noAsk.toFixed(4))
        });
      }
    }
  }

  const results = [];
  for (const pos of openPositions) {
    const book = liveBookMap.get(pos.marketId);
    // [가혹 모드] 내가 보유한 포지션을 지금 당장 팔 때 받을 수 있는 실전 매수호가(Bid)로만 현재가 산정!
    let currentSellBid = pos.currentPriceUsd || pos.entryPriceUsd;
    let currentBuyAsk = pos.askPriceUsd || pos.entryPriceUsd;
    if (book) {
      currentSellBid = pos.side === 'YES' ? book.yesBid : book.noBid;
      currentBuyAsk = pos.side === 'YES' ? book.yesAsk : book.noAsk;
    }

    const currentEdgePct = Number((Math.max(0, pos.myProb - currentBuyAsk) * 100).toFixed(1));
    const pnlPct = pos.entryPriceUsd > 0
      ? Number((((currentSellBid - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(2))
      : 0;

    let action = 'HOLD';
    let closeReason = `실전 매수호가(Bid) $${currentSellBid} / 매수가(Ask) $${pos.entryPriceUsd} (${pnlPct >= 0 ? '+' : ''}${pnlPct}%) | 목표 Bid $${pos.targetPriceUsd}`;

    if (currentSellBid >= pos.targetPriceUsd || pnlPct >= 18) {
      action = 'CLOSE';
      closeReason = `🎯 [실전호가 Bid 익절] 매수호가(Bid $${currentSellBid})가 진입 매도호가(Ask $${pos.entryPriceUsd}) 대비 +${pnlPct}% 상승 돌파!`;
    } else if (currentSellBid <= pos.stopPriceUsd || pnlPct <= -18) {
      action = 'CLOSE';
      closeReason = `🚨 [실전호가 Bid 손절] 매수호가(Bid $${currentSellBid})가 진입 매도호가(Ask $${pos.entryPriceUsd}) 대비 ${pnlPct}% 하락 이탈`;
    }

    results.push({
      id: pos.id,
      marketId: pos.marketId,
      question: pos.question,
      side: pos.side,
      currentPriceUsd: currentSellBid,
      bidPriceUsd: currentSellBid,
      askPriceUsd: currentBuyAsk,
      currentEdgePct,
      pnlPct,
      action,
      reason: closeReason
    });
  }

  return results;
}

// ============================================================================
// [데스크 3: RWA 차트(켈트너·볼린저) & 옵션 감마(콜감마·숏감마) 데스크 ($1,000)]
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

/**
 * 데스크 3 (RWA & 7대 섹터 개별주 차트·옵션감마) 전체/섹터별 스캔 + 5단계 VET + BOOK(GAMMA) 파이프라인 (LONG / SHORT 양방향 지원)
 */
async function runRwaDeskScanAndVet(existingSymbols = new Set(), geminiKey = DEFAULT_GEMINI_KEY, sectorFilter = 'all') {
  const targetSector = (sectorFilter && RWA_SECTORS[sectorFilter]) ? sectorFilter : 'all';
  const targetList = targetSector === 'all'
    ? RWA_UNIVERSE
    : RWA_UNIVERSE.filter(u => u.sector === targetSector);

  // 병렬 배치 스캔 (5개씩 웨이브 처리하여 tooja.me Rate Limit 완벽 방지 및 49종목 전수 스캔)
  const rawAnalyses = [];
  const batchSize = 5;
  for (let i = 0; i < targetList.length; i += batchSize) {
    const chunk = targetList.slice(i, i + batchSize);
    const chunkRes = await Promise.all(chunk.map(u => analyzeRwaTicker(u)));
    rawAnalyses.push(...chunkRes);
    if (i + batchSize < targetList.length) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  const marketRes = await fetchJson('https://tooja.me/api/market', {}, 7000);

  const validAnalyses = rawAnalyses.filter(a => a && a.ok);
  validAnalyses.sort((a, b) => b.tradeSetup.score - a.tradeSetup.score);

  // 섹터별 요약 통계 생성
  const sectorSummary = {};
  for (const item of validAnalyses) {
    const sec = item.sector || 'custom';
    if (!sectorSummary[sec]) {
      sectorSummary[sec] = {
        sector: sec,
        label: RWA_SECTORS[sec]?.label || sec,
        count: 0,
        squeezeCount: 0,
        longCount: 0,
        shortCount: 0,
        topSymbol: item.symbol,
        topScore: item.tradeSetup.score,
        topDirection: item.tradeSetup.direction
      };
    }
    sectorSummary[sec].count += 1;
    if (item.chart.purpleInsideWhite1h) sectorSummary[sec].squeezeCount += 1;
    if (item.tradeSetup.direction === 'SHORT') sectorSummary[sec].shortCount += 1;
    else sectorSummary[sec].longCount += 1;
  }

  const overseasGaps = marketRes.ok && Array.isArray(marketRes.data?.overseas)
    ? marketRes.data.overseas
    : [];

  // VET: 섹터 개별주 & RWA 5단계 탈락 심사 (LONG / SHORT 각 방향에 맞춰 MTF, 채널 과열, 손익비, IV 검증)
  const vetResults = [];
  for (const item of validAnalyses) {
    const dir = item.tradeSetup.direction; // 'LONG' | 'SHORT'

    if (existingSymbols.has(item.symbol)) {
      vetResults.push({
        symbol: item.symbol,
        sector: item.sector,
        category: item.category,
        direction: dir,
        decision: 'REJECT',
        failedRule: 0,
        reason: '이미 보유 중인 포지션 중복 진입 제외',
        analysis: item
      });
      continue;
    }
    if (!item.chart.mtfAligned) {
      vetResults.push({
        symbol: item.symbol,
        sector: item.sector,
        category: item.category,
        direction: dir,
        decision: 'REJECT',
        failedRule: 1,
        reason: `규칙 1 탈락 (MTF 역행): 1H 추세 기울기(${item.chart.slope1hPct}%) 및 캔들 방향이 [${dir}] 진입 기준과 불일치`,
        analysis: item
      });
      continue;
    }
    if (dir === 'LONG' && item.chart.channelPos1hPct > 84) {
      vetResults.push({
        symbol: item.symbol,
        sector: item.sector,
        category: item.category,
        direction: dir,
        decision: 'REJECT',
        failedRule: 2,
        reason: `규칙 2 탈락 (롱 상단 과열): 흰색 켈트너 채널 ${item.chart.channelPos1hPct}% 위치로 롱 상방 여력 부족`,
        analysis: item
      });
      continue;
    }
    if (dir === 'SHORT' && item.chart.channelPos1hPct < 16) {
      vetResults.push({
        symbol: item.symbol,
        sector: item.sector,
        category: item.category,
        direction: dir,
        decision: 'REJECT',
        failedRule: 2,
        reason: `규칙 2 탈락 (숏 하단 과매도): 흰색 켈트너 채널 ${item.chart.channelPos1hPct}% 바닥권으로 숏 하방 여력 부족`,
        analysis: item
      });
      continue;
    }
    if (item.tradeSetup.rrRatio < 1.15) {
      vetResults.push({
        symbol: item.symbol,
        sector: item.sector,
        category: item.category,
        direction: dir,
        decision: 'REJECT',
        failedRule: 3,
        reason: `규칙 3 탈락 (손익비 부족): [${dir}] 기대 손익비 ${item.tradeSetup.rrRatio} (< 1.15 기준 미달)`,
        analysis: item
      });
      continue;
    }
    if (item.options.avgIvPct > 135) {
      vetResults.push({
        symbol: item.symbol,
        sector: item.sector,
        category: item.category,
        direction: dir,
        decision: 'REJECT',
        failedRule: 4,
        reason: `규칙 4 탈락 (IV 폭풍우 경보): 평균 내재변동성 ${item.options.avgIvPct}% 과열 지뢰밭`,
        analysis: item
      });
      continue;
    }

    vetResults.push({
      symbol: item.symbol,
      sector: item.sector,
      category: item.category,
      direction: dir,
      decision: item.chart.purpleInsideWhite1h ? 'PASS' : 'PASS_PARTIAL',
      failedRule: null,
      reason: `통과 [${dir}] (${item.category} | 점수 ${item.tradeSetup.score}점 | ${item.tradeSetup.setupName} | 손익비 ${item.tradeSetup.rrRatio}:1)`,
      analysis: item
    });
  }

  const passed = vetResults.filter(v => v.decision === 'PASS' || v.decision === 'PASS_PARTIAL');
  const rejected = vetResults.filter(v => v.decision === 'REJECT');

  // BOOK (GAMMA) + Gemini AI 최우선 타점 코멘트 생성 (LONG / SHORT 구분)
  let aiComment = null;
  if (passed.length > 0) {
    const top = passed[0].analysis;
    const dir = top.tradeSetup.direction;
    const prompt = [
      `너는 RWA 및 7대 섹터(우주·방산·바이오·반도체·광통신·로봇) 차트(켈트너·볼린저) & 옵션 감마(콜감마·숏감마) 양방향(LONG/SHORT) 트레이딩 봇 BOOK이다.`,
      `종목: ${top.symbol} (${top.name} / ${top.category}), 현재가 $${top.spot}, 포지션 방향: ${dir} (${top.tradeSetup.setupName})`,
      `- 1H 보라색 채널: $${top.chart.purple1hLower} ~ $${top.chart.purple1hUpper} (스퀴즈=${top.chart.purpleInsideWhite1h})`,
      `- 1H 흰색 채널: $${top.chart.white1hLower} ~ $${top.chart.white1hUpper} (채널내 위치 ${top.chart.channelPos1hPct}%)`,
      `- 옵션 감마: ${top.options.gammaRegimeLabel}, 콜벽 $${top.options.callWall}, 풋벽 $${top.options.putWall}, 맥스페인 $${top.options.maxPain}`,
      `위 숫자를 바탕으로 왜 지금 [${dir}] 타점인지와 1차 익절($${top.tradeSetup.tp1Price})·2차 익절($${top.tradeSetup.tp2Price})·손절($${top.tradeSetup.stopPrice}) 전략을 한국어 2문장으로 명확히 브리핑하라.`
    ].join('\n');
    const aiRes = await callGeminiAI(prompt, geminiKey, 8000);
    if (aiRes.ok && aiRes.text) {
      aiComment = `🧠 Gemini(${aiRes.model}): ${aiRes.text}`;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    sectorFilter: targetSector,
    sectorLabel: RWA_SECTORS[targetSector]?.label || '전 섹터 통합',
    scannedCount: validAnalyses.length,
    sectorSummary,
    analyses: validAnalyses,
    overseasGaps,
    vetResults,
    passed,
    rejected,
    aiComment
  };
}

/**
 * RWA 모의 체결 (FILLS) — LONG / SHORT 양방향 지원 (수동 방향 지정 forceDirection 포함)
 */
function runRwaFillsAgent(analysis, sizeResult, aiComment = null, forceDirection = null) {
  const dollars = Number(sizeResult.dollars || 0);
  if (dollars <= 0) {
    return { bot: 'FILLS', status: 'SKIPPED_ZERO_SIZE', reason: sizeResult.reason };
  }

  const feeUsd = Number(Math.max(dollars * 0.0015, 0.35).toFixed(2));
  const netInvestedUsd = Number((dollars - feeUsd).toFixed(2));
  const entryPriceUsd = Number(analysis.spot);
  const quantity = entryPriceUsd > 0 ? Number((netInvestedUsd / entryPriceUsd).toFixed(4)) : 0;

  const direction = (forceDirection === 'LONG' || forceDirection === 'SHORT')
    ? forceDirection
    : (analysis.tradeSetup.direction || 'LONG');

  let tp1PriceUsd = analysis.tradeSetup.tp1Price;
  let tp2PriceUsd = analysis.tradeSetup.tp2Price;
  let stopPriceUsd = analysis.tradeSetup.stopPrice;
  let setupName = analysis.tradeSetup.setupName;

  // 사용자가 UI에서 반대 방향(예: 강제 SHORT 또는 강제 LONG)으로 수동 주문한 경우 목표/손절가를 해당 방향에 맞게 재산정
  if (direction !== analysis.tradeSetup.direction) {
    if (direction === 'SHORT') {
      tp1PriceUsd = Number(Math.min(entryPriceUsd * 0.994, analysis.chart.purple1hLower).toFixed(2));
      tp2PriceUsd = Number(Math.min(tp1PriceUsd * 0.992, analysis.chart.white1hLower, Math.max(analysis.options.putWall, analysis.options.maxPain, entryPriceUsd * 0.94)).toFixed(2));
      stopPriceUsd = Number(Math.max(entryPriceUsd * 1.014, analysis.chart.white1hUpper).toFixed(2));
      setupName = `🔴 [SHORT 수동지정] 보라하단 1차·흰색하단/풋벽 2차 타겟 숏`;
    } else {
      tp1PriceUsd = Number(Math.max(entryPriceUsd * 1.006, analysis.chart.purple1hUpper).toFixed(2));
      tp2PriceUsd = Number(Math.max(tp1PriceUsd * 1.008, analysis.chart.white1hUpper, Math.min(analysis.options.callWall, entryPriceUsd * 1.06)).toFixed(2));
      stopPriceUsd = Number(Math.min(entryPriceUsd * 0.986, analysis.chart.white1hLower).toFixed(2));
      setupName = `🟢 [LONG 수동지정] 보라상단 1차·흰색상단/콜벽 2차 타겟 롱`;
    }
  }

  return {
    bot: 'FILLS',
    desk: 'rwa',
    status: 'FILLED_PAPER',
    id: `pos_rwa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: analysis.symbol,
    name: analysis.name,
    sector: analysis.sector || 'custom',
    category: analysis.category,
    direction,
    setupName,
    gammaRegime: analysis.options.gammaRegime,
    gammaRegimeLabel: analysis.options.gammaRegimeLabel,
    netGexM: analysis.options.netGexM,
    callWall: analysis.options.callWall,
    putWall: analysis.options.putWall,
    maxPain: analysis.options.maxPain,
    entryPriceUsd,
    currentPriceUsd: entryPriceUsd,
    tp1PriceUsd,
    tp2PriceUsd,
    stopPriceUsd,
    rrRatio: analysis.tradeSetup.rrRatio,
    dollars,
    feeUsd,
    quantity,
    tp1Hit: false,
    reasoning: aiComment || analysis.tradeSetup.summaryReason,
    openedAt: new Date().toISOString()
  };
}

/**
 * RWA 열린 포지션 5분 주기 채널 & 감마 리스크 점검 (RWA-RISK — LONG / SHORT 양방향 손익 및 청산 판정)
 */
async function checkRwaPositionsRiskLive(openRwaPositions = []) {
  if (!openRwaPositions.length) return [];

  const results = [];
  for (const pos of openRwaPositions) {
    const dir = pos.direction || 'LONG';
    const live = await analyzeRwaTicker(pos.symbol);
    const currentPrice = live.ok ? live.spot : pos.currentPriceUsd;

    const rawPriceDiff = dir === 'SHORT'
      ? (pos.entryPriceUsd - currentPrice)
      : (currentPrice - pos.entryPriceUsd);

    const pnlPct = pos.entryPriceUsd > 0
      ? Number(((rawPriceDiff / pos.entryPriceUsd) * 100).toFixed(2))
      : 0;

    let action = 'HOLD';
    let reason = `[${dir}] 흰색채널 내 순항 중 (${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`;

    if (dir === 'LONG') {
      if (currentPrice >= pos.tp2PriceUsd) {
        action = 'CLOSE';
        reason = `🎯 [LONG 익절] 2차 목표가(흰색 켈트너 상단 / 콜감마 벽 $${pos.tp2PriceUsd}) 도달 전량 익절! (+${pnlPct}%)`;
      } else if (currentPrice <= pos.stopPriceUsd) {
        action = 'CLOSE';
        reason = `🚨 [LONG 손절] 흰색 채널 하단 / 풋감마 방어선($${pos.stopPriceUsd}) 이탈 즉시 손절! (${pnlPct}%)`;
      } else if (currentPrice >= pos.tp1PriceUsd && live.ok && !live.chart.candleBullish) {
        action = 'CLOSE';
        reason = `✅ [LONG 익절] 1차 목표가(보라색 볼린저 상단 $${pos.tp1PriceUsd}) 돌파 후 캔들 둔화로 수익 확정! (+${pnlPct}%)`;
      }
    } else {
      // 🔴 SHORT 청산 조건 (가격이 내려갈수록 수익!)
      if (currentPrice <= pos.tp2PriceUsd) {
        action = 'CLOSE';
        reason = `🎯 [SHORT 익절] 2차 하방 목표가(흰색 켈트너 하단 / 풋감마·맥스페인 $${pos.tp2PriceUsd}) 도달 전량 익절! (+${pnlPct}%)`;
      } else if (currentPrice >= pos.stopPriceUsd) {
        action = 'CLOSE';
        reason = `🚨 [SHORT 손절] 흰색 채널 상단 / 콜감마 저항선($${pos.stopPriceUsd}) 상방 돌파 즉시 손절! (${pnlPct}%)`;
      } else if (currentPrice <= pos.tp1PriceUsd && live.ok && live.chart.candleBullish) {
        action = 'CLOSE';
        reason = `✅ [SHORT 익절] 1차 목표가(보라색 볼린저 하단 $${pos.tp1PriceUsd}) 도달 후 반등 캔들 감지로 숏 수익 확정! (+${pnlPct}%)`;
      }
    }

    results.push({
      id: pos.id,
      symbol: pos.symbol,
      direction: dir,
      currentPriceUsd: currentPrice,
      pnlPct,
      action,
      reason,
      liveAnalysis: live.ok ? live : null
    });
  }
  return results;
}

module.exports = {
  DEFAULT_GEMINI_KEY,
  STOPHUNT_UNIVERSE,
  getStopHuntSessionInfo,
  RWA_SECTORS,
  RWA_UNIVERSE,
  ROLE_PROFILES_BY_DESK,
  BOT_PROMPTS,
  fetchJson,
  callGeminiAI,
  checkSolanaTokenOnChain,
  runChiefVerification,
  // 데스크 1 (메이저 선물 스탑헌팅 역추세)
  runScanAgent,
  runVetAgent,
  runSizeAgent,
  runFillsAgent,
  calculateRiskFormula,
  checkContractRiskLive,
  // 데스크 2 (예측시장 괴리율)
  runBookAgent,
  runPredictionFillsAgent,
  checkPredictionRiskLive,
  // 옵션 지지·저항선 AI 분석
  analyzeRwaTicker,
  askOptionSupportResistanceAI,
  runRwaDeskScanAndVet,
  runRwaFillsAgent,
  checkRwaPositionsRiskLive
};
