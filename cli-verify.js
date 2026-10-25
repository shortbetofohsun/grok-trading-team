/**
 * 가이드 STEP 1 ~ STEP 4 + v3.0 3대 데스크(크립토 · 예측시장 괴리율 · RWA 차트/옵션감마) 터미널 일괄 검증 스크립트
 */
const {
  runChiefVerification,
  calculateRiskFormula,
  checkContractRiskLive,
  analyzeRwaTicker
} = require('./agents');

async function main() {
  const wmPort = Number(process.env.WM_PORT || 3000);
  console.log('================================================================');
  console.log('1️⃣ [STEP 1 & 2] CHIEF 환경 및 월드모니터 · 무료 가격 데이터 연결 검증');
  console.log('================================================================');
  const ver = await runChiefVerification(wmPort);
  console.log(`• Node 버전: ${ver.nodeVersion} (v20 이상 충족: ${ver.nodeVersionOk})`);
  console.log(`• 월드모니터 주소: ${ver.wmUrl} (상태: ${ver.status})`);
  console.log(`  - DexScreener BONK ("pairs" 포함): HTTP ${ver.checks.dexscreenerBonk.status} | hasPairs=${ver.checks.dexscreenerBonk.hasPairs}`);
  console.log(`  - Kalshi Open Markets: HTTP ${ver.checks.kalshiOpen.status} | ok=${ver.checks.kalshiOpen.ok}`);
  console.log(`  - tooja.me RWA 차트 & 옵션감마 API: Chart HTTP ${ver.checks.toojaRwa.chartStatus} / Options HTTP ${ver.checks.toojaRwa.optionsStatus} (ready=${ver.rwaReady})`);

  console.log('\n================================================================');
  console.log('2️⃣ [STEP 4-A] RISK 정적 수식 검증 (24h=4717.70, 6h=167.75)');
  console.log('================================================================');
  const staticCalc = calculateRiskFormula(4717.70, 167.75);
  console.log(staticCalc.formattedLine);

  console.log('\n================================================================');
  console.log('3️⃣ [STEP 4-B] RISK 실시간 계약 주소 검증 (BONK)');
  console.log('================================================================');
  const bonkCheck = await checkContractRiskLive('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
  console.log(`계약 주소: ${bonkCheck.contract} ($${bonkCheck.symbol})`);
  console.log(bonkCheck.formattedLine);

  console.log('\n================================================================');
  console.log('4️⃣ [v3.0 RWA] tooja.me 차트(켈트너·볼린저) & 옵션 감마(콜/숏감마) 검증 (GLD, SPY)');
  console.log('================================================================');
  for (const sym of ['GLD', 'SPY']) {
    const rwa = await analyzeRwaTicker(sym);
    if (rwa.ok) {
      console.log(`• $${rwa.symbol} ($${rwa.spot}): ${rwa.options.gammaRegimeLabel}`);
      console.log(`  - 1H 보라채널: $${rwa.chart.purple1hLower} ~ $${rwa.chart.purple1hUpper} | 1H 흰색채널: $${rwa.chart.white1hLower} ~ $${rwa.chart.white1hUpper} (스퀴즈=${rwa.chart.purpleInsideWhite1h})`);
      console.log(`  - 콜벽: $${rwa.options.callWall} | 풋벽: $${rwa.options.putWall} | 맥스페인: $${rwa.options.maxPain} | TP1: $${rwa.tradeSetup.tp1Price} / TP2: $${rwa.tradeSetup.tp2Price}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
