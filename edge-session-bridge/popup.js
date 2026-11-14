const BLOCKED_EXACT = new Set([
  '__cf_bm', '_cfuvid', 'cf_clearance',
  '_gid', '_fbp', '_fbc', '_dd_s', '_uetsid', '_uetvid', '_clck', '_clsk',
  '_rdt_uuid', '_ttp', '_tt_enable_cookie', '_scid', '_sctr', '_pin_unauth',
  'IDE', 'MUID', 'li_sugr', 'lidc', 'bcookie', 'bscookie',
  'sa-user-id', 'sa-user-id-v2', 'sa-user-id-v3'
]);

const BLOCKED_PREFIXES = [
  'cf_', '__cf', '_ga', '_gcl_', '_hj', '_pk_', '_vwo', '_uet',
  'ajs_', 'amp_', 'amplitude', 'mp_', 'ph_', 'intercom-', '__hs', 'hubspotutk', '__str'
];

function isBlockedCookie(name) {
  const lower = String(name || '').toLowerCase();
  if (!lower) return true;
  if (BLOCKED_EXACT.has(name) || BLOCKED_EXACT.has(lower)) return true;
  return BLOCKED_PREFIXES.some(p => lower.startsWith(p));
}

async function readVariationalCookieHeader() {
  const [byUrl, byDomain] = await Promise.all([
    chrome.cookies.getAll({ url: 'https://omni.variational.io' }),
    chrome.cookies.getAll({ domain: 'variational.io' })
  ]);
  const map = new Map();
  for (const c of [...byDomain, ...byUrl]) {
    if (!c || !c.name || isBlockedCookie(c.name)) continue;
    map.set(c.name, c.value);
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function setStatus(html, cls = 'muted') {
  const box = document.getElementById('statusBox');
  box.className = cls;
  box.innerHTML = html;
}

document.getElementById('btnConnect').addEventListener('click', async () => {
  const btn = document.getElementById('btnConnect');
  btn.disabled = true;
  setStatus('Edge에서 Variational 세션을 추출하고 로컬 서버를 검증 중입니다...', 'muted');

  try {
    const cookies = await readVariationalCookieHeader();
    if (!cookies) {
      setStatus('Variational 세션 쿠키를 찾지 못했습니다. Edge에서 omni.variational.io에 지갑 로그인해 주세요.', 'err');
      btn.disabled = false;
      return;
    }

    const allowedAddress = document.getElementById('allowedAddress').value.trim();
    const orderMarginUsd = Number(document.getElementById('orderMarginUsd').value || 10);
    const maxEquityCapUsd = Number(document.getElementById('maxEquityCapUsd').value || 250);

    const res = await fetch('http://localhost:3000/api/live/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies, allowedAddress, orderMarginUsd, maxEquityCapUsd })
    });
    const out = await res.json();
    if (!res.ok || !out.ok) {
      setStatus(`연결 차단/오류: ${out.error || '알 수 없는 오류'}`, 'err');
    } else {
      const st = out.status || {};
      setStatus(
        `연결 및 3중 안전 검증 성공<br>` +
        `지갑: ${st.connectedAddress || '-'}<br>` +
        `잔고: $${Number(st.lastBalanceUsd ?? 0).toFixed(2)} USDC (상한 $${st.maxEquityCapUsd})<br>` +
        `이제 대시보드(localhost:3000)에서 테스트 주문 후 실전 ON 전환 가능합니다.`,
        'ok'
      );
    }
  } catch (err) {
    setStatus(`로컬 서버(localhost:3000) 통신 실패: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btnCopy').addEventListener('click', async () => {
  try {
    const cookies = await readVariationalCookieHeader();
    if (!cookies) {
      setStatus('복사할 Variational 쿠키가 없습니다. 먼저 로그인해 주세요.', 'err');
      return;
    }
    await navigator.clipboard.writeText(cookies);
    setStatus(`세션 쿠키(${cookies.length}자)를 클립보드에 복사했습니다. 대시보드 입력칸에 붙여넣기 하세요.`, 'ok');
  } catch (err) {
    setStatus(`복사 실패: ${err.message}`, 'err');
  }
});
