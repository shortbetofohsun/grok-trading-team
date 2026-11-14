const DEFAULT_SERVER_URL = 'https://grok-trading-team.onrender.com';

const serverSelect = document.getElementById('serverSelect');
const modeBadge = document.getElementById('modeBadge');
const liveSummary = document.getElementById('liveSummary');
const walletSummary = document.getElementById('walletSummary');
const allowedAddrInput = document.getElementById('allowedAddr');
const orderMarginInput = document.getElementById('orderMargin');
const maxCapInput = document.getElementById('maxCap');
const btnOpenVar = document.getElementById('btnOpenVar');
const btnSaveConnect = document.getElementById('btnSaveConnect');
const btnTestOrder = document.getElementById('btnTestOrder');
const btnToggleLive = document.getElementById('btnToggleLive');
const msgBox = document.getElementById('msgBox');

let currentServerUrl = DEFAULT_SERVER_URL;
let latestStatus = null;

function shortAddr(addr) {
  const s = String(addr || '');
  if (s.length <= 12) return s || '미등록';
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function setMsg(text, isErr = false) {
  msgBox.style.color = isErr ? '#fca5a5' : '#cbd5e1';
  msgBox.textContent = text;
}

function callServer(path, method = 'GET', body = null, timeoutMs = 25000) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: 'BRIDGE_HTTP',
        url: `${currentServerUrl}${path}`,
        method,
        body,
        timeoutMs,
        storeStatus: path.includes('/api/live/')
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, status: 0, data: { error: chrome.runtime.lastError.message } });
          return;
        }
        resolve(resp || { ok: false, status: 0, data: { error: '응답 없음' } });
      }
    );
  });
}

function renderStatus(st, forceHydrate = false) {
  latestStatus = st || null;
  if (!st) {
    modeBadge.textContent = 'OFFLINE';
    modeBadge.className = 'badge';
    liveSummary.innerHTML = '<span class="err">서버 응답 없음 (Render 슬립 또는 네트워크 확인)</span>';
    return;
  }

  modeBadge.textContent = st.enabled ? 'LIVE AUTO' : 'PAPER';
  modeBadge.className = `badge${st.enabled ? ' live' : ''}`;

  const bridgeConnected = Boolean(st.edgeBridgeConnected);
  const ageSec = st.edgeLastSeenAt ? Math.max(0, Math.round((Date.now() - Number(st.edgeLastSeenAt)) / 1000)) : null;

  if (bridgeConnected) {
    liveSummary.innerHTML = `<span class="ok">Edge 탭 직결됨</span> · ${ageSec !== null ? `${ageSec}초 전` : '실시간'} · 1회 $${st.orderMarginUsd} (10x)`;
  } else if (st.hasSession) {
    liveSummary.innerHTML = `<span class="ok">직접 세션 연결됨</span> · 지갑 ${shortAddr(st.connectedAddress)}`;
  } else {
    liveSummary.innerHTML = '<span class="warn">Edge omni.variational.io 탭 대기중</span>';
  }

  const addrLabel = st.connectedAddress ? shortAddr(st.connectedAddress) : '미확인';
  const balLabel = Number.isFinite(Number(st.lastBalanceUsd)) ? `$${Number(st.lastBalanceUsd).toFixed(2)}` : '$0.00';
  const allowLabel = st.allowedAddress ? shortAddr(st.allowedAddress) : '미지정';
  walletSummary.textContent = `연결지갑: ${addrLabel} (${balLabel} USDC) | 허용잠금: ${allowLabel} (상한 $${st.maxEquityCapUsd})`;

  if (forceHydrate) {
    if (!allowedAddrInput.value && st.allowedAddress) allowedAddrInput.value = st.allowedAddress;
    if (st.orderMarginUsd) orderMarginInput.value = st.orderMarginUsd;
    if (st.maxEquityCapUsd) maxCapInput.value = st.maxEquityCapUsd;
  }

  btnToggleLive.textContent = st.enabled ? '실전 자동매매 끄기' : '실전 자동매매 켜기';
  btnToggleLive.className = st.enabled ? 'btn-live-off' : 'btn-live-on';

  if (st.safetyError) {
    setMsg(`안전잠금 경고: ${st.safetyError}`, true);
  }
}

async function refreshStatus(forceHydrate = false) {
  const res = await callServer('/api/live/status', 'GET', null, 15000);
  if (res.ok && res.data?.status) {
    renderStatus(res.data.status, forceHydrate);
  } else {
    renderStatus(null, false);
    if (res.data?.error) setMsg(`상태 조회 실패: ${res.data.error}`, true);
  }
}

btnOpenVar.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: ['https://omni.variational.io/*'] });
  if (tabs && tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
    setMsg('열려 있는 omni.variational.io 탭으로 이동했습니다.');
    return;
  }
  await chrome.tabs.create({ url: 'https://omni.variational.io/perpetual/BTC' });
  setMsg('새 omni.variational.io 탭을 열었습니다. 로그인 상태를 확인해 주세요.');
});

serverSelect.addEventListener('change', async () => {
  currentServerUrl = serverSelect.value;
  await chrome.storage.local.set({ serverUrl: currentServerUrl });
  setMsg(`연동 서버 변경: ${currentServerUrl}`);
  await refreshStatus(true);
});

btnSaveConnect.addEventListener('click', async () => {
  btnSaveConnect.disabled = true;
  setMsg('안전잠금 설정을 저장하고 Edge 연결 상태를 확인 중...');
  try {
    let targetAllow = allowedAddrInput.value.trim();
    if (!targetAllow && latestStatus?.connectedAddress) {
      targetAllow = latestStatus.connectedAddress;
      allowedAddrInput.value = targetAllow;
    }

    const cookieRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_VARIATIONAL_COOKIES' }, resolve);
    });

    const payload = {
      allowedAddress: targetAllow,
      orderMarginUsd: Number(orderMarginInput.value) || 10,
      maxEquityCapUsd: Number(maxCapInput.value) || 250,
      cookieHeader: (!latestStatus?.edgeBridgeConnected && cookieRes?.ok) ? cookieRes.cookieHeader : undefined
    };

    const res = await callServer('/api/live/connect', 'POST', payload, 20000);
    if (res.ok && res.data?.status) {
      renderStatus(res.data.status, true);
      setMsg(`설정 저장 완료! 허용 지갑: ${shortAddr(res.data.status.allowedAddress || res.data.status.connectedAddress)}`);
    } else {
      if (res.data?.status) renderStatus(res.data.status, false);
      setMsg(`등록 실패: ${res.data?.error || '알 수 없는 오류'}`, true);
    }
  } finally {
    btnSaveConnect.disabled = false;
  }
});

btnTestOrder.addEventListener('click', async () => {
  btnTestOrder.disabled = true;
  setMsg('Edge 브리지로 BTC $1.5 10x 진입 -> 즉시 청산 테스트 신호를 보냈습니다 (최대 20초)...');
  try {
    const res = await callServer('/api/live/test-order', 'POST', { symbol: 'BTC', notionalUsd: 1.5 }, 25000);
    if (res.ok && res.data) {
      setMsg(`왕복 테스트 성공! 진입 ${res.data.entryPrice} (RFQ ${res.data.openRfqId}) -> 청산 ${res.data.exitPrice} (RFQ ${res.data.closeRfqId})`);
      await refreshStatus(false);
    } else {
      setMsg(`테스트 실패: ${res.data?.error || '실행 오류'}`, true);
    }
  } finally {
    btnTestOrder.disabled = false;
  }
});

btnToggleLive.addEventListener('click', async () => {
  btnToggleLive.disabled = true;
  try {
    const nextEnabled = !(latestStatus && latestStatus.enabled);
    const res = await callServer('/api/live/toggle', 'POST', { enabled: nextEnabled }, 15000);
    if (res.ok && res.data?.status) {
      renderStatus(res.data.status, false);
      setMsg(res.data.status.enabled
        ? '실전 자동매매(LIVE)가 켜졌습니다. omni.variational.io 탭을 열어두세요.'
        : '모의매매(PAPER) 모드로 전환되었습니다.');
    } else {
      setMsg(`전환 거부: ${res.data?.error || '조건 미충족'}`, true);
    }
  } finally {
    btnToggleLive.disabled = false;
  }
});

chrome.storage.local.get(['serverUrl', 'lastBridgeStatus'], (stored) => {
  currentServerUrl = stored?.serverUrl || DEFAULT_SERVER_URL;
  serverSelect.value = currentServerUrl;
  if (stored?.lastBridgeStatus) {
    renderStatus(stored.lastBridgeStatus, true);
  }
  refreshStatus(true);
});
