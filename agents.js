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
    title: '🪙 데스크 1: 크립토 밈코인 데스크 ($1,000 금고)',
    subtitle: 'DexScreener 런치 속도 스캔 + Solana RPC/RugCheck 7단계 스캠 필터 + 6시간 거래량 급감 청산',
    bots: {
      CHIEF: {
        name: 'CHIEF',
        role: '밈코인 총괄 (Crypto Desk Chief)',
        badge: '👑 밈코인 총괄',
        color: '#f59e0b',
        prompt: `너는 크립토 밈코인 데스크($1,000 독립 시드)의 총괄 CHIEF다.
- 일의 순서: SCAN -> VET -> BOOK -> SIZE -> FILLS -> RISK. VET 7단계 검사를 통과하지 않은 코인은 절대 SIZE로 넘기지 않는다.
- 장중 실제로 굴린 돈 대비 손익이 10% 이상 움직이거나 체결/청산 발생 시 즉시 텔레그램으로 보고한다.`
      },
      SCAN: {
        name: 'SCAN',
        role: '덱스 런치·속도 스캐너 (Dex Velocity Scanner)',
        badge: '🔍 런치스캔',
        color: '#38bdf8',
        prompt: `너는 밈코인 SCAN이다. DexScreener 솔라나 런치·부스트 데이터를 읽고 절대 크기가 아닌 '매수자 증가 속도(velocityScore)'로 상위 10개 후보의 순위를 매긴다.
- 유동성 $10,000 미만 제외, 최근 2구간(m5, h1) 매도 우위 페어 즉시 제외.
- 가격이 매수자보다 빨리 오르면 경고(WARNING)를 붙이고 순위 가산을 배제한다.`
      },
      VET: {
        name: 'VET',
        role: '온체인 스캠 7단계 판독기 (Solana RPC & RugCheck)',
        badge: '🛡️ 스캠검증',
        color: '#a855f7',
        prompt: `너는 밈코인 VET이다. 후보를 탈락시키는 게 일이다.
1. 최대 지갑 보유율 > 5% REJECT (Solana RPC + RugCheck 교차검증)
2. 유동성 < $10,000 또는 주문액 50배 미만 REJECT
3. 1시간 가격 상승 중 순매수세 정체 REJECT
4. 1시간 가격 변화에 이미 선반영된 급등 REJECT
5. 단일 출처 미확인 뉴스/경고 REJECT
6. 왕복 수수료+슬리피지 대비 기대 변동폭 부족 REJECT
7. 생성 30분 미만 신생 페어의 거래 활력 감소 REJECT`
      },
      BOOK: {
        name: 'BOOK',
        role: '크립토 센티먼트 모니터 (Fear & Greed Filter)',
        badge: '📊 시장심리',
        color: '#10b981',
        prompt: `너는 밈코인 데스크의 거시 심리 모니터 BOOK이다. 월드모니터 공포·탐욕 지수와 크립토 시장 과열 여부를 점검하여 데스크 위험 선호도를 보조한다.`
      },
      SIZE: {
        name: 'SIZE',
        role: '밈코인 켈리 사이저 (6% Cap Position Sizer)',
        badge: '📐 켈리배분',
        color: '#eab308',
        prompt: `너는 밈코인 SIZE다. 밈코인 금고($1,000)의 묶이지 않은 현금에서 켈리 공식(계좌의 최대 6% = $60 상한, 슬리피지 예산 2%, 최소 주문 $50)으로 진입 금액을 산정한다. 중복 분할 매수는 금지한다.`
      },
      FILLS: {
        name: 'FILLS',
        role: '덱스 모의 체결기 (DEX Paper Logger)',
        badge: '📝 덱스체결',
        color: '#6366f1',
        prompt: `너는 밈코인 FILLS다. 수수료율 0.45%(최소 $0.95)를 적용해 실효 수수료가 2%를 넘으면 FEE_FLOOR로 반려하고, 고래 매도세가 감지되면 체결을 보류한다.`
      },
      RISK: {
        name: 'RISK',
        role: '거래량 붕괴 청산기 (Volume Ratio Exit)',
        badge: '🚨 거래량청산',
        color: '#ef4444',
        prompt: `너는 밈코인 RISK다. 5분마다 열린 코인의 avg_6h = volume.h24 / 4, ratio = volume.h6 / avg_6h를 계산하여 ratio < 0.20이면 누구의 허락도 구하지 않고 즉시 전량 CLOSE한다.`
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
// [데스크 1: 크립토 밈코인 데스크 ($1,000)] 에이전트 함수들
// ============================================================================
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

async function runVetAgent(candidates, config, plannedOrderUsd = 55) {
  const minLiquidityUsd = Number(config.minLiquidityUsd || 10000);
  const minPairAgeMinutes = Number(config.minPairAgeMinutes || 30);
  const maxTopWalletPct = Number(config.maxTopWalletPct || 5.0);

  const vetResults = [];

  for (const cand of candidates) {
    const onChain = cand.onChain || (await checkSolanaTokenOnChain(cand.contract));
    const now = Date.now();
    const ageMinutes = cand.pairCreatedAt ? Math.round((now - cand.pairCreatedAt) / 60000) : 999;

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

function runSizeAgent(item, portfolio, config, customCapPct = null) {
  const maxKellyCapPct = Number(customCapPct || config.maxKellyCapPct || 0.06);
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

  const winProb = item.decision === 'PASS' ? 0.58 : (item.myProb || 0.56);
  const payoffRatio = item.payoffRatio || 1.6;
  const rawKelly = ((payoffRatio * winProb) - (1 - winProb)) / payoffRatio;
  const cappedKellyPct = Math.min(maxKellyCapPct, Math.max(0.052, rawKelly));

  const maxByAccountCap = totalEquity * cappedKellyPct;
  const liqUsd = Number(item.candidate?.liquidityUsd || item.liquidityUsd || 25000);
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
    reason: `켈리 상한(${(maxKellyCapPct * 100).toFixed(1)}%) 및 유동성($${liqUsd.toLocaleString()}) 통과 -> $${calculatedDollars} 배분`
  };
}

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
      reason: `큰 물량 매도 우위 감지 (5분 매도 ${candidate.txnsM5.sells} > 매수 ${candidate.txnsM5.buys}) -> 체결 보류`
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
    desk: 'memecoin',
    status: 'FILLED_PAPER',
    id: `pos_meme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
    fetchJson('https://external-api.kalshi.com/trade-api/v2/events?limit=30&status=open&with_nested_markets=true'),
    fetchJson('https://gamma-api.polymarket.com/markets?closed=false&order=volumeNum&limit=30'),
    fetchJson('https://api.alternative.me/fng/?limit=1')
  ]);

  const fearGreedVal = Number(fgRes.data?.data?.[0]?.value || 54);
  const fearGreedClass = fgRes.data?.data?.[0]?.value_classification || 'Neutral';

  // 1) SCAN: 원시 마켓 수집
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
      rawMarkets.push({
        source: 'Polymarket',
        marketId: String(m.id || m.conditionId || question.slice(0, 24)),
        question,
        yesPrice: Number(outcomePrices[0] || 0),
        volumeUsd: Math.round(Number(m.volumeNum || 0)),
        liquidityUsd: Math.round(Number(m.liquidityNum || 15000)),
        updatedAt: m.updatedAt ? new Date(m.updatedAt).getTime() : Date.now()
      });
    }
  }

  if (kalshiEventsRes.ok && Array.isArray(kalshiEventsRes.data?.events)) {
    for (const ev of kalshiEventsRes.data.events) {
      const m = ev.markets?.[0];
      if (!m) continue;
      const question = ev.title || m.title || '';
      if (!question) continue;
      const yesPrice = Number(m.last_price_dollars || m.yes_ask_dollars || m.yes_bid_dollars || 0);
      rawMarkets.push({
        source: 'Kalshi',
        marketId: String(m.ticker || ev.event_ticker),
        question,
        yesPrice,
        volumeUsd: Math.round(Number(m.volume_24h_fp || 5000)),
        liquidityUsd: Math.round(Number(m.open_interest_fp || 12000) + 10000),
        updatedAt: Date.now()
      });
    }
  }

  // 2) VET: 예측시장 5단계 적격성 검증
  const vetRejected = [];
  const validMarkets = [];

  for (const m of rawMarkets) {
    const ageHours = (Date.now() - m.updatedAt) / 3600000;
    if (ageHours > 48) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 1, reason: `데이터 노후화 (${Math.round(ageHours)}h > 48h)` });
      continue;
    }
    if (m.yesPrice <= 0.05 || m.yesPrice >= 0.95) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 2, reason: `극단 확률 배제 (시장가격 ${(m.yesPrice * 100).toFixed(1)}%)` });
      continue;
    }
    if (m.liquidityUsd < 5000) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 3, reason: `유동성 미달 ($${m.liquidityUsd.toLocaleString()} < $5,000)` });
      continue;
    }
    if (existingMarketIds && existingMarketIds.has(m.marketId)) {
      vetRejected.push({ marketId: m.marketId, question: m.question, source: m.source, rule: 4, reason: `이미 보유 중인 마켓 중복 진입 차단` });
      continue;
    }
    validMarkets.push(m);
    if (validMarkets.length >= 8) break;
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

    const rawEdge = Number((myYesProb - m.yesPrice).toFixed(3));
    const absEdgePct = Number((Math.abs(rawEdge) * 100).toFixed(1));
    const side = rawEdge >= 0 ? 'YES' : 'NO';
    const sideMyProb = rawEdge >= 0 ? myYesProb : Number((1 - myYesProb).toFixed(3));
    const sideMarketPrice = rawEdge >= 0 ? m.yesPrice : Number((1 - m.yesPrice).toFixed(3));

    const evalRecord = {
      source: m.source,
      marketId: m.marketId,
      question: m.question,
      yesPrice: m.yesPrice,
      myYesProb,
      side,
      myProb: sideMyProb,
      marketPrice: sideMarketPrice,
      edgePct: absEdgePct,
      liquidityUsd: m.liquidityUsd,
      volumeUsd: m.volumeUsd,
      aiModel: aiModelUsed || 'quant-fallback',
      reasoning: reasoningText,
      actionable: absEdgePct >= 8.0
    };
    evaluatedMarkets.push(evalRecord);

    if (absEdgePct >= 8.0) {
      proposals.push(evalRecord);
    }
  }

  proposals.sort((a, b) => b.edgePct - a.edgePct);

  return {
    bot: 'BOOK',
    status: 'ACTIVE',
    aiModelUsed,
    kalshiStatus: kalshiRes.status,
    polymarketStatus: polyRes.status,
    scannedRawCount: rawMarkets.length,
    vetRejectedCount: vetRejected.length,
    vetRejected: vetRejected.slice(0, 10),
    evaluatedCount: evaluatedMarkets.length,
    evaluatedMarkets,
    proposals: proposals.slice(0, 2)
  };
}

/**
 * 예측시장 컨트랙트 모의 체결 (FILLS)
 */
function runPredictionFillsAgent(proposal, sizeResult) {
  const dollars = Number(sizeResult.dollars || 0);
  if (dollars <= 0) {
    return { bot: 'FILLS', status: 'SKIPPED_ZERO_SIZE', reason: sizeResult.reason };
  }

  const feeUsd = Number(Math.max(dollars * 0.005, 0.50).toFixed(2));
  const netInvestedUsd = Number((dollars - feeUsd).toFixed(2));
  const entryPrice = Math.max(0.05, Math.min(0.95, Number(proposal.marketPrice || 0.5)));
  const shares = Number((netInvestedUsd / entryPrice).toFixed(2));
  // 목표 수렴 가격: 시장 가격이 내 추정 확률(myProb)의 75% 지점까지 수렴하면 익절
  const targetPrice = Number((entryPrice + (proposal.myProb - entryPrice) * 0.75).toFixed(3));
  const stopPrice = Number(Math.max(0.02, entryPrice * 0.82).toFixed(3));

  return {
    bot: 'FILLS',
    desk: 'prediction',
    status: 'FILLED_PAPER',
    id: `pos_pred_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source: proposal.source,
    marketId: proposal.marketId,
    question: proposal.question,
    side: proposal.side,
    myProb: proposal.myProb,
    entryPriceUsd: entryPrice,
    currentPriceUsd: entryPrice,
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
 * 예측시장 열린 포지션 실시간 가격 갱신 및 괴리율 수렴 익절 / 역행 손절 점검 (PRED-RISK)
 */
async function checkPredictionRiskLive(openPositions = []) {
  if (!openPositions.length) return [];

  const [kalshiEventsRes, polyRes] = await Promise.all([
    fetchJson('https://external-api.kalshi.com/trade-api/v2/events?limit=35&status=open&with_nested_markets=true'),
    fetchJson('https://gamma-api.polymarket.com/markets?closed=false&order=volumeNum&limit=35')
  ]);

  const liveYesPriceMap = new Map();
  if (polyRes.ok && Array.isArray(polyRes.data)) {
    for (const m of polyRes.data) {
      const id = String(m.id || m.conditionId || '');
      let outcomePrices = [];
      try {
        outcomePrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []);
      } catch {
        outcomePrices = [];
      }
      const yp = Number(outcomePrices[0] || 0);
      if (id && yp > 0) liveYesPriceMap.set(id, yp);
    }
  }
  if (kalshiEventsRes.ok && Array.isArray(kalshiEventsRes.data?.events)) {
    for (const ev of kalshiEventsRes.data.events) {
      const m = ev.markets?.[0];
      if (!m) continue;
      const id = String(m.ticker || ev.event_ticker);
      const yp = Number(m.last_price_dollars || m.yes_ask_dollars || 0);
      if (id && yp > 0) liveYesPriceMap.set(id, yp);
    }
  }

  const results = [];
  for (const pos of openPositions) {
    const rawYes = liveYesPriceMap.get(pos.marketId);
    let currentSidePrice = pos.currentPriceUsd || pos.entryPriceUsd;
    if (typeof rawYes === 'number' && rawYes > 0 && rawYes < 1) {
      currentSidePrice = pos.side === 'YES' ? rawYes : Number((1 - rawYes).toFixed(3));
    }

    const currentEdgePct = Number((Math.abs(pos.myProb - currentSidePrice) * 100).toFixed(1));
    const pnlPct = pos.entryPriceUsd > 0
      ? Number((((currentSidePrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(2))
      : 0;

    let action = 'HOLD';
    let closeReason = `괴리율 ${currentEdgePct}% 유지 중 (목표가 $${pos.targetPriceUsd} / 손절가 $${pos.stopPriceUsd})`;

    if (currentSidePrice >= pos.targetPriceUsd || pnlPct >= 18) {
      action = 'CLOSE';
      closeReason = `🎯 괴리율 수렴 목표 도달 익절! (진입 $${pos.entryPriceUsd} -> 현재 $${currentSidePrice}, 수익률 +${pnlPct}%)`;
    } else if (currentSidePrice <= pos.stopPriceUsd || pnlPct <= -18) {
      action = 'CLOSE';
      closeReason = `🚨 예측시장 괴리 역행 손절 규칙 발동 (진입 $${pos.entryPriceUsd} -> 현재 $${currentSidePrice}, ${pnlPct}%)`;
    }

    results.push({
      id: pos.id,
      marketId: pos.marketId,
      question: pos.question,
      side: pos.side,
      currentPriceUsd: currentSidePrice,
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
  const sym = typeof symbolMeta === 'string' ? symbolMeta.toUpperCase() : symbolMeta.symbol;
  const meta = RWA_UNIVERSE.find(u => u.symbol === sym) || {
    symbol: sym,
    name: sym,
    sector: 'custom',
    category: '🌎 개별주 직접검색'
  };

  let [c1hRes, c10mRes, optRes] = await Promise.all([
    fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=1H`, {}, 9000),
    fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=10m`, {}, 9000),
    fetchJson(`https://tooja.me/api/options?symbol=${encodeURIComponent(sym)}`, {}, 9000)
  ]);

  if (!c1hRes.ok || !c1hRes.data?.candles?.length) {
    await new Promise(r => setTimeout(r, 300));
    [c1hRes, c10mRes, optRes] = await Promise.all([
      fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=1H`, {}, 9000),
      fetchJson(`https://tooja.me/api/chart?symbol=${encodeURIComponent(sym)}&tf=10m`, {}, 9000),
      fetchJson(`https://tooja.me/api/options?symbol=${encodeURIComponent(sym)}`, {}, 9000)
    ]);
  }

  if (!c1hRes.ok || !c1hRes.data?.candles?.length) {
    return { ok: false, symbol: sym, error: `tooja.me 차트 응답 실패 (HTTP ${c1hRes.status})` };
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

    // 현재가 주변에서 Net GEX 부호가 바뀌는 감마 플립(Gamma Flip) 행사가 찾기
    const sortedByDist = [...gexByStrike].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
    for (let i = 0; i < gexByStrike.length - 1; i++) {
      if ((gexByStrike[i].netGexK <= 0 && gexByStrike[i + 1].netGexK > 0) ||
          (gexByStrike[i].netGexK >= 0 && gexByStrike[i + 1].netGexK < 0)) {
        gammaFlipStrike = gexByStrike[i + 1].strike;
        break;
      }
    }
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

  return {
    ok: true,
    symbol: sym,
    name: c1h.name || meta.name,
    sector: meta.sector || 'custom',
    category: meta.category,
    spot: Number(spot.toFixed(2)),
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
  RWA_SECTORS,
  RWA_UNIVERSE,
  ROLE_PROFILES_BY_DESK,
  BOT_PROMPTS,
  fetchJson,
  callGeminiAI,
  checkSolanaTokenOnChain,
  runChiefVerification,
  // 데스크 1 (밈코인)
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
  // 데스크 3 (RWA 차트 & 옵션감마)
  analyzeRwaTicker,
  runRwaDeskScanAndVet,
  runRwaFillsAgent,
  checkRwaPositionsRiskLive
};
