'use client';
import { useEffect, useRef } from 'react';
import { SiteNav } from '@/components/shared/SiteNav';
import { useWallet, getEVMProvider } from '@/lib/wallet';
import { walletAuth as signAction } from '@/lib/wallet-auth';

const PAGE_CSS = `
main{max-width:600px;margin:0 auto;padding:0 24px 60px;padding-top:calc(40px + 8px)}
.page-hdr{margin-bottom:24px}
.exec-btn{width:100%;padding:13px;font-size:13px;font-weight:700;border-radius:8px;border:none;cursor:pointer;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:8px;letter-spacing:.03em;font-family:inherit}
.exec-btn.hl{background:var(--accent,#50d2c1);color:#0f1a1e}
.exec-btn.as{background:#f59e0b;color:#1a1044}
.exec-btn.lifi{background:var(--accent,#50d2c1);color:#0f1a1e}
.exec-btn:disabled{opacity:.4;cursor:not-allowed}
.exec-btn:not(:disabled):hover{opacity:.88}
.status{padding:10px 13px;border-radius:6px;font-size:12px;margin-top:12px;display:none;line-height:1.6}
.status.ok{background:rgba(31,166,125,.08);border:1px solid rgba(31,166,125,.22);color:#1fa67d}
.status.err{background:rgba(237,112,136,.08);border:1px solid rgba(237,112,136,.2);color:#ed7088}
.status.inf{background:rgba(80,210,193,.06);border:1px solid rgba(80,210,193,.16);color:#50d2c1}
.prog-list{display:flex;flex-direction:column;margin-top:4px}
.prog-item{display:flex;gap:12px;position:relative;padding-bottom:16px}
.prog-item:last-child{padding-bottom:0}
.prog-item:not(:last-child)::before{content:'';position:absolute;left:9px;top:21px;bottom:0;width:1px;background:#1f1f1f}
.prog-dot{width:20px;height:20px;border-radius:50%;border:2px solid #1f1f1f;background:#161616;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#878c8f;position:relative;z-index:1;transition:border-color .25s,background .25s}
.prog-dot.spin{border-color:#50d2c1;border-top-color:transparent;animation:pdot-spin .7s linear infinite}
.prog-dot.ok{border-color:#1fa67d;background:rgba(31,166,125,.15);color:#1fa67d}
.prog-dot.fail{border-color:#ed7088;background:rgba(237,112,136,.12);color:#ed7088}
@keyframes pdot-spin{to{transform:rotate(360deg)}}
.prog-body{flex:1;padding-top:2px}
.prog-label{font-size:12px;font-weight:600;color:#c8d2d6;margin-bottom:2px}
.prog-msg{font-size:11px;color:#878c8f;min-height:15px;transition:color .2s}
.prog-msg.go{color:#50d2c1}
.prog-msg.ok{color:#1fa67d}
.prog-msg.fail{color:#ed7088}
.api-note{font-size:10px;color:#878c8f;margin-bottom:16px}
.lang-wrap{position:relative}
.lang-btn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:transparent;border:1px solid #1f1f1f;border-radius:4px;color:#878c8f;cursor:pointer}
.lang-dropdown{position:absolute;top:calc(100% + 6px);right:0;z-index:900;background:#0d0d0d;border:1px solid #1f1f1f;border-radius:4px;padding:4px 0;min-width:110px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:none}
.lang-option{display:block;width:100%;padding:7px 14px;border:none;background:transparent;color:#878c8f;font-size:12px;text-align:left;cursor:pointer;font-family:inherit}
`;

export default function TransferPage() {
  const { evmAddress } = useWallet();
  const evmAddressRef = useRef(evmAddress);
  evmAddressRef.current = evmAddress;
  // Bridges the shared wallet Context into this page's vanilla-DOM effect
  // closure below — onConnected (defined inside that effect) does the
  // actual UI update, this just lets a SEPARATE effect (reacting to
  // evmAddress changes, e.g. connecting from the nav after this page is
  // already mounted) invoke it without re-running the whole one-time setup.
  const onConnectedRef = useRef<((addr: string) => void) | null>(null);

  useEffect(() => {
    if (evmAddress) onConnectedRef.current?.(evmAddress);
  }, [evmAddress]);

  useEffect(() => {
    const CHAINS = [
      {id:'42161', name:'Arbitrum', tokens:[
        {sym:'ETH',   addr:'0x0000000000000000000000000000000000000000', dec:18},
        {sym:'USDC',  addr:'0xaf88d065e77c8cc2239327c5edb3a432268e5831', dec:6},
        {sym:'USDT',  addr:'0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', dec:6},
        {sym:'ARB',   addr:'0x912ce59144191c1204e64559fe8253a0e49e6548', dec:18},
        {sym:'WBTC',  addr:'0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', dec:8},
      ]},
      {id:'1', name:'Ethereum', tokens:[
        {sym:'ETH',   addr:'0x0000000000000000000000000000000000000000', dec:18},
        {sym:'USDC',  addr:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', dec:6},
        {sym:'USDT',  addr:'0xdac17f958d2ee523a2206206994597c13d831ec7', dec:6},
        {sym:'WBTC',  addr:'0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', dec:8},
      ]},
      {id:'8453', name:'Base', tokens:[
        {sym:'ETH',   addr:'0x0000000000000000000000000000000000000000', dec:18},
        {sym:'USDC',  addr:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', dec:6},
        {sym:'cbBTC', addr:'0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', dec:8},
      ]},
      {id:'10', name:'Optimism', tokens:[
        {sym:'ETH',   addr:'0x0000000000000000000000000000000000000000', dec:18},
        {sym:'USDC',  addr:'0x0b2c639c533813f4aa9d7837caf62653d097ff85', dec:6},
        {sym:'USDT',  addr:'0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', dec:6},
        {sym:'OP',    addr:'0x4200000000000000000000000000000000000042', dec:18},
      ]},
      {id:'137', name:'Polygon', tokens:[
        {sym:'POL',   addr:'0x0000000000000000000000000000000000000000', dec:18},
        {sym:'USDC',  addr:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', dec:6},
        {sym:'USDT',  addr:'0xc2132d05d31c914a87c6611c10748aeb04b58e8f', dec:6},
        {sym:'WBTC',  addr:'0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', dec:8},
      ]},
      {id:'56', name:'BNB Chain', tokens:[
        {sym:'BNB',   addr:'0x0000000000000000000000000000000000000000', dec:18},
        {sym:'USDT',  addr:'0x55d398326f99059ff775485246999027b3197955', dec:18},
        {sym:'USDC',  addr:'0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', dec:18},
        {sym:'ETH',   addr:'0x2170ed0880ac9a755fd29b2688956bd959f933f8', dec:18},
      ]},
      {id:'43114', name:'Avalanche', tokens:[
        {sym:'AVAX',  addr:'0x0000000000000000000000000000000000000000', dec:18},
        {sym:'USDC',  addr:'0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', dec:6},
        {sym:'USDT',  addr:'0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', dec:6},
      ]},
    ];

    const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
    const USDT_ARB = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
    const HL       = '/hl';
    // Hyperliquid Bridge2 on Arbitrum. A deposit is a plain ERC-20 transfer of
    // NATIVE USDC to this address, credited to the sending EOA in ~1 min.
    // Anything under 5 USDC is swallowed, not refunded — hence HL_MIN_DEPOSIT.
    const HL_BRIDGE = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7';
    const HL_MIN_DEPOSIT = BigInt(5_000_000); // 5 USDC, 6 decimals

    const el    = (id: string): HTMLElement | null => document.getElementById(id);
    const set   = (id: string, v: string) => { const e = el(id); if (e) e.textContent = v; };
    const fmt   = (n: number, d = 2) => Number(n).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d});
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    let wdSrc    = 'hl';
    let dpDest   = 'hl';
    let credsSaved = false;
    let btwDir   = 'hl-to-aster';
    let hlEquity = 0;
    let curQuote: any  = null;
    let qTimer: any   = null;
    let progPfx  = 'wd';
    let curStep  = -1;

    function setTab(t: string) {
      ['withdraw','deposit','swap','send','between'].forEach((n, i) => {
        const tabEl = el('tab-'+n);
        if (tabEl) tabEl.style.display = n === t ? '' : 'none';
        const tabs = document.querySelectorAll('.xfr-tab');
        if (tabs[i]) tabs[i].classList.toggle('active', n === t);
      });
    }

    function getProv() { return getEVMProvider(); }

    // Connection itself now lives in the nav (SiteNav / lib/wallet's
    // WalletProvider) — this just reads whatever it already resolved via
    // evmAddressRef, rather than prompting its own eth_requestAccounts.
    async function requireEVM() {
      const addr = evmAddressRef.current;
      if (!addr) throw new Error('Connect your wallet from the top nav first.');
      return addr;
    }

    function onConnected(addr: string) {
      const s = addr.slice(0,8) + '…' + addr.slice(-6);
      const wdDest = el('wd-dest') as HTMLInputElement | null;
      if (wdDest) wdDest.placeholder = addr + ' (connected)';
      set('wd-bal', 'Connected: ' + s);
      loadHLEquity(addr);
      refreshCreds(addr);
    }
    onConnectedRef.current = onConnected;

    async function loadHLEquity(addr: string) {
      try {
        const r = await fetch(HL+'/info', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'clearinghouseState', user:addr})});
        const d = await r.json();
        // Prefer marginSummary (account-wide total incl. isolated); crossMarginSummary
        // is all-zeros for isolated-margin accounts, which zeroed the HL balance.
        const ms = d.marginSummary || d.crossMarginSummary || {};
        hlEquity = parseFloat(ms.accountValue ?? 0);
        if (wdSrc === 'hl') set('wd-bal', `Balance: $${fmt(hlEquity)} USDC`);
        if (btwDir === 'hl-to-aster') set('btw-bal', `Balance: $${fmt(hlEquity)} USDC`);
      } catch {}
    }

    function setWdSrc(src: string) {
      wdSrc = src;
      const isHL = src === 'hl';
      el('wd-btn-hl')?.classList.toggle('active', isHL);
      el('wd-btn-as')?.classList.toggle('active', !isHL);
      const amtWrap = el('wd-amt-wrap'); if (amtWrap) amtWrap.className = 'amt-wrap' + (isHL ? '' : ' af');
      const execBtn = el('wd-exec-btn'); if (execBtn) execBtn.className = 'exec-btn ' + (isHL ? 'hl' : 'as');
      set('wd-from-cur', isHL ? 'USDC' : 'USDT');
      set('wd-bal', isHL && hlEquity ? `Balance: $${fmt(hlEquity)} USDC` : ' ');
      fillTokenSel('wd-to-token', '42161', isHL ? 'USDC' : 'USDT');
      updateWdConvHint();
    }

    function onWdAmtInput() {
      const wdAmt = el('wd-amt') as HTMLInputElement | null;
      const a = parseFloat(wdAmt?.value || '0') || 0;
      if (wdSrc === 'hl') {
        set('wd-bal', a && hlEquity
          ? `Balance: $${fmt(hlEquity)} USDC  ·  After: $${fmt(Math.max(0, hlEquity - a))}`
          : evmAddressRef.current ? `Balance: $${fmt(hlEquity)} USDC` : 'Connect wallet to see balance');
      }
    }

    function wdMax() {
      const wdAmt = el('wd-amt') as HTMLInputElement | null;
      if (wdSrc === 'hl' && hlEquity > 0 && wdAmt) { wdAmt.value = hlEquity.toFixed(2); onWdAmtInput(); }
    }

    function onWdToChainChange() {
      const chainEl = el('wd-to-chain') as HTMLSelectElement | null;
      fillTokenSel('wd-to-token', chainEl?.value || '42161', selSym('wd-to-token'));
      updateWdConvHint();
    }

    function updateWdConvHint() {
      const srcToken = wdSrc === 'hl' ? USDC_ARB : USDT_ARB;
      const toTokenEl = el('wd-to-token') as HTMLSelectElement | null;
      const toChainEl = el('wd-to-chain') as HTMLSelectElement | null;
      const toToken = toTokenEl?.value;
      const toChain = toChainEl?.value;
      const toSym   = selSym('wd-to-token');
      const hint    = el('wd-conv-hint');
      if (!hint) return;
      if (toToken === srcToken && toChain === '42161') {
        hint.style.color = 'var(--text3,#878c8f)';
        hint.textContent = 'Direct withdrawal — arrives as-is on Arbitrum';
      } else {
        hint.style.color = 'var(--accent,#50d2c1)';
        hint.textContent = `LI.FI will convert to ${toSym} after the withdrawal lands`;
      }
    }

    async function execWithdraw() {
      const wdAmt = el('wd-amt') as HTMLInputElement | null;
      const wdDest = el('wd-dest') as HTMLInputElement | null;
      const amt  = parseFloat(wdAmt?.value || '0') || 0;
      const dest = wdDest?.value.trim() || '';
      if (!amt) return showSt('wd-st', 'err', 'Enter an amount');
      const btn = el('wd-exec-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      const st = el('wd-st'); if (st) st.style.display = 'none';
      try {
        const user     = await requireEVM();
        const prov     = getProv();
        const destAddr = dest || user;
        const toChainEl = el('wd-to-chain') as HTMLSelectElement | null;
        const toTokenEl = el('wd-to-token') as HTMLSelectElement | null;
        const toChain  = toChainEl?.value || '42161';
        const toToken  = toTokenEl?.value || '';
        const toSym    = selSym('wd-to-token');
        const srcToken = wdSrc === 'hl' ? USDC_ARB : USDT_ARB;
        const isSame   = toToken === srcToken && toChain === '42161';
        const destShort = destAddr === user ? 'your wallet' : destAddr.slice(0,10) + '…';

        if (wdSrc === 'hl') {
          if (isSame) {
            initProg('wd', ['Withdraw USDC from Hyperliquid']);
            stepSet(0, 'active', 'Sign withdrawal in wallet…');
            await hlWithdrawRaw(prov, user, amt, destAddr);
            stepSet(0, 'done', `$${fmt(amt)} USDC → ${destShort} (~2 min)`);
          } else {
            initProg('wd', [
              'Withdraw USDC from Hyperliquid',
              'Wait for USDC on Arbitrum (~2 min)',
              `Convert USDC → ${toSym} via LI.FI`,
            ]);
            stepSet(0, 'active', 'Sign withdrawal in wallet…');
            await hlWithdrawRaw(prov, user, amt, user);
            stepSet(0, 'done', `$${fmt(amt)} USDC submitted to Arbitrum`);
            stepSet(1, 'active', 'Polling balance every 12s…');
            const before = await getERC20Bal(prov, USDC_ARB, user);
            await pollBal(prov, USDC_ARB, user, BigInt(Math.round(amt*1e6*0.97)), before, 360000);
            stepSet(1, 'done', 'USDC arrived in wallet');
            stepSet(2, 'active', `Getting LI.FI route to ${toSym}…`);
            const bal = await getERC20Bal(prov, USDC_ARB, user);
            const q = await lifiQuote('42161', toChain, USDC_ARB, toToken, bal.toString(), user, destAddr);
            stepSet(2, 'active', 'Approve + convert — confirm in wallet…');
            const h = await lifiExec(prov, q, user);
            stepSet(2, 'active', 'Confirming…');
            await pollReceipt(prov, h);
            stepSet(2, 'done', `${toSym} sent to ${destShort}`);
          }
        } else {
          if (!requireCreds('wd-st')) { if (btn) btn.disabled = false; return; }
          if (isSame) {
            initProg('wd', ['Withdraw USDT from Aster']);
            stepSet(0, 'active', 'Signing and submitting…');
            await asterWithdrawRaw(amt, destAddr);
            stepSet(0, 'done', `${fmt(amt)} USDT → ${destShort}`);
          } else {
            initProg('wd', [
              'Withdraw USDT from Aster',
              'Wait for USDT in wallet',
              `Convert USDT → ${toSym} via LI.FI`,
            ]);
            stepSet(0, 'active', 'Signing Aster withdrawal…');
            await asterWithdrawRaw(amt, user);
            stepSet(0, 'done', `${fmt(amt)} USDT withdrawal submitted`);
            stepSet(1, 'active', 'Polling every 12s…');
            const before = await getERC20Bal(prov, USDT_ARB, user);
            await pollBal(prov, USDT_ARB, user, BigInt(Math.round(amt*1e6*0.97)), before, 600000);
            stepSet(1, 'done', 'USDT arrived in wallet');
            stepSet(2, 'active', `Getting LI.FI route to ${toSym}…`);
            const bal = await getERC20Bal(prov, USDT_ARB, user);
            const q = await lifiQuote('42161', toChain, USDT_ARB, toToken, bal.toString(), user, destAddr);
            stepSet(2, 'active', 'Approve + convert — confirm in wallet…');
            const h = await lifiExec(prov, q, user);
            stepSet(2, 'active', 'Confirming…');
            await pollReceipt(prov, h);
            stepSet(2, 'done', `${toSym} sent to ${destShort}`);
          }
        }
        showSt('wd-st', 'ok', 'Withdrawal complete ✓');
        if (wdAmt) wdAmt.value = '';
      } catch (e: any) {
        stepFail(e.code === 4001 ? 'Rejected by wallet' : e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function setDpDest(d: string) {
      dpDest = d;
      const isHL = d === 'hl';
      el('dp-btn-hl')?.classList.toggle('active', isHL);
      el('dp-btn-as')?.classList.toggle('active', !isHL);
      const amtWrap = el('dp-amt-wrap'); if (amtWrap) amtWrap.className = 'amt-wrap' + (isHL ? '' : ' af');
      const btn = el('dp-btn'); if (btn) btn.className = 'exec-btn ' + (isHL ? 'hl' : 'as');
      const chain = (el('dp-from-chain') as HTMLSelectElement | null)?.value || '42161';
      fillTokenSel('dp-from-token', chain, isHL ? 'USDC' : 'USDT');
      updateDpHint();
    }

    function onDpFromChainChange() {
      const chainEl = el('dp-from-chain') as HTMLSelectElement | null;
      fillTokenSel('dp-from-token', chainEl?.value || '42161', selSym('dp-from-token'));
      updateDpHint();
    }

    function dpTarget() { return dpDest === 'hl' ? USDC_ARB : USDT_ARB; }

    // Deposits always land as the venue's own token on Arbitrum: native USDC
    // for HL's bridge, USDT for Aster's deposit address. Anything else routes
    // through LI.FI first — so the wallet holds the right asset before the
    // final transfer, which is what actually credits the account.
    function dpIsDirect() {
      const chain = (el('dp-from-chain') as HTMLSelectElement | null)?.value || '42161';
      const token = ((el('dp-from-token') as HTMLSelectElement | null)?.value || '').toLowerCase();
      return chain === '42161' && token === dpTarget().toLowerCase();
    }

    function updateDpHint() {
      set('dp-cur', selSym('dp-from-token'));
      const hint = el('dp-hint'); if (!hint) return;
      const isHL = dpDest === 'hl';
      if (dpIsDirect()) {
        hint.style.color = 'var(--text3,#878c8f)';
        hint.textContent = isHL
          ? 'Direct transfer to the Hyperliquid bridge — credited in ~1 min (min 5 USDC)'
          : 'Direct transfer to your Aster deposit address';
      } else {
        hint.style.color = 'var(--accent,#50d2c1)';
        hint.textContent = `LI.FI converts to ${isHL ? 'USDC' : 'USDT'} on Arbitrum first, then deposits`;
      }
    }

    async function execDeposit() {
      const dpAmt = el('dp-amt') as HTMLInputElement | null;
      const amt = parseFloat(dpAmt?.value || '0') || 0;
      if (!amt) return showSt('dp-st', 'err', 'Enter an amount');
      const toHL   = dpDest === 'hl';
      const tgt    = dpTarget();
      const tgtSym = toHL ? 'USDC' : 'USDT';
      if (!toHL && !requireCreds('dp-st')) return;
      const fromChain = (el('dp-from-chain') as HTMLSelectElement | null)?.value || '42161';
      const fromToken = (el('dp-from-token') as HTMLSelectElement | null)?.value || '';
      const fromSym   = selSym('dp-from-token');
      const fromDec   = selDec('dp-from-token');
      const direct    = dpIsDirect();
      const btn = el('dp-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      const st = el('dp-st'); if (st) st.style.display = 'none';
      const labels = direct ? [] : [
        `Convert ${fromSym} → ${tgtSym} on Arbitrum via LI.FI`,
        `Wait for ${tgtSym} in wallet`,
      ];
      labels.push(toHL ? 'Send USDC to the Hyperliquid bridge' : 'Send USDT to your Aster deposit address');
      initProg('dp', labels);
      try {
        const user = await requireEVM();
        const prov = getProv();
        let sendAmt: bigint;
        if (direct) {
          sendAmt = BigInt(Math.round(amt * 10 ** fromDec));
          const bal = await getERC20Bal(prov, tgt, user);
          if (bal < sendAmt) throw new Error(`Wallet holds only ${fmt(Number(bal) / 1e6)} ${tgtSym}`);
        } else {
          stepSet(0, 'active', 'Getting LI.FI route…');
          const q = await lifiQuote(fromChain, '42161', fromToken, tgt,
            BigInt(Math.round(amt * 10 ** fromDec)).toString(), user, user);
          const before = await getERC20Bal(prov, tgt, user);
          stepSet(0, 'active', 'Approve + convert — confirm in wallet…');
          const h = await lifiExec(prov, q, user);
          stepSet(0, 'active', 'Confirming…');
          await pollReceipt(prov, h);
          stepSet(0, 'done', `${fromSym} → ${tgtSym} submitted`);
          stepSet(1, 'active', 'Polling every 12s…');
          // 3% under the quote: bridges settle slightly below the estimate,
          // and waiting for the exact figure would hang forever.
          const expect = BigInt(q.estimate?.toAmount ?? '0') * BigInt(97) / BigInt(100);
          const after = await pollBal(prov, tgt, user, expect, before, 600000);
          // Forward only what this conversion delivered — never the wallet's
          // whole balance.
          sendAmt = after - before;
          stepSet(1, 'done', `${fmt(Number(sendAmt) / 1e6)} ${tgtSym} arrived`);
        }
        const last = labels.length - 1;
        if (toHL && sendAmt < HL_MIN_DEPOSIT)
          throw new Error('Hyperliquid ignores deposits under 5 USDC — it would be lost. Funds are still in your wallet.');
        let dest = HL_BRIDGE;
        if (!toHL) {
          stepSet(last, 'active', 'Getting Aster deposit address…');
          const dep = await asterDepositAddr();
          if (!dep) throw new Error('Could not fetch the Aster deposit address — check your API credentials');
          dest = dep;
        }
        stepSet(last, 'active', `Sending ${fmt(Number(sendAmt) / 1e6)} ${tgtSym} — confirm in wallet…`);
        const dh = await erc20Send(prov, tgt, user, dest, sendAmt.toString());
        await pollReceipt(prov, dh);
        stepSet(last, 'done', toHL ? 'Sent — Hyperliquid credits it in ~1 min' : 'Sent to Aster ✓');
        showSt('dp-st', 'ok', 'Deposit complete ✓');
        if (dpAmt) dpAmt.value = '';
      } catch (e: any) {
        stepFail(e.code === 4001 ? 'Rejected by wallet' : e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    // ── Swap (1inch, same-chain) ──────────────────────────────────────────────
    // Deliberately NOT using /swap/tokens: that returns thousands of tokens per
    // chain and would need a searchable picker to be usable, while CHAINS above
    // already lists the ones this app actually deals in. Swap the source if
    // someone needs a long tail.
    // 1inch addresses native gas tokens with this sentinel, not the zero address.
    const NATIVE_1INCH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const ZERO_ADDR    = '0x0000000000000000000000000000000000000000';
    const swapAddr = (a: string) => (a.toLowerCase() === ZERO_ADDR ? NATIVE_1INCH : a);

    let swQuote: any = null;
    let swTimer: any = null;

    function onSwChainChange() {
      const c = (el('sw-chain') as HTMLSelectElement | null)?.value || '42161';
      fillTokenSel('sw-from', c, selSym('sw-from'));
      fillTokenSel('sw-to', c, selSym('sw-to'));
      scheduleSwQuote();
    }

    function swFlip() {
      const from = el('sw-from') as HTMLSelectElement | null;
      const to   = el('sw-to') as HTMLSelectElement | null;
      if (!from || !to) return;
      const f = from.value; from.value = to.value; to.value = f;
      scheduleSwQuote();
    }

    function scheduleSwQuote() {
      clearTimeout(swTimer);
      swQuote = null;
      const btn = el('sw-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      set('sw-cur', selSym('sw-from'));
      const amt = parseFloat((el('sw-amt') as HTMLInputElement | null)?.value || '0') || 0;
      const wrap = el('sw-quote-wrap');
      if (!amt) { if (wrap) wrap.style.display = 'none'; return; }
      swTimer = setTimeout(fetchSwQuote, 650);
    }

    async function fetchSwQuote() {
      const chain = (el('sw-chain') as HTMLSelectElement | null)?.value || '42161';
      const src   = (el('sw-from') as HTMLSelectElement | null)?.value || '';
      const dst   = (el('sw-to') as HTMLSelectElement | null)?.value || '';
      const amt   = parseFloat((el('sw-amt') as HTMLInputElement | null)?.value || '0') || 0;
      if (!amt) return;
      if (src.toLowerCase() === dst.toLowerCase()) return showSt('sw-st', 'err', 'Pick two different tokens');
      const wrap = el('sw-quote-wrap'); if (wrap) wrap.style.display = '';
      const card = el('sw-qcard'); if (card) card.className = 'quote-card loading';
      const skel = el('sw-skel'); if (skel) skel.style.display = '';
      const body = el('sw-qbody'); if (body) body.style.display = 'none';
      try {
        const p = new URLSearchParams({
          chainId: chain,
          src: swapAddr(src),
          dst: swapAddr(dst),
          amount: BigInt(Math.round(amt * 10 ** selDec('sw-from'))).toString(),
          ...(evmAddressRef.current ? {from: evmAddressRef.current} : {}),
        });
        const r = await fetch('/swap/quote?' + p);
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(swapErr(d, r.status));
        const out = Number(d.dstAmount ?? d.toAmount ?? 0) / 10 ** selDec('sw-to');
        swQuote = {chain, src, dst, amt};
        set('sw-recv-amt', fmt(out, out < 1 ? 6 : 4));
        set('sw-recv-sym', selSym('sw-to'));
        set('sw-rate', `1 ${selSym('sw-from')} ≈ ${fmt(out / amt, out / amt < 1 ? 6 : 4)} ${selSym('sw-to')}`);
        if (card) card.className = 'quote-card';
        if (skel) skel.style.display = 'none';
        if (body) body.style.display = '';
        const btn = el('sw-btn') as HTMLButtonElement | null;
        if (btn) btn.disabled = !evmAddressRef.current;
      } catch (e: any) {
        if (card) card.className = 'quote-card error';
        if (skel) skel.style.display = 'none';
        if (body) body.style.display = '';
        set('sw-recv-amt', e.message); set('sw-recv-sym', ''); set('sw-rate', '');
      }
    }

    // Without ONEINCH_API_KEY the backend 503s every swap route — say that
    // plainly instead of surfacing a bare "error".
    function swapErr(d: any, status: number) {
      const e = typeof d?.error === 'string' ? d.error : d?.description;
      if (status === 503 || /ONEINCH_API_KEY/.test(e ?? ''))
        return 'Swap is not configured — set ONEINCH_API_KEY on the backend';
      return e || 'No route found';
    }

    async function execSwap() {
      if (!swQuote) return;
      const btn = el('sw-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      const st = el('sw-st'); if (st) st.style.display = 'none';
      const fromSym = selSym('sw-from'), toSym = selSym('sw-to');
      initProg('sw', [`Approve ${fromSym}`, `Swap ${fromSym} → ${toSym}`]);
      try {
        const user = await requireEVM();
        const prov = getProv();
        const amount = BigInt(Math.round(swQuote.amt * 10 ** selDec('sw-from'))).toString();
        const p = new URLSearchParams({
          chainId: swQuote.chain,
          src: swapAddr(swQuote.src),
          dst: swapAddr(swQuote.dst),
          amount,
          from: user,
          slippage: '1',
        });
        stepSet(0, 'active', 'Building the swap…');
        const r = await fetch('/swap/build?' + p);
        const d = await r.json();
        if (!r.ok || d.error || !d.tx) throw new Error(swapErr(d, r.status));
        // Native gas tokens need no allowance; ensureApproval no-ops on the
        // zero address, and 1inch's router is the spender for ERC-20s.
        stepSet(0, 'active', 'Checking allowance…');
        await ensureApproval(prov, swQuote.src.toLowerCase() === ZERO_ADDR ? '' : swQuote.src, user, d.tx.to, amount);
        stepSet(0, 'done', 'Allowance ready');
        stepSet(1, 'active', 'Confirm the swap in your wallet…');
        const hash = await prov.request({method:'eth_sendTransaction', params:[{
          from: user, to: d.tx.to, data: d.tx.data,
          value: d.tx.value ? '0x'+BigInt(d.tx.value).toString(16) : '0x0',
          ...(d.tx.gas ? {gas:'0x'+BigInt(d.tx.gas).toString(16)} : {}),
        }]}) as string;
        stepSet(1, 'active', 'Confirming…');
        await pollReceipt(prov, hash);
        stepSet(1, 'done', `Swapped into ${toSym} ✓`);
        showSt('sw-st', 'ok', `Swap complete — tx ${hash.slice(0,20)}…`);
        const amtEl = el('sw-amt') as HTMLInputElement | null; if (amtEl) amtEl.value = '';
        const wrap = el('sw-quote-wrap'); if (wrap) wrap.style.display = 'none';
        swQuote = null;
      } catch (e: any) {
        stepFail(e.code === 4001 ? 'Rejected by wallet' : e.message);
      } finally {
        if (btn) btn.disabled = !swQuote;
      }
    }

    function chainIdx(id: string) { return CHAINS.findIndex(c => c.id === id); }

    function selSym(sid: string) {
      const s = el(sid) as HTMLSelectElement | null;
      return (s?.options[s.selectedIndex] as any)?.dataset?.sym ?? '';
    }

    function selDec(sid: string) {
      const s = el(sid) as HTMLSelectElement | null;
      return parseInt((s?.options[s?.selectedIndex || 0] as any)?.dataset?.dec ?? '18');
    }

    function fillChainSel(selId: string) {
      const sel = el(selId) as HTMLSelectElement | null;
      if (sel) sel.innerHTML = CHAINS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }

    function fillTokenSel(selId: string, chainId: string, keepSym?: string) {
      const idx = chainIdx(chainId);
      const tokens = idx >= 0 ? CHAINS[idx].tokens : [];
      const prev = keepSym || selSym(selId);
      const sel = el(selId) as HTMLSelectElement | null;
      if (!sel) return;
      sel.innerHTML = tokens.map(t => `<option value="${t.addr}" data-sym="${t.sym}" data-dec="${t.dec}">${t.sym}</option>`).join('');
      const match = Array.from(sel.options).find(o => (o as any).dataset.sym === prev);
      if (match) sel.value = match.value;
    }

    function onFromChainChange() {
      const fc = el('from-chain') as HTMLSelectElement | null;
      fillTokenSel('from-token', fc?.value || '42161', selSym('from-token'));
      set('send-cur-badge', selSym('from-token'));
      scheduleQuote();
    }
    function onFromTokenChange() { set('send-cur-badge', selSym('from-token')); scheduleQuote(); }
    function onToChainChange() {
      const tc = el('to-chain') as HTMLSelectElement | null;
      fillTokenSel('to-token', tc?.value || '42161', selSym('to-token'));
      scheduleQuote();
    }

    function scheduleQuote() {
      clearTimeout(qTimer); curQuote = null;
      const sendBtn = el('send-btn') as HTMLButtonElement | null;
      if (sendBtn) sendBtn.disabled = true;
      const sendAmt = el('send-amt') as HTMLInputElement | null;
      const sendDest = el('send-dest') as HTMLInputElement | null;
      const amt = parseFloat(sendAmt?.value || '0') || 0;
      const dst = sendDest?.value.trim() || '';
      const sqw = el('send-quote-wrap'); if (sqw && (!amt || dst.length < 10)) { sqw.style.display = 'none'; return; }
      qTimer = setTimeout(fetchQuote, 650);
    }

    async function fetchQuote() {
      const sendAmt = el('send-amt') as HTMLInputElement | null;
      const sendDest = el('send-dest') as HTMLInputElement | null;
      const amt = parseFloat(sendAmt?.value || '0') || 0;
      const dest = sendDest?.value.trim() || '';
      const fromChainEl = el('from-chain') as HTMLSelectElement | null;
      const toChainEl   = el('to-chain') as HTMLSelectElement | null;
      const fromTokenEl = el('from-token') as HTMLSelectElement | null;
      const toTokenEl   = el('to-token') as HTMLSelectElement | null;
      const fromChain = fromChainEl?.value || '42161';
      const toChain   = toChainEl?.value   || '42161';
      const fromToken = fromTokenEl?.value || '';
      const toToken   = toTokenEl?.value   || '';
      const fromDec   = selDec('from-token');
      if (!amt || !dest) return;
      if (!evmAddressRef.current) { showSt('send-st', 'err', 'Connect your wallet from the top nav first'); return; }
      const sqw = el('send-quote-wrap'); if (sqw) sqw.style.display = '';
      const qcard = el('send-qcard'); if (qcard) qcard.className = 'quote-card loading';
      const skel = el('send-skel'); if (skel) skel.style.display = '';
      const qbody = el('send-qbody'); if (qbody) qbody.style.display = 'none';
      const fromAmount = BigInt(Math.round(amt * 10 ** fromDec)).toString();
      try {
        const q = await lifiQuote(fromChain, toChain, fromToken, toToken, fromAmount, evmAddressRef.current, dest);
        curQuote = q;
        const toDec  = q.action?.toToken?.decimals ?? 18;
        const toSym  = q.action?.toToken?.symbol ?? selSym('to-token');
        const toAmt  = Number(q.estimate?.toAmount ?? 0) / 10 ** toDec;
        const fee    = q.estimate?.feeCosts?.reduce((a: number, f: any) => a + Number(f.amountUSD || 0), 0) ?? 0;
        const gas    = q.estimate?.gasCosts?.reduce((a: number, g: any) => a + Number(g.amountUSD || 0), 0) ?? 0;
        const secs   = q.estimate?.executionDuration ?? 0;
        const via    = q.includedSteps?.map((s: any) => s.toolDetails?.name || s.tool || s.type).filter(Boolean).join(' + ') || '—';
        set('send-recv-amt', fmt(toAmt, toAmt < 1 ? 6 : 3));
        set('send-recv-sym', toSym);
        set('q-fee', fee ? `~$${fmt(fee)}` : '—');
        set('q-gas', gas ? `~$${fmt(gas)}` : '—');
        set('q-via', via);
        set('q-time', secs ? (secs < 60 ? `~${secs}s` : `~${Math.ceil(secs/60)}m`) : '—');
        if (qcard) qcard.className = 'quote-card';
        if (skel) skel.style.display = 'none';
        if (qbody) qbody.style.display = '';
        const sendBtn = el('send-btn') as HTMLButtonElement | null;
        if (sendBtn) sendBtn.disabled = false;
      } catch (e: any) {
        if (qcard) qcard.className = 'quote-card error';
        if (skel) skel.style.display = 'none';
        if (qbody) qbody.style.display = '';
        set('send-recv-amt', e.message); set('send-recv-sym', '');
        ['q-fee','q-gas','q-via','q-time'].forEach(id => set(id, '—'));
      }
    }

    async function execSend() {
      if (!curQuote) return;
      const btn = el('send-btn') as HTMLButtonElement | null;
      if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
      showSt('send-st', 'inf', 'Checking allowance…');
      try {
        const user = await requireEVM(); const prov = getProv();
        const tx = curQuote.transactionRequest;
        const fAddr = curQuote.action?.fromToken?.address ?? '';
        const fAmt  = curQuote.action?.fromAmount ?? '0';
        await ensureApproval(prov, fAddr, user, curQuote.estimate?.approvalAddress || tx.to, fAmt);
        if (btn) btn.textContent = 'Confirm in wallet…';
        showSt('send-st', 'inf', 'Confirm in wallet…');
        const hash = await prov.request({method:'eth_sendTransaction', params:[{
          from:user, to:tx.to, data:tx.data,
          value: tx.value ? '0x'+BigInt(tx.value).toString(16) : '0x0',
          ...(tx.gasLimit ? {gas:'0x'+BigInt(tx.gasLimit).toString(16)} : {}),
        }]}) as string;
        showSt('send-st', 'ok', `✓ Sent! Tx: ${hash.slice(0,20)}…`);
        curQuote = null;
        const sendAmt = el('send-amt') as HTMLInputElement | null;
        if (sendAmt) sendAmt.value = '';
        const sqw = el('send-quote-wrap'); if (sqw) sqw.style.display = 'none';
      } catch (e: any) {
        showSt('send-st', 'err', e.code === 4001 ? 'Rejected by wallet.' : e.message);
      } finally {
        if (btn) {
          btn.disabled = !curQuote;
          btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>Send';
        }
      }
    }

    function sendMax() { set('send-bal', 'Enter the full amount you want to send'); }

    function setDir(dir: string) {
      btwDir = dir;
      const isHL = dir === 'hl-to-aster';
      const hl2as = el('dtab-hl2as'); if (hl2as) hl2as.className = 'dir-tab ' + (isHL ? 'aHL' : '');
      const as2hl = el('dtab-as2hl'); if (as2hl) as2hl.className = 'dir-tab ' + (isHL ? '' : 'aAS');
      set('btw-cur', isHL ? 'USDC' : 'USDT');
      const btwBtn = el('btw-btn'); if (btwBtn) btwBtn.className = 'exec-btn ' + (isHL ? 'hl' : 'as');
      set('btw-bal', isHL && hlEquity ? `Balance: $${fmt(hlEquity)} USDC` : ' ');
      const btwProg = el('btw-prog'); if (btwProg) btwProg.style.display = 'none';
      const btwSt = el('btw-st'); if (btwSt) btwSt.style.display = 'none';
    }

    function btwMax() {
      const btwAmt = el('btw-amt') as HTMLInputElement | null;
      if (btwDir === 'hl-to-aster' && hlEquity > 0 && btwAmt) btwAmt.value = hlEquity.toFixed(2);
    }

    async function execBtw() {
      const btwAmt = el('btw-amt') as HTMLInputElement | null;
      const amt = parseFloat(btwAmt?.value || '0') || 0;
      if (!amt) return showSt('btw-st', 'err', 'Enter an amount');
      if (!requireCreds('btw-st')) return;
      const btn = el('btw-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      const st = el('btw-st'); if (st) st.style.display = 'none';
      try {
        const user = await requireEVM(); const prov = getProv();
        if (btwDir === 'hl-to-aster') {
          initProg('btw', [
            'Withdraw USDC from Hyperliquid',
            'Wait for USDC in wallet (~2 min)',
            'Swap USDC → USDT on Arbitrum',
            'Send USDT to Aster',
          ]);
          stepSet(0, 'active', 'Sign withdrawal in wallet…');
          await hlWithdrawRaw(prov, user, amt, user);
          stepSet(0, 'done', `$${fmt(amt)} USDC submitted to Arbitrum`);
          stepSet(1, 'active', 'Polling every 12s (up to 6 min)…');
          const ub = await getERC20Bal(prov, USDC_ARB, user);
          await pollBal(prov, USDC_ARB, user, BigInt(Math.round(amt*1e6*0.97)), ub, 360000);
          stepSet(1, 'done', 'USDC arrived in wallet');
          stepSet(2, 'active', 'Getting LI.FI swap route…');
          const usdcBal = await getERC20Bal(prov, USDC_ARB, user);
          const q = await lifiQuote('42161', '42161', USDC_ARB, USDT_ARB, usdcBal.toString(), user, user);
          stepSet(2, 'active', 'Approve + swap — confirm in wallet…');
          const sh = await lifiExec(prov, q, user);
          stepSet(2, 'active', 'Confirming swap…');
          await pollReceipt(prov, sh);
          stepSet(2, 'done', 'USDC → USDT swapped');
          stepSet(3, 'active', 'Getting Aster deposit address…');
          let dep = await asterDepositAddr(); if (!dep) dep = user;
          const usdtBal = await getERC20Bal(prov, USDT_ARB, user);
          stepSet(3, 'active', `Sending ${fmt(Number(usdtBal)/1e6, 2)} USDT — confirm…`);
          const dh = await erc20Send(prov, USDT_ARB, user, dep, usdtBal.toString());
          await pollReceipt(prov, dh);
          stepSet(3, 'done', 'USDT deposited to Aster ✓');
          showSt('btw-st', 'ok', `Transfer complete — $${fmt(amt)} BASIC → EXTRA`);
        } else {
          initProg('btw', [
            'Withdraw USDT from Aster',
            'Wait for USDT in wallet',
            'Swap USDT → USDC on Arbitrum',
            'Send USDC to the Hyperliquid bridge',
          ]);
          stepSet(0, 'active', 'Signing Aster withdrawal…');
          await asterWithdrawRaw(amt, user);
          stepSet(0, 'done', `${fmt(amt)} USDT withdrawal submitted`);
          stepSet(1, 'active', 'Polling every 12s (up to 10 min)…');
          const tb = await getERC20Bal(prov, USDT_ARB, user);
          await pollBal(prov, USDT_ARB, user, BigInt(Math.round(amt*1e6*0.97)), tb, 600000);
          stepSet(1, 'done', 'USDT arrived in wallet');
          stepSet(2, 'active', 'Getting LI.FI swap route…');
          const usdtBal = await getERC20Bal(prov, USDT_ARB, user);
          const q = await lifiQuote('42161', '42161', USDT_ARB, USDC_ARB, usdtBal.toString(), user, user);
          const usdcBefore = await getERC20Bal(prov, USDC_ARB, user);
          stepSet(2, 'active', 'Approve + swap — confirm in wallet…');
          const sh = await lifiExec(prov, q, user);
          stepSet(2, 'active', 'Confirming swap…');
          await pollReceipt(prov, sh);
          stepSet(2, 'done', 'USDT → USDC swapped on Arbitrum');
          // HL does NOT pick up USDC sitting in the wallet — this step used to
          // just declare success and leave the funds stranded there. The
          // deposit is an explicit transfer to Bridge2.
          const swapped = (await getERC20Bal(prov, USDC_ARB, user)) - usdcBefore;
          if (swapped < HL_MIN_DEPOSIT)
            throw new Error('Swapped USDC is under the 5 USDC Hyperliquid minimum — it stays in your wallet');
          stepSet(3, 'active', `Sending ${fmt(Number(swapped) / 1e6)} USDC — confirm in wallet…`);
          const bh = await erc20Send(prov, USDC_ARB, user, HL_BRIDGE, swapped.toString());
          await pollReceipt(prov, bh);
          stepSet(3, 'done', 'USDC sent — Hyperliquid credits it in ~1 min');
          showSt('btw-st', 'ok', `Transfer complete — $${fmt(amt)} EXTRA → BASIC`);
        }
      } catch (e: any) {
        stepFail(e.code === 4001 ? 'Rejected by wallet' : e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function initProg(pfx: string, labels: string[]) {
      progPfx = pfx; curStep = -1;
      const listEl = el(pfx+'-prog-list');
      if (listEl) listEl.innerHTML = labels.map((lbl, i) => `
        <div class="prog-item">
          <div class="prog-dot" id="pd${pfx}${i}">${i+1}</div>
          <div class="prog-body">
            <div class="prog-label">${lbl}</div>
            <div class="prog-msg" id="pm${pfx}${i}">Waiting…</div>
          </div>
        </div>`).join('');
      const progEl = el(pfx+'-prog'); if (progEl) progEl.style.display = '';
    }

    function stepSet(i: number, state: string, msg: string) {
      curStep = i;
      const dot   = el('pd'+progPfx+i);
      const msgEl = el('pm'+progPfx+i);
      if (!dot || !msgEl) return;
      dot.className = 'prog-dot ' + (state === 'active' ? 'spin' : state === 'done' ? 'ok' : state === 'err' ? 'fail' : '');
      dot.textContent = state === 'done' ? '✓' : state === 'err' ? '✕' : String(i+1);
      msgEl.className = 'prog-msg ' + (state === 'active' ? 'go' : state === 'done' ? 'ok' : state === 'err' ? 'fail' : '');
      msgEl.textContent = msg;
    }

    function stepFail(msg: string) {
      if (curStep >= 0) stepSet(curStep, 'err', msg);
      showSt(progPfx+'-st', 'err', msg);
    }

    async function getERC20Bal(prov: any, token: string, owner: string): Promise<bigint> {
      const data = '0x70a08231' + owner.slice(2).padStart(64, '0');
      const hex = await prov.request({method:'eth_call', params:[{to:token, data}, 'latest']});
      return BigInt(hex || '0x0');
    }

    async function ensureApproval(prov: any, token: string, owner: string, spender: string, amount: string) {
      const ZERO = '0x0000000000000000000000000000000000000000';
      if (!token || token === ZERO) return;
      const pad = (v: string) => v.replace(/^0x/, '').padStart(64, '0');
      const allHex = await prov.request({method:'eth_call', params:[{to:token, data:'0xdd62ed3e'+pad(owner)+pad(spender)}, 'latest']});
      if (BigInt(allHex || '0x0') >= BigInt(amount)) return;
      const appHash = await prov.request({method:'eth_sendTransaction', params:[{from:owner, to:token, data:'0x095ea7b3'+pad(spender)+BigInt(amount).toString(16).padStart(64,'0')}]});
      await pollReceipt(prov, appHash, 120000);
    }

    async function erc20Send(prov: any, token: string, from: string, to: string, amount: string) {
      const pad = (v: string) => v.replace(/^0x/, '').padStart(64, '0');
      return prov.request({method:'eth_sendTransaction', params:[{from, to:token, data:'0xa9059cbb'+pad(to)+BigInt(amount).toString(16).padStart(64,'0')}]});
    }

    async function pollReceipt(prov: any, hash: string, ms = 120000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const r = await prov.request({method:'eth_getTransactionReceipt', params:[hash]});
        if (r) { if (r.status === '0x0') throw new Error('Transaction reverted'); return r; }
        await sleep(2500);
      }
      throw new Error('Confirmation timeout');
    }

    async function pollBal(prov: any, token: string, owner: string, needed: bigint, baseline: bigint, timeoutMs: number) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const bal = await getERC20Bal(prov, token, owner);
        if (bal >= baseline + needed) return bal;
        await sleep(12000);
      }
      throw new Error('Timeout — funds did not arrive. Check your account and retry.');
    }

    async function lifiQuote(fromChain: string, toChain: string, fromToken: string, toToken: string, fromAmount: string, fromAddr: string, toAddr: string) {
      const p = new URLSearchParams({fromChain, toChain, fromToken, toToken, fromAmount, fromAddress:fromAddr, toAddress:toAddr||fromAddr, slippage:'0.005'});
      const r = await fetch('/lifi-api/v1/quote?' + p);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any)?.message || 'LI.FI: no route found'); }
      return r.json();
    }

    async function lifiExec(prov: any, quote: any, user: string) {
      const tx = quote.transactionRequest;
      await ensureApproval(prov, quote.action?.fromToken?.address ?? '', user, quote.estimate?.approvalAddress || tx.to, quote.action?.fromAmount ?? '0');
      return prov.request({method:'eth_sendTransaction', params:[{
        from:user, to:tx.to, data:tx.data,
        value: tx.value ? '0x'+BigInt(tx.value).toString(16) : '0x0',
        ...(tx.gasLimit ? {gas:'0x'+BigInt(tx.gasLimit).toString(16)} : {}),
      }]});
    }

    async function hlWithdrawRaw(prov: any, user: string, amt: number, dest: string) {
      const ts = Date.now();
      const td = {
        types: {
          EIP712Domain: [{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],
          'HyperliquidTransaction:Withdraw': [{name:'hyperliquidChain',type:'string'},{name:'destination',type:'string'},{name:'amount',type:'string'},{name:'time',type:'uint64'}],
        },
        primaryType: 'HyperliquidTransaction:Withdraw',
        domain: {name:'HyperliquidSignTransaction', version:'1', chainId:42161, verifyingContract:'0x0000000000000000000000000000000000000000'},
        message: {hyperliquidChain:'Mainnet', destination:dest, amount:String(amt), time:ts},
      };
      const sig = await prov.request({method:'eth_signTypedData_v4', params:[user, JSON.stringify(td)]});
      const res = await fetch(HL+'/exchange', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        action: {type:'withdraw3', hyperliquidChain:'Mainnet', signatureChainId:'0xa4b1', amount:String(amt), time:ts, destination:dest},
        nonce: ts,
        signature: {r:sig.slice(0,66), s:'0x'+sig.slice(66,130), v:parseInt(sig.slice(130,132),16)},
      })});
      const d = await res.json();
      if (d?.status !== 'ok' && d?.response?.type !== 'default')
        throw new Error(d?.response?.data?.message || d?.error || JSON.stringify(d).slice(0,100));
    }

    // Proof to the backend that we control the address we're claiming. `user`
    // is a public address, so without this anyone could call /aster-withdraw
    // naming someone else and send the funds wherever they liked. The
    // signature covers the action's own parameters (destination, amount), so
    // it can't be replayed against different ones.
    //
    // The message format lives in @/lib/wallet-auth (one copy, mirroring
    // backend/src/lib/wallet-auth.ts) — this page used to carry its own.
    async function walletAuth(action: string, params: Record<string,string> = {}) {
      return signAction(await requireEVM(), action, params);
    }

    // Aster's withdraw + deposit-address endpoints use the V1 API-key/HMAC
    // scheme. Both the key and the signing used to live in this page, which
    // meant a withdrawal-capable secret sat in the DOM. The secret is stored
    // encrypted server-side now (backend/src/lib/aster-creds.ts) and the
    // signature is produced there — this file only ever sends the user's
    // address, the amount and the destination.
    async function asterWithdrawRaw(amt: number, dest: string) {
      const asset = 'USDT';
      const auth = await walletAuth('aster-withdraw', {asset, amount: String(amt), address: dest});
      const res = await fetch('/aster-withdraw', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({...auth, asset, amount: String(amt), address: dest}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.code) throw new Error(d?.msg || d?.message || 'Aster withdrawal failed');
    }

    async function asterDepositAddr(): Promise<string | null> {
      try {
        const coin = 'USDT', network = 'ARBITRUM';
        const auth = await walletAuth('aster-deposit-address', {coin, network});
        const p = new URLSearchParams({
          user: auth.user, coin, network,
          timestamp: String(auth.timestamp), signature: auth.signature,
        });
        const r = await fetch(`/aster-deposit-address?${p}`);
        if (!r.ok) return null;
        const d = await r.json();
        return d?.address || null;
      } catch { return null; }
    }

    // Existence check only — the backend never returns the stored secret.
    async function refreshCreds(addr: string) {
      const btn = el('creds-btn') as HTMLButtonElement | null;
      try {
        const r = await fetch(`/aster-creds?user=${encodeURIComponent(addr)}`);
        const d = await r.json();
        credsSaved = !!d.saved;
      } catch { credsSaved = false; }
      const st = el('creds-state');
      if (st) {
        st.textContent = credsSaved
          ? 'Saved — stored encrypted on the server, never in this page'
          : 'Not saved — required for Aster withdrawals and deposits';
        st.style.color = credsSaved ? '#1fa67d' : 'var(--text3,#878c8f)';
      }
      const fields = el('creds-fields');
      if (fields) fields.style.display = credsSaved ? 'none' : '';
      if (btn) btn.textContent = credsSaved ? 'Replace credentials' : 'Save credentials';
    }

    async function saveCreds() {
      const addr = evmAddressRef.current;
      if (!addr) return showSt('creds-st', 'err', 'Connect your wallet from the top nav first');
      const fields = el('creds-fields');
      // Second click of "Replace credentials" just reopens the inputs.
      if (credsSaved && fields && fields.style.display === 'none') {
        fields.style.display = '';
        return;
      }
      const keyEl = el('creds-key') as HTMLInputElement | null;
      const secEl = el('creds-sec') as HTMLInputElement | null;
      const apiKey = keyEl?.value.trim() || '', apiSecret = secEl?.value.trim() || '';
      if (!apiKey || !apiSecret) return showSt('creds-st', 'err', 'Enter both the API key and secret');
      try {
        showSt('creds-st', 'inf', 'Confirm in your wallet…');
        const auth = await walletAuth('aster-creds-save');
        const r = await fetch('/aster-creds', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({...auth, apiKey, apiSecret}),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.saved) throw new Error(d?.msg || 'Could not save credentials');
        // Clear the inputs the moment they're stored — no reason to leave the
        // secret in the DOM after it has been handed off.
        if (keyEl) keyEl.value = '';
        if (secEl) secEl.value = '';
        showSt('creds-st', 'ok', 'Credentials saved ✓');
        await refreshCreds(addr);
      } catch (e: any) {
        showSt('creds-st', 'err', e.message);
      }
    }

    async function clearCreds() {
      const addr = evmAddressRef.current;
      if (!addr) return;
      try {
        const auth = await walletAuth('aster-creds-delete');
        await fetch('/aster-creds', {
          method: 'DELETE',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(auth),
        });
        showSt('creds-st', 'ok', 'Credentials removed');
        await refreshCreds(addr);
      } catch (e: any) {
        showSt('creds-st', 'err', e.message);
      }
    }

    function requireCreds(stId: string): boolean {
      if (credsSaved) return true;
      showSt(stId, 'err', 'Save your Aster API credentials first — the card at the top of this page');
      return false;
    }

    function showSt(id: string, type: string, msg: string) {
      const e = el(id); if (!e) return;
      e.textContent = msg; e.className = 'status ' + type; e.style.display = 'block';
    }

    // Expose to window for JSX handlers
    (window as any).setTab       = setTab;
    (window as any).setWdSrc     = setWdSrc;
    (window as any).onWdAmtInput = onWdAmtInput;
    (window as any).wdMax        = wdMax;
    (window as any).onWdToChainChange = onWdToChainChange;
    (window as any).updateWdConvHint  = updateWdConvHint;
    (window as any).execWithdraw      = execWithdraw;
    (window as any).setDpDest         = setDpDest;
    (window as any).onDpFromChainChange = onDpFromChainChange;
    (window as any).updateDpHint      = updateDpHint;
    (window as any).execDeposit       = execDeposit;
    (window as any).onFromChainChange = onFromChainChange;
    (window as any).onFromTokenChange = onFromTokenChange;
    (window as any).onToChainChange   = onToChainChange;
    (window as any).scheduleQuote     = scheduleQuote;
    (window as any).execSend          = execSend;
    (window as any).sendMax           = sendMax;
    (window as any).saveCreds         = saveCreds;
    (window as any).clearCreds        = clearCreds;
    (window as any).onSwChainChange   = onSwChainChange;
    (window as any).scheduleSwQuote   = scheduleSwQuote;
    (window as any).swFlip            = swFlip;
    (window as any).execSwap          = execSwap;
    (window as any).setDir            = setDir;
    (window as any).btwMax            = btwMax;
    (window as any).execBtw           = execBtw;

    // Init
    setTab('withdraw');
    fillChainSel('wd-to-chain');
    fillTokenSel('wd-to-token', '42161', 'USDC');
    updateWdConvHint();
    fillChainSel('dp-from-chain');
    setDpDest('hl');
    fillChainSel('sw-chain');
    fillTokenSel('sw-from', '42161', 'USDC');
    fillTokenSel('sw-to', '42161', 'ETH');
    set('sw-cur', selSym('sw-from'));
    fillChainSel('from-chain'); fillChainSel('to-chain');
    fillTokenSel('from-token', '42161');
    fillTokenSel('to-token', '42161', 'ETH');
    set('send-cur-badge', selSym('from-token'));
    setDir('hl-to-aster');

    import('@/lib/i18n').then(({ applyTranslations }) => {
      applyTranslations();
    });
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: PAGE_CSS}} />

      <SiteNav activePage="transfer" />

      <main>
        <div className="page-hdr">
          <div className="page-title" data-i18n="transferTitle">TRANSFER</div>
          <div className="page-sub" data-i18n="transferSub">Withdraw in any currency · Send to any address · Move between accounts</div>
        </div>

        {/* Aster API credentials — entered once, stored encrypted server-side.
            Every Aster withdrawal/deposit is signed there, so the secret never
            lives in this page. */}
        <div className="card" style={{marginBottom:'16px'}}>
          <div className="field-lbl" data-i18n="asterApiCreds">Aster API credentials</div>
          <div className="api-note" id="creds-state">Connect your wallet to check</div>
          <div id="creds-fields">
            <div className="api-row" style={{marginTop:'8px'}}>
              <input className="api-input" type="text" id="creds-key" placeholder="API Key" autoComplete="off" />
              <input className="api-input" type="password" id="creds-sec" placeholder="API Secret" autoComplete="off" />
            </div>
            <div className="api-note">
              Sent once over HTTPS, encrypted at rest, and never returned to the browser.
              Only needed for Aster (EXTRA) withdrawals and deposits.
            </div>
          </div>
          <div style={{display:'flex', gap:'8px', marginTop:'8px'}}>
            <button className="exec-btn as" id="creds-btn" style={{flex:1}} onClick={() => (window as any).saveCreds()}>Save credentials</button>
            <button className="max-btn" style={{padding:'0 14px'}} onClick={() => (window as any).clearCreds()}>Remove</button>
          </div>
          <div className="status" id="creds-st" />
        </div>

        <div className="xfr-tabs">
          <button className="xfr-tab active" onClick={() => (window as any).setTab('withdraw')} data-i18n="withdraw">Withdraw</button>
          <button className="xfr-tab" onClick={() => (window as any).setTab('deposit')} data-i18n="deposit">Deposit</button>
          <button className="xfr-tab" onClick={() => (window as any).setTab('swap')} data-i18n="swap">Swap</button>
          <button className="xfr-tab" onClick={() => (window as any).setTab('send')} data-i18n="send">Send</button>
          <button className="xfr-tab" onClick={() => (window as any).setTab('between')} data-i18n="betweenAccounts">Between Accounts</button>
        </div>

        {/* WITHDRAW */}
        <div id="tab-withdraw">
          <div className="card">
            <div className="field-lbl" data-i18n="sourceAccount">Source account</div>
            <div className="src-tabs">
              <button className="src-tab hl active" id="wd-btn-hl" onClick={() => (window as any).setWdSrc('hl')}>BASIC · Hyperliquid</button>
              <button className="src-tab as" id="wd-btn-as" onClick={() => (window as any).setWdSrc('aster')}>EXTRA · Aster</button>
            </div>
            <div className="field-lbl" data-i18n="amount">Amount</div>
            <div className="amt-wrap" id="wd-amt-wrap">
              <input className="amt-input" type="number" id="wd-amt" placeholder="0.00" min="0" onInput={() => (window as any).onWdAmtInput()} />
              <div className="amt-right">
                <span className="cur-badge" id="wd-from-cur">USDC</span>
                <button className="max-btn" onClick={() => (window as any).wdMax()}>MAX</button>
              </div>
            </div>
            <div className="bal-hint" id="wd-bal">&nbsp;</div>
            <div className="field-lbl" data-i18n="receiveAs">Receive as</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{flex:'1.3'}}>
                <select id="wd-to-chain" onChange={() => (window as any).onWdToChainChange()}></select>
              </div>
              <div className="sel-wrap">
                <select id="wd-to-token" onChange={() => (window as any).updateWdConvHint()}></select>
              </div>
            </div>
            <div className="conv-hint" id="wd-conv-hint">&nbsp;</div>
            <div className="field-lbl" data-i18n="destAddress">Destination address</div>
            <input className="txt-input" type="text" id="wd-dest" placeholder="0x… (default: connected wallet)" />
            <button className="exec-btn hl" id="wd-exec-btn" onClick={() => (window as any).execWithdraw()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v13M7 11l5 5 5-5"/><path d="M4 19h16"/>
              </svg>
              Withdraw
            </button>
            <div id="wd-prog" style={{display:'none'}}>
              <div className="divider" />
              <div className="field-lbl">Live progress</div>
              <div className="prog-list" id="wd-prog-list" />
            </div>
            <div className="status" id="wd-st" />
          </div>
        </div>

        {/* DEPOSIT */}
        <div id="tab-deposit" style={{display:'none'}}>
          <div className="card">
            <div className="field-lbl" data-i18n="destAccount">Destination account</div>
            <div className="src-tabs">
              <button className="src-tab hl active" id="dp-btn-hl" onClick={() => (window as any).setDpDest('hl')}>BASIC · Hyperliquid</button>
              <button className="src-tab as" id="dp-btn-as" onClick={() => (window as any).setDpDest('aster')}>EXTRA · Aster</button>
            </div>
            <div className="field-lbl">You send</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{flex:'1.3'}}>
                <select id="dp-from-chain" onChange={() => (window as any).onDpFromChainChange()}></select>
              </div>
              <div className="sel-wrap">
                <select id="dp-from-token" onChange={() => (window as any).updateDpHint()}></select>
              </div>
            </div>
            <div className="amt-wrap" id="dp-amt-wrap">
              <input className="amt-input" type="number" id="dp-amt" placeholder="0.00" min="0" />
              <div className="amt-right">
                <span className="cur-badge" id="dp-cur">USDC</span>
              </div>
            </div>
            <div className="conv-hint" id="dp-hint">&nbsp;</div>
            <button className="exec-btn hl" id="dp-btn" onClick={() => (window as any).execDeposit()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21V8M7 13l5-5 5 5"/><path d="M4 4h16"/>
              </svg>
              Deposit
            </button>
            <div id="dp-prog" style={{display:'none'}}>
              <div className="divider" />
              <div className="field-lbl">Live progress</div>
              <div className="prog-list" id="dp-prog-list" />
            </div>
            <div className="status" id="dp-st" />
          </div>
        </div>

        {/* SWAP */}
        <div id="tab-swap" style={{display:'none'}}>
          <div className="card">
            <div className="field-lbl">Network</div>
            <div className="sel-wrap">
              <select id="sw-chain" onChange={() => (window as any).onSwChainChange()}></select>
            </div>
            <div className="field-lbl">You pay</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{flex:'1.3'}}>
                <select id="sw-from" onChange={() => (window as any).scheduleSwQuote()}></select>
              </div>
              <div className="sel-wrap">
                <button className="max-btn" style={{width:'100%',padding:'9px 0'}} onClick={() => (window as any).swFlip()} title="Flip tokens">⇅ Flip</button>
              </div>
            </div>
            <div className="amt-wrap">
              <input className="amt-input" type="number" id="sw-amt" placeholder="0.00" min="0" onInput={() => (window as any).scheduleSwQuote()} />
              <div className="amt-right">
                <span className="cur-badge" id="sw-cur">—</span>
              </div>
            </div>
            <div className="field-lbl">You receive</div>
            <div className="sel-wrap">
              <select id="sw-to" onChange={() => (window as any).scheduleSwQuote()}></select>
            </div>
            <div id="sw-quote-wrap" style={{display:'none'}}>
              <div className="quote-card loading" id="sw-qcard">
                <div className="q-title">Estimated output</div>
                <div className="q-skeleton" id="sw-skel" />
                <div id="sw-qbody" style={{display:'none'}}>
                  <div className="q-receive">
                    <span id="sw-recv-amt">—</span>{' '}
                    <span id="sw-recv-sym" style={{fontSize:'13px',fontWeight:600,color:'var(--text3,#878c8f)'}}></span>
                  </div>
                  <div className="conv-hint" id="sw-rate">&nbsp;</div>
                </div>
              </div>
            </div>
            <button className="exec-btn lifi" id="sw-btn" onClick={() => (window as any).execSwap()} disabled>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
              </svg>
              Swap
            </button>
            <div id="sw-prog" style={{display:'none'}}>
              <div className="divider" />
              <div className="field-lbl">Live progress</div>
              <div className="prog-list" id="sw-prog-list" />
            </div>
            <div className="status" id="sw-st" />
          </div>
          <div className="card">
            <div className="info-box neu" style={{marginBottom:0}}>
              Same-chain swaps via 1inch, routed through the backend so the API key stays server-side.
              For <strong>cross-chain</strong> moves use the Send tab, which quotes bridges through LI.FI.
            </div>
          </div>
        </div>

        {/* SEND */}
        <div id="tab-send" style={{display:'none'}}>
          <div className="card">
            <div className="field-lbl">You send</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{flex:'1.3'}}>
                <select id="from-chain" onChange={() => (window as any).onFromChainChange()}></select>
              </div>
              <div className="sel-wrap">
                <select id="from-token" onChange={() => (window as any).onFromTokenChange()}></select>
              </div>
            </div>
            <div className="amt-wrap">
              <input className="amt-input" type="number" id="send-amt" placeholder="0.00" min="0" onInput={() => (window as any).scheduleQuote()} />
              <div className="amt-right">
                <span className="cur-badge" id="send-cur-badge">—</span>
                <button className="max-btn" onClick={() => (window as any).sendMax()}>MAX</button>
              </div>
            </div>
            <div className="bal-hint" id="send-bal">&nbsp;</div>
            <div className="field-lbl">To address</div>
            <input className="txt-input" type="text" id="send-dest" placeholder="0x… destination address" onInput={() => (window as any).scheduleQuote()} />
            <div className="field-lbl">They receive</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{flex:'1.3'}}>
                <select id="to-chain" onChange={() => (window as any).onToChainChange()}></select>
              </div>
              <div className="sel-wrap">
                <select id="to-token" onChange={() => (window as any).scheduleQuote()}></select>
              </div>
            </div>
            <div id="send-quote-wrap" style={{display:'none'}}>
              <div className="quote-card loading" id="send-qcard">
                <div className="q-title">Estimated route</div>
                <div className="q-skeleton" id="send-skel" />
                <div id="send-qbody" style={{display:'none'}}>
                  <div className="q-receive">
                    <span id="send-recv-amt">—</span>{' '}
                    <span id="send-recv-sym" style={{fontSize:'13px',fontWeight:600,color:'var(--text3,#878c8f)'}}></span>
                  </div>
                  <div className="q-meta">
                    <div className="q-item">Fee <strong id="q-fee">—</strong></div>
                    <div className="q-item">Gas <strong id="q-gas">—</strong></div>
                    <div className="q-item">Via <strong id="q-via">—</strong></div>
                    <div className="q-item">Time <strong id="q-time">—</strong></div>
                  </div>
                </div>
              </div>
            </div>
            <button className="exec-btn lifi" id="send-btn" onClick={() => (window as any).execSend()} disabled>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              Send
            </button>
            <div className="status" id="send-st" />
          </div>
        </div>

        {/* BETWEEN ACCOUNTS */}
        <div id="tab-between" style={{display:'none'}}>
          <div className="card">
            <div className="field-lbl" data-i18n="direction">Direction</div>
            <div className="dir-tabs">
              <button className="dir-tab aHL" id="dtab-hl2as" onClick={() => (window as any).setDir('hl-to-aster')}>
                <span className="dt-from">BASIC → EXTRA</span>
              </button>
              <button className="dir-tab" id="dtab-as2hl" onClick={() => (window as any).setDir('aster-to-hl')}>
                <span className="dt-from">EXTRA → BASIC</span>
              </button>
            </div>
            <div className="field-lbl" data-i18n="amount">Amount</div>
            <div className="amt-wrap" id="btw-amt-wrap">
              <input className="amt-input" type="number" id="btw-amt" placeholder="0.00" min="0" />
              <div className="amt-right">
                <span className="cur-badge" id="btw-cur">USDC</span>
                <button className="max-btn" onClick={() => (window as any).btwMax()}>MAX</button>
              </div>
            </div>
            <div className="bal-hint" id="btw-bal">&nbsp;</div>
            <button className="exec-btn hl" id="btw-btn" onClick={() => (window as any).execBtw()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              Auto Transfer
            </button>
            <div id="btw-prog" style={{display:'none'}}>
              <div className="divider" />
              <div className="field-lbl">Live progress</div>
              <div className="prog-list" id="btw-prog-list" />
            </div>
            <div className="status" id="btw-st" />
          </div>
          <div className="card">
            <div className="info-box neu" style={{marginBottom:0}}>
              <strong>Fully automated:</strong> One click executes the full sequence — HL/Aster withdrawal → on-chain swap via LI.FI → deposit to destination account. You'll sign 2–3 wallet transactions.
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
