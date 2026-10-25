/**
 * 가이드 STEP 1 ~ STEP 4 터미널 일괄 검증 스크립트
 */
const {
  runChiefVerification,
  calculateRiskFormula,
  checkContractRiskLive
} = require('./agents');

async function main() {
  const wmPort = Number(process.env.WM_PORT || 3000);
  console.log('================================================================');
  console.log('1️⃣ [STEP 1 & 2] CHIEF 환경 및 월드모니터 · 무료 가격 데이터 연결 검증');
  console.log('================================================================');
  const ver = await runChiefVerification(wmPort);
  console.log(`• Node 버전: ${ver.nodeVersion} (v20 이상 충족: ${ver.nodeVersionOk})`);
  console.log(`• 월드모니터 주소: ${ver.wmUrl}`);
  console.log(`• 전체 상태 보고: ${ver.status}`);
  console.log(`  - DexScreener BONK ("pairs" 포함): HTTP ${ver.checks.dexscreenerBonk.status} | hasPairs=${ver.checks.dexscreenerBonk.hasPairs}`);
  console.log(`  - get-fear-greed-index: HTTP ${ver.checks.wmFearGreed.status} | ${ver.checks.wmFearGreed.firstLine}`);
  console.log(`  - list-prediction-markets: HTTP ${ver.checks.wmPrediction.status} | ${ver.checks.wmPrediction.firstLine}`);
  console.log(`  - list-cross-source-signals: HTTP ${ver.checks.wmSignals.status} | ${ver.checks.wmSignals.firstLine}`);
  console.log(`  - Kalshi Open Markets: HTTP ${ver.checks.kalshiOpen.status} | ok=${ver.checks.kalshiOpen.ok}`);

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
  console.log(`판정 사유: ${bonkCheck.reason}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
