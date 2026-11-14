(() => {
  if (window.__GROK_EDGE_BRIDGE_LOADED__) return;
  window.__GROK_EDGE_BRIDGE_LOADED__ = true;

  const DEFAULT_SERVER_URL = 'https://grok-trading-team.onrender.com';
  const HEARTBEAT_INTERVAL_MS = 3000;
  const RWA_ETFS = new Set(['QQQ', 'SOXL', 'EWY', 'SPY', 'IBIT', 'TLT', 'GLD', 'SLV', 'USO', 'VNQ', 'EWJ']);

  let serverUrl = DEFAULT_SERVER_URL;
  let currentAddress = '';
  let heartbeatTimer = null;
  let heartbeatBusy = false;
  let lastActionNote = '대기중';
  let lastServerStatus = null;
  const executedSignalIds = new Set();

  function shortAddr(addr) {
    const s = String(addr || '');
    if (s.length <= 12) return s || '미연결';
    return `${s.slice(0, 6)}...${s.slice(-4)}`;
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '==='.slice((b64.length + 3) % 4);
      const json = atob(padded);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function getVariationalInstrument(symbol) {
    const clean = String(symbol || '')
      .toUpperCase()
      .replace(/-PERP$/i, '')
      .replace(/\/USD$/i, '')
      .replace(/USDT$/i, '')
      .trim();
    if (!clean) throw new Error('심볼이 비어 있습니다.');
    if (RWA_ETFS.has(clean)) {
      return {
        underlying: clean,
        instrument_type: 'perpetual_rwa_future',
        settlement_asset: 'USDC',
        kind: 'etf'
      };
    }
    return {
      underlying: clean,
      instrument_type: 'perpetual_future',
      settlement_asset: 'USDC',
      funding_interval_s: 3600
    };
  }

  function countDecimals(stepStr) {
    const s = String(stepStr || '').trim();
    if (!s || !s.includes('.')) return 0;
    const dec = s.split('.')[1].replace(/0+$/, '');
    return dec.length;
  }

  function formatTickValue(rawNum, tickStr, minStr) {
    const num = Number(rawNum);
    if (!Number.isFinite(num) || num <= 0) return null;
    const tick = Number(tickStr);
    const minVal = Number(minStr);
    if (!Number.isFinite(tick) || tick <= 0) {
      return num.toFixed(6).replace(/\.?0+$/, '');
    }
    const decimals = Math.min(8, Math.max(countDecimals(tickStr), countDecimals(minStr)));
    const snappedSteps = Math.floor((num + 1e-12) / tick);
    let snapped = snappedSteps * tick;
    if (Number.isFinite(minVal) && minVal > 0 && snapped < minVal) {
      snapped = minVal;
    }
    if (snapped <= 0) snapped = tick;
    return snapped.toFixed(decimals).replace(/\.?0+$/, '') || '0';
  }

  function formatPrice(rawPrice) {
    const n = Number(rawPrice);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const decimals = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 4 : 6;
    const factor = 10 ** decimals;
    const truncated = Math.floor(n * factor + 1e-9) / factor;
    return truncated.toFixed(decimals).replace(/\.?0+$/, '');
  }

  function relayToServer(path, method = 'GET', body = null) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'BRIDGE_HTTP',
            url: `${serverUrl}${path}`,
            method,
            body,
            storeStatus: path.includes('/api/live/')
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, status: 0, data: { error: chrome.runtime.lastError.message } });
              return;
            }
            resolve(resp || { ok: false, status: 0, data: { error: '백그라운드 응답 없음' } });
          }
        );
      } catch (err) {
        resolve({ ok: false, status: 0, data: { error: err?.message || '메시지 전송 실패' } });
      }
    });
  }

  async function varApi(path, options = {}) {
    const headers = {
      'content-type': 'application/json',
      ...(currentAddress ? { 'vr-connected-address': currentAddress } : {}),
      ...(options.headers || {})
    };
    const res = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'include',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const detail = json?.error || json?.message || text?.slice(0, 160) || `HTTP ${res.status}`;
      throw new Error(`Variational API ${path} 실패 (${res.status}): ${detail}`);
    }
    return json;
  }

  async function readWalletSnapshot() {
    let me = null;
    try {
      me = await varApi('/api/me');
    } catch {
      return { loggedIn: false, address: '', balanceUsd: 0, upnlUsd: 0, marginUsage: 0, positions: [] };
    }

    const token = String(me?.token || '').trim();
    if (!token) {
      currentAddress = '';
      return { loggedIn: false, address: '', balanceUsd: 0, upnlUsd: 0, marginUsage: 0, positions: [] };
    }

    const payload = decodeJwtPayload(token);
    const addr = String(payload?.address || '').trim();
    if (!addr) {
      currentAddress = '';
      return { loggedIn: false, address: '', balanceUsd: 0, upnlUsd: 0, marginUsage: 0, positions: [] };
    }
    currentAddress = addr;

    if (payload?.exp && Date.now() / 1000 > Number(payload.exp)) {
      return { loggedIn: false, address: addr, balanceUsd: 0, upnlUsd: 0, marginUsage: 0, positions: [], expired: true };
    }

    const [portfolio, rawPositions] = await Promise.all([
      varApi('/api/portfolio?compute_margin=true').catch(() => ({})),
      varApi('/api/positions').catch(() => ([]))
    ]);

    const rows = Array.isArray(rawPositions)
      ? rawPositions
      : Array.isArray(rawPositions?.result)
        ? rawPositions.result
        : [];

    const positions = rows
      .map((r) => {
        const info = r?.position_info || r || {};
        const qty = Number(info.qty || 0);
        return {
          symbol: String(info?.instrument?.underlying || '').toUpperCase(),
          qty,
          rawQty: String(info?.qty ?? '0'),
          side: qty > 0 ? 'LONG' : qty < 0 ? 'SHORT' : 'FLAT',
          avgEntryPrice: Number(info?.avg_entry_price || 0),
          upnlUsd: Number(r?.upnl || info?.upnl || 0)
        };
      })
      .filter((p) => p.symbol && Math.abs(p.qty) > 0);

    return {
      loggedIn: true,
      address: addr,
      balanceUsd: Number(portfolio?.balance || 0),
      upnlUsd: Number(portfolio?.upnl || 0),
      marginUsage: Number(portfolio?.margin_usage || 0),
      positions
    };
  }

  function assertSafetyLock(snapshot, cfg, requireAllowedAddr = true) {
    if (!snapshot?.loggedIn || !snapshot?.address) {
      throw new Error('Variational 로그인 세션이 확인되지 않습니다.');
    }
    const allowed = String(cfg?.allowedAddress || '').trim().toLowerCase();
    const actual = snapshot.address.toLowerCase();
    if (requireAllowedAddr && !allowed) {
      throw new Error('안전잠금: 허용 지갑 주소(Whitelist)가 등록되지 않아 실전 주문을 차단합니다.');
    }
    if (allowed && allowed !== actual) {
      throw new Error(`안전잠금 차단: 연결 지갑(${snapshot.address}) != 허용 지갑(${cfg.allowedAddress})`);
    }
  }

  async function buildValidatedQuote(inst, side, notionalUsd, estPriceFallback) {
    const estPrice = Number(estPriceFallback) > 0 ? Number(estPriceFallback) : 100;
    const probeQty = String(Math.max(0.0001, Math.min(1, notionalUsd / estPrice)).toFixed(6)).replace(/\.?0+$/, '') || '0.01';
    const probe = await varApi('/api/quotes/indicative', {
      method: 'POST',
      body: { instrument: inst, qty: probeQty }
    });

    const refPrice = Number(side === 'buy' ? (probe.ask || probe.mark_price) : (probe.bid || probe.mark_price)) || Number(probe.mark_price) || estPrice;
    const sideLimit = side === 'buy' ? (probe?.qty_limits?.ask || {}) : (probe?.qty_limits?.bid || {});
    const minQtyStr = sideLimit.min_qty || '0.0001';
    const tickStr = sideLimit.min_qty_tick || minQtyStr;

    const rawQty = notionalUsd / refPrice;
    let finalQtyStr = formatTickValue(rawQty, tickStr, minQtyStr);
    if (!finalQtyStr || Number(finalQtyStr) <= 0) {
      finalQtyStr = String(minQtyStr);
    }

    if (Number(finalQtyStr) * refPrice < 0.1) {
      const neededMin = Math.max(Number(minQtyStr) || 0, (0.12 / refPrice));
      finalQtyStr = formatTickValue(neededMin * 1.15, tickStr, minQtyStr) || String(minQtyStr);
    }

    const finalQuote = await varApi('/api/quotes/indicative', {
      method: 'POST',
      body: { instrument: inst, qty: finalQtyStr }
    });

    const execPrice = Number(side === 'buy' ? (finalQuote.ask || finalQuote.mark_price) : (finalQuote.bid || finalQuote.mark_price)) || refPrice;
    return { quote: finalQuote, qtyStr: finalQtyStr, execPrice };
  }

  async function executeEntrySignal(signal, snapshot, cfg) {
    assertSafetyLock(snapshot, cfg, true);
    const inst = getVariationalInstrument(signal.symbol);

    // 주문 직전 거래소 실시간 포지션을 재조회해 1종목 중복 진입 및 3분할 슬롯 초과 원천 차단
    const freshSnapshot = await readWalletSnapshot();
    const activePositions = (freshSnapshot.loggedIn ? freshSnapshot.positions : snapshot?.positions) || [];
    if (activePositions.some((p) => p.symbol === inst.underlying && Math.abs(p.qty) > 0)) {
      throw new Error(`중복 진입 차단: 거래소에 이미 ${inst.underlying} 포지션이 열려 있습니다.`);
    }
    const maxSlots = Math.max(1, Number(cfg?.maxSlots || 3));
    if (activePositions.length >= maxSlots) {
      throw new Error(`슬롯 상한 차단: 거래소 열린 포지션(${activePositions.length}개)이 최대 ${maxSlots}분할 슬롯에 도달했습니다.`);
    }

    const side = String(signal.direction || '').toUpperCase() === 'SHORT' ? 'sell' : 'buy';
    const leverage = Math.max(1, Math.min(50, Math.round(Number(signal.leverage || 10))));
    const marginUsd = Number(signal.marginUsd || cfg?.orderMarginUsd || 30);
    const notionalUsd = marginUsd * leverage;
    const slippageDecimal = Math.max(0.001, Math.min(0.05, Number(cfg?.maxSlippageBps || 100) / 10000));

    await varApi('/api/settlement_pools/set_leverage', {
      method: 'POST',
      body: { asset: inst.underlying, leverage: String(leverage) }
    });

    const { quote, qtyStr, execPrice } = await buildValidatedQuote(
      inst,
      side,
      notionalUsd,
      Number(signal.entryPriceUsd || signal.estPriceUsd || 0)
    );

    const payload = {
      quote_id: quote.quote_id,
      side,
      max_slippage: slippageDecimal,
      is_reduce_only: false
    };

    const tpStr = formatPrice(signal.takeProfitUsd);
    const slStr = formatPrice(signal.stopLossUsd);
    if (tpStr) {
      payload.take_profit = tpStr;
      payload.tp_is_auto_resize = true;
      payload.tp_use_mark_price = true;
      payload.tp_slippage_limit = '0.01';
    }
    if (slStr) {
      payload.stop_loss = slStr;
      payload.sl_is_auto_resize = true;
      payload.sl_use_mark_price = true;
      payload.sl_slippage_limit = '0.01';
    }

    const orderRes = await varApi('/api/orders/new/market', {
      method: 'POST',
      body: payload
    });

    return {
      ok: true,
      symbol: inst.underlying,
      direction: side === 'sell' ? 'SHORT' : 'LONG',
      rfqId: orderRes?.rfq_id || quote.quote_id,
      qty: Number(qtyStr),
      qtyStr,
      entryPriceUsd: execPrice,
      marginUsd,
      notionalUsd: Number(qtyStr) * execPrice
    };
  }

  async function executeExitSignal(signal, snapshot, cfg) {
    assertSafetyLock(snapshot, cfg, true);
    const inst = getVariationalInstrument(signal.symbol);
    const pos = (snapshot.positions || []).find((p) => p.symbol === inst.underlying && Math.abs(p.qty) > 0);
    if (!pos) {
      return {
        ok: true,
        symbol: inst.underlying,
        alreadyClosedOnVenue: true,
        exitPriceUsd: Number(signal.exitPriceUsd || 0)
      };
    }

    const closeSide = pos.qty > 0 ? 'sell' : 'buy';
    const absQtyStr = pos.rawQty.replace(/^-/, '').trim();
    const slippageDecimal = Math.max(0.01, Math.min(0.05, Number(cfg?.maxSlippageBps || 100) / 10000));

    const quote = await varApi('/api/quotes/indicative', {
      method: 'POST',
      body: { instrument: inst, qty: absQtyStr }
    });

    const acceptRes = await varApi('/api/quotes/accept', {
      method: 'POST',
      body: {
        quote_id: quote.quote_id,
        side: closeSide,
        max_slippage: slippageDecimal,
        is_reduce_only: true
      }
    });

    const exitPriceUsd = Number(closeSide === 'sell' ? (quote.bid || quote.mark_price) : (quote.ask || quote.mark_price)) || Number(signal.exitPriceUsd || 0);
    return {
      ok: true,
      symbol: inst.underlying,
      alreadyClosedOnVenue: false,
      rfqId: acceptRes?.rfq_id || quote.quote_id,
      exitPriceUsd,
      closedQty: absQtyStr
    };
  }

  async function executeTestRoundtripSignal(signal, snapshot, cfg) {
    assertSafetyLock(snapshot, cfg, true);
    const inst = getVariationalInstrument(signal.symbol || 'BTC');
    const notionalUsd = Math.max(1.0, Math.min(20, Number(signal.notionalUsd || 1.5)));

    await varApi('/api/settlement_pools/set_leverage', {
      method: 'POST',
      body: { asset: inst.underlying, leverage: '10' }
    });

    const openBuilt = await buildValidatedQuote(inst, 'buy', notionalUsd, 90000);
    const openOrder = await varApi('/api/orders/new/market', {
      method: 'POST',
      body: {
        quote_id: openBuilt.quote.quote_id,
        side: 'buy',
        max_slippage: 0.01,
        is_reduce_only: false
      }
    });

    await new Promise((r) => setTimeout(r, 1400));

    const refreshed = await readWalletSnapshot();
    const activePos = (refreshed.positions || []).find((p) => p.symbol === inst.underlying && Math.abs(p.qty) > 0);
    const closeQtyStr = activePos ? activePos.rawQty.replace(/^-/, '') : openBuilt.qtyStr;
    const closeSide = activePos && activePos.qty < 0 ? 'buy' : 'sell';

    const closeQuote = await varApi('/api/quotes/indicative', {
      method: 'POST',
      body: { instrument: inst, qty: closeQtyStr }
    });
    const closeOrder = await varApi('/api/quotes/accept', {
      method: 'POST',
      body: {
        quote_id: closeQuote.quote_id,
        side: closeSide,
        max_slippage: 0.01,
        is_reduce_only: true
      }
    });

    const exitPrice = Number(closeSide === 'sell' ? (closeQuote.bid || closeQuote.mark_price) : (closeQuote.ask || closeQuote.mark_price)) || openBuilt.execPrice;
    return {
      ok: true,
      symbol: inst.underlying,
      qty: Number(closeQtyStr),
      entryPrice: openBuilt.execPrice,
      exitPrice,
      openRfqId: openOrder?.rfq_id || openBuilt.quote.quote_id,
      closeRfqId: closeOrder?.rfq_id || closeQuote.quote_id
    };
  }

  async function processSignal(signal, snapshot, cfg) {
    const signalId = String(signal?.signalId || '');
    if (!signalId || executedSignalIds.has(signalId)) return;
    executedSignalIds.add(signalId);
    if (executedSignalIds.size > 200) {
      const oldest = executedSignalIds.values().next().value;
      executedSignalIds.delete(oldest);
    }

    lastActionNote = `신호 실행중 (${signal.type} ${signal.symbol || ''})`;
    updateStatusBar(snapshot, lastServerStatus, true);

    let ackBody = { signalId, type: signal.type, symbol: signal.symbol };
    try {
      let result = null;
      if (signal.type === 'ENTRY') {
        result = await executeEntrySignal(signal, snapshot, cfg);
      } else if (signal.type === 'EXIT') {
        result = await executeExitSignal(signal, snapshot, cfg);
      } else if (signal.type === 'TEST_ROUNDTRIP') {
        result = await executeTestRoundtripSignal(signal, snapshot, cfg);
      } else {
        throw new Error(`알 수 없는 신호 유형: ${signal.type}`);
      }
      ackBody = { ...ackBody, ok: true, result };
      lastActionNote = `체결 완료 (${signal.type} ${result.symbol})`;
    } catch (err) {
      ackBody = { ...ackBody, ok: false, error: err?.message || '주문 실행 오류' };
      lastActionNote = `실행 오류: ${ackBody.error.slice(0, 40)}`;
    }

    await relayToServer('/api/live/edge-ack', 'POST', ackBody);
    updateStatusBar(snapshot, lastServerStatus, true);
  }

  function ensureStatusBar() {
    let el = document.getElementById('var-edge-bridge-bar');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'var-edge-bridge-bar';
    el.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:2147483647',
      'background:rgba(15,23,42,0.94)',
      'color:#e2e8f0',
      'border:1px solid rgba(56,189,248,0.45)',
      'border-radius:10px',
      'padding:10px 13px',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'font-size:11px',
      'line-height:1.45',
      'box-shadow:0 10px 25px rgba(0,0,0,0.45)',
      'max-width:300px',
      'pointer-events:auto'
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function updateStatusBar(snapshot, status, serverOk) {
    if (!document.body) return;
    const bar = ensureStatusBar();
    const isLocal = serverUrl.includes('localhost');
    const targetLabel = isLocal ? 'LOCAL:3000' : 'RENDER 24H';
    const modeLabel = status?.enabled ? 'LIVE AUTO' : 'PAPER LOCKED';
    const modeColor = status?.enabled ? '#34d399' : '#fbbf24';
    const connColor = serverOk && snapshot?.loggedIn ? '#38bdf8' : '#f87171';
    const walletTxt = snapshot?.loggedIn
      ? `${shortAddr(snapshot.address)} ($${Number(snapshot.balanceUsd || 0).toFixed(2)})`
      : '지갑 미로그인';
    const safetyTxt = status?.safetyError ? `<div style="color:#fda4af;margin-top:3px;">[안전차단] ${status.safetyError}</div>` : '';

    bar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px;">
        <span style="font-weight:700;color:${connColor};">GROK BRIDGE · ${targetLabel}</span>
        <span style="font-weight:700;color:${modeColor};border:1px solid ${modeColor};padding:1px 5px;border-radius:4px;font-size:10px;">${modeLabel}</span>
      </div>
      <div style="color:#cbd5e1;">계정: ${walletTxt}</div>
      <div style="color:#94a3b8;">포지션: ${(snapshot?.positions || []).length}개 · 상태: ${lastActionNote}</div>
      ${safetyTxt}
    `;
  }

  async function runHeartbeat() {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const snapshot = await readWalletSnapshot();
      const resp = await relayToServer('/api/live/edge-heartbeat', 'POST', {
        loggedIn: snapshot.loggedIn,
        address: snapshot.address,
        balanceUsd: snapshot.balanceUsd,
        upnlUsd: snapshot.upnlUsd,
        marginUsage: snapshot.marginUsage,
        positions: snapshot.positions,
        pageUrl: location.href,
        sentAt: Date.now()
      });

      if (resp?.ok && resp?.data) {
        lastServerStatus = resp.data.status || lastServerStatus;
        if (!resp.data.signals || resp.data.signals.length === 0) {
          lastActionNote = snapshot.loggedIn ? '정상 동기화' : '로그인 대기';
        }
        updateStatusBar(snapshot, lastServerStatus, true);

        const signals = Array.isArray(resp.data.signals) ? resp.data.signals : [];
        const cfg = resp.data.config || lastServerStatus || {};
        for (const sig of signals) {
          await processSignal(sig, snapshot, cfg);
        }
      } else {
        lastActionNote = resp?.data?.error ? `통신 실패 (${resp.data.error.slice(0, 24)})` : '서버 연결 대기';
        updateStatusBar(snapshot, lastServerStatus, false);
      }
    } catch (err) {
      lastActionNote = `오류 (${String(err?.message || '').slice(0, 28)})`;
      updateStatusBar(null, lastServerStatus, false);
    } finally {
      heartbeatBusy = false;
    }
  }

  chrome.storage.local.get(['serverUrl'], (stored) => {
    if (stored?.serverUrl) {
      serverUrl = String(stored.serverUrl).replace(/\/+$/, '');
    }
    runHeartbeat();
    heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.serverUrl?.newValue) {
      serverUrl = String(changes.serverUrl.newValue).replace(/\/+$/, '');
      lastActionNote = '서버 전환됨';
      runHeartbeat();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
})();
