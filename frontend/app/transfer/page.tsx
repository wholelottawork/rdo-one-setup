'use client';
import { useEffect, useRef } from 'react';
import { SiteNav } from '@/components/shared/SiteNav';
import { useWallet, getEVMProvider, switchEvmNetwork, findEvmNetwork } from '@/lib/wallet';
import { walletAuth as signAction } from '@/lib/wallet-auth';
import { ensureAsterAgentApprovedAuto, getAsterAccount } from '@/lib/aster-agent';
import { asterFetch } from '@/lib/aster-session';
import {
  ASTER_DEPOSIT_CHAIN,
  asterVault,
  encodeDepositFor,
  isNativeCurrency,
} from '@/lib/asterDeposit';
import {
  asterNonce,
  buildAsterWithdrawTypedData,
  normalizeAsterAmount,
  toPlainDecimal,
} from '@/lib/asterWithdraw';
import {
  ASTER_WITHDRAW_ASSETS,
  asterDisplayDecimals,
  asterMaxAmount,
  asterPayoutToken,
  asterWithdrawChains,
  type AsterPayoutToken,
} from '@/lib/asterAssets';

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

  // Same bridge as onConnectedRef, for the deposit tab's balance hint.
  const refreshDpBalRef = useRef<(() => void) | null>(null);

  // The deposit balance is read from wherever the wallet is currently pointed:
  // refreshDpBal refuses to answer when that is not the chain picked in the
  // "You send" select, because an eth_call goes to the wallet's network and
  // would otherwise report an Arbitrum balance under a Base selection. Nothing
  // re-ran it on a network switch — the selects only fire on user input, and
  // evmAddress does not change when the chain does — so the hint stayed frozen
  // on "Switch your wallet to Base to see your USDC balance" after the user
  // actually switched, and MAX went on reading a stale 0.
  //
  // Keyed on evmAddress rather than mounted once: getEVMProvider() resolves the
  // wallet the user PICKED, and that is only known after connect (a
  // WalletConnect session is never injected on window at all), so a
  // mount-time subscription would bind to the wrong provider or to none.
  useEffect(() => {
    const provider = getEVMProvider();
    if (!provider) return;
    const onChainChanged = () => refreshDpBalRef.current?.();
    provider.on?.('chainChanged', onChainChanged);
    return () => provider.removeListener?.('chainChanged', onChainChanged);
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

    // Every balance below is an ARBITRUM balance: HL's bridge pays out there,
    // Aster's vault lives there, and both conversion legs land there. The
    // wallet is frequently NOT there at the moment we need to read one.
    const ARB_CHAIN = '42161';
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
    const disableBtn = (id: string) => { const b = el(id) as HTMLButtonElement | null; if (b) b.disabled = true; };
    const fmt   = (n: number, d = 2) => Number(n).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d});
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    /**
     * Decimal string -> integer token units, WITHOUT ever touching a float.
     *
     * The old `BigInt(Math.round(amt * 10 ** dec))` is exact only while the
     * result fits a double's ~15-16 significant digits. An 18-decimal token
     * needs 18, so the conversion lands tens of wei away from the truth — and
     * MAX made that fatal: reading the balance as a Number and writing it back
     * produced 598687925568526464 for a wallet holding 598687925568526425, i.e.
     * an approval and a transfer for 39 wei MORE than existed. The token
     * rejects that as TransferFromFailed() (0x7939f424), which reaches the user
     * as a wallet "transaction may fail" warning and nothing else.
     *
     * Digits past `decimals` are truncated, never rounded: rounding up is the
     * direction that recreates the bug.
     */
    function toUnits(value: string, decimals: number): bigint {
      const s = (value ?? '').trim();
      if (!s || !/^\d*\.?\d*$/.test(s)) return BigInt(0);
      const [wholeRaw, fracRaw = ''] = s.split('.');
      const frac = fracRaw.slice(0, decimals).padEnd(decimals, '0');
      return BigInt((wholeRaw || '0') + (decimals ? frac : ''));
    }

    /** Integer token units -> exact decimal string, for MAX and for display. */
    function fromUnits(v: bigint, decimals: number): string {
      const base = BigInt(10) ** BigInt(decimals);
      const whole = v / base;
      const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
      return whole.toString() + (frac ? '.' + frac : '');
    }

    let wdSrc    = 'hl';
    let dpDest   = 'hl';
    // The fee currently SHOWN to the user for an Aster withdrawal. It is a
    // signed field, so this is also the value that must end up in the
    // signature — execWithdraw re-quotes just before prompting and refuses to
    // sign a different number than the one on screen.
    let asterWdFee: string | null = null;
    // The chain AND asset that fee was quoted for, and a generation counter for
    // the quote. The fee is per-chain and per-asset (0.11 USDT on BNB Chain,
    // 0.51 on Arbitrum, 0.00017 BNB on BNB Chain) and all three are part of
    // what the user is authorizing — comparing the number alone would wave
    // through an asset change that happens to quote the same figure.
    let asterWdFeeChain = '';
    let asterWdFeeAsset = '';
    let asterWdFeeGen = 0;
    // Which currency is leaving Aster. Was a hardcoded 'USDT' — an account
    // holding BNB or ETH could see it but never move it.
    let wdAsset = 'USDT';
    // Aster's full withdrawal matrix, asset -> chainId -> {withdrawable,...},
    // as served by /aster-withdraw-info. Empty until the first read; every
    // caller has to cope with that rather than treat a missing entry as zero,
    // because "not read yet" and "no capacity" lead to opposite advice.
    let asterMatrix: Record<string, Record<string, { withdrawable: number | null }>> = {};
    let btwDir   = 'hl-to-aster';
    let hlEquity = 0;
    // Aster's withdrawable balance, and a generation counter for the load that
    // produced it: reading it is an async round trip that can outlive the user
    // switching the source back to Hyperliquid, and a late reply must not
    // overwrite the hint with a balance for the venue no longer selected.
    let asterAvail = 0;
    let asterBalGen = 0;
    // What Aster will ACTUALLY pay out, which is neither the account balance
    // nor availableBalance: a live account read 12.07 USDT available with only
    // 1.09 withdrawable. Capacity is per asset AND per chain, so the number is
    // meaningless without the chain that produced it.
    let asterWithdrawable = 0;
    let asterWithdrawableChain = '';
    // Why asterAvail is 0 when the reason is something other than "the account
    // holds nothing withdrawable" — MAX reports this instead of echoing the
    // balance line back at the user.
    let asterBalErr = '';
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
      refreshDpBal();
      refreshSendBal();
      // Which wallet is connected is only knowable after connect, and so is
      // the Aster balance. Both are re-derived here rather than left showing
      // whatever the disconnected state said. Still gated on the user having
      // already picked Aster — that selection is the deliberate action the
      // agent-approval prompt hangs off, not the connect itself.
      if (wdSrc === 'aster') loadAsterAvail();
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
      set('wd-from-cur', isHL ? 'USDC' : wdAsset);
      fillTokenSel('wd-to-token', '42161', isHL ? 'USDC' : wdAsset);
      // Hyperliquid pays out USDC and nothing else, so the currency picker is
      // meaningless there rather than merely unused.
      const assetRow = el('wd-asset-row');
      if (assetRow) assetRow.style.display = isHL ? 'none' : '';
      // Aster's fee is a signed field — quote it as soon as the user picks
      // Aster so it is on screen well before the wallet prompt, not revealed
      // by it. Hyperliquid's withdrawal fee is fixed and not signed.
      asterWdFee = null;
      asterWdFeeChain = '';
      asterWdFeeAsset = '';
      set('wd-fee', ' ');
      // Invalidates any Aster balance read still in flight (see asterBalGen).
      asterBalGen++;
      asterAvail = 0;
      asterWithdrawable = 0;
      asterWithdrawableChain = '';

      if (isHL) {
        set('wd-bal', hlEquity ? `Balance: $${fmt(hlEquity)} USDC` : ' ');
      } else {
        refreshAsterWdFee().catch((e: any) => set('wd-fee', e.message));
        loadAsterAvail();
      }
      updateWdConvHint();
    }

    /**
     * Aster's balance is not public: reading it needs this address's own
     * approved agent, exactly as the Portfolio page's EXTRA tab does. That can
     * prompt for one approval signature, so it hangs off the deliberate act of
     * selecting Aster as the withdrawal source — never off connecting a wallet.
     */
    async function loadAsterAvail() {
      const gen = ++asterBalGen;
      asterAvail = 0;
      asterWithdrawable = 0;
      asterBalErr = '';
      const addr = evmAddressRef.current;
      if (!addr) {
        asterBalErr = 'Connect your wallet from the top nav first';
        return set('wd-bal', 'Connect wallet to see balance');
      }
      set('wd-bal', 'Reading your Aster balance…');
      const stale = () => gen !== asterBalGen;
      try {
        const approval = await ensureAsterAgentApprovedAuto(addr);
        if (stale()) return;
        if (!approval.ok) {
          asterBalErr = `Could not read your Aster balance: ${approval.message}`;
          return set('wd-bal', `Could not read Aster balance: ${approval.message}`);
        }
        const acct = await getAsterAccount(addr);
        if (stale()) return;
        if (!acct) {
          asterBalErr = 'Could not read your Aster balance';
          return set('wd-bal', 'Could not read Aster balance');
        }
        const wallet = parseFloat(String(acct.totalWalletBalance ?? acct.totalMarginBalance ?? 0)) || 0;
        // availableBalance is the account balance less margin locked by open
        // positions and resting orders — necessary, but NOT what Aster will
        // pay out. It read 12.07 on an account with 1.09 withdrawable.
        const avail  = parseFloat(String(acct.availableBalance ?? wallet)) || 0;
        asterAvail = avail;

        const asset = wdAsset;
        const chain = asterWdChain();
        const cap = await readAsterWithdrawable(chain, asset);
        if (stale()) return;
        // The binding number is whichever is smaller: margin can lock funds
        // below Aster's payout cap, and the cap can sit below free margin.
        //
        // ONLY FOR USDT. `availableBalance` is free margin denominated in the
        // account's margin currency, so mining it for a BNB or ETH ceiling
        // compares two different units — "0.019 BNB withdrawable" against
        // "12.07 available" would clamp a valid withdrawal to nonsense in one
        // direction and wave a bad one through in the other. For anything else
        // Aster's own per-asset cap is the only number that means anything.
        const isMarginAsset = asset === 'USDT';
        const usable = cap === null ? (isMarginAsset ? avail : 0) : isMarginAsset ? Math.min(avail, cap) : cap;
        asterWithdrawable = usable;
        asterWithdrawableChain = chain;
        const d = asterDisplayDecimals(asset);
        set('wd-bal', cap === null
          ? isMarginAsset
            ? `Available: ${fmt(avail)} USDT  ·  Account: ${fmt(wallet)} USDT`
            : `Could not read your withdrawable ${asset} — Aster did not answer`
          : `Withdrawable: ${fmt(usable, d)} ${asset} on ${chainName(chain)}  ·  Account: ${fmt(wallet)} USDT`);
        // "Could not read" and "nothing to withdraw" lead to opposite advice —
        // retry versus close a position — so MAX must not report one as the
        // other. Only USDT has a second source (free margin) to fall back on.
        if (cap === null && !isMarginAsset)
          asterBalErr = `Could not read how much ${asset} Aster will pay out — try again in a moment`;
        else if (usable <= 0)
          asterBalErr = `No withdrawable ${asset} on ${chainName(chain)} right now`;
      } catch (e: any) {
        if (stale()) return;
        asterBalErr = `Could not read your Aster balance: ${e?.message ?? 'unknown error'}`;
        set('wd-bal', asterBalErr);
      }
    }

    /** Aster's real payout cap for one asset on one chain, or null when it
     *  cannot be read (in which case callers fall back to availableBalance
     *  rather than blocking the withdrawal on a number we merely wanted).
     *
     *  Capacity is per asset AND per chain and the two do not track each
     *  other: on a live account USDT was withdrawable only on Arbitrum and BNB
     *  only on BSC. Asking for the wrong pairing fails with "You've exceeded
     *  the withdrawal limit for this chain", which sounds like a ban and is
     *  really a routing mistake. */
    async function readAsterWithdrawable(chainId: string, asset: string): Promise<number | null> {
      try {
        const res = await asterFetch(`/aster-withdraw-info?chainId=${chainId}&asset=${asset}`);
        if (!res.ok) return null;
        const d = await res.json();
        // The same response carries EVERY asset on every chain — the query only
        // picks which cell gets hoisted to the top level. Keeping the whole
        // matrix means the currency picker can say what is actually withdrawable
        // where without one round trip per candidate pairing.
        if (d?.all && typeof d.all === 'object') {
          asterMatrix = d.all;
          fillWdAssetSel();
        }
        return d?.ok && typeof d.withdrawable === 'number' ? d.withdrawable : null;
      } catch {
        return null;
      }
    }

    /** Withdrawable amount of `asset` across every chain Aster pays it out on,
     *  per the last matrix read. Null when the matrix has not been read — which
     *  is NOT the same as zero and must not be shown as "nothing to withdraw". */
    function matrixBest(asset: string): { chain: string; amount: number } | null {
      const perChain = asterMatrix[asset];
      if (!perChain) return null;
      let best: { chain: string; amount: number } | null = null;
      for (const chain of asterWithdrawChains(asset)) {
        const amount = perChain[chain]?.withdrawable ?? 0;
        if (!best || amount > best.amount) best = { chain, amount };
      }
      return best;
    }

    /** The currency picker. Options come from what this app can actually see a
     *  withdrawal through end to end (@/lib/asterAssets), annotated with what
     *  Aster says is withdrawable once the matrix has been read. */
    function fillWdAssetSel() {
      const sel = el('wd-asset') as HTMLSelectElement | null;
      if (!sel) return;
      const prev = sel.value || wdAsset;
      sel.innerHTML = ASTER_WITHDRAW_ASSETS.map(a => {
        const best = matrixBest(a);
        const label = best && best.amount > 0
          ? `${a} — ${fmt(best.amount, asterDisplayDecimals(a))} on ${chainName(best.chain)}`
          : best
            ? `${a} — none withdrawable`
            : a;
        return `<option value="${a}">${label}</option>`;
      }).join('');
      sel.value = prev;
      if (sel.value !== prev) sel.value = wdAsset;
    }

    /** Switching currency invalidates the fee, the balance and the payout
     *  chain all at once — none of them survive the change, and a stale one is
     *  either a rejected signature or a number the user never authorized. */
    function setWdAsset(asset: string) {
      if (!asterWithdrawChains(asset).length) return;
      wdAsset = asset;
      set('wd-from-cur', asset);
      asterWdFee = null;
      asterWdFeeChain = '';
      asterWdFeeAsset = '';
      set('wd-fee', ' ');
      asterBalGen++;
      asterAvail = 0;
      asterWithdrawable = 0;
      asterWithdrawableChain = '';
      const amt = el('wd-amt') as HTMLInputElement | null;
      if (amt) { amt.value = ''; amt.step = String(1 / 10 ** asterDisplayDecimals(asset)); }
      // updateWdConvHint re-quotes the fee itself whenever Aster is the source,
      // so this must not also do it — two quotes in flight for the same change
      // is just a race the generation counter has to clean up.
      updateWdConvHint();
      loadAsterAvail();
    }

    /** The Between Accounts variant: same number, but pinned to Arbitrum,
     *  because that leg's LI.FI swap and the Hyperliquid bridge both only
     *  exist there. Needs the agent approved first — this is the deliberate
     *  action that prompt hangs off. */
    async function loadAsterWithdrawable(): Promise<void> {
      asterWithdrawable = 0;
      asterBalErr = '';
      const addr = evmAddressRef.current;
      if (!addr) {
        asterBalErr = 'Connect your wallet from the top nav first';
        return;
      }
      try {
        const approval = await ensureAsterAgentApprovedAuto(addr);
        if (!approval.ok) {
          asterBalErr = `Could not read your Aster balance: ${approval.message}`;
          return;
        }
        const acct = await getAsterAccount(addr);
        const avail = parseFloat(String(acct?.availableBalance ?? 0)) || 0;
        const cap = await readAsterWithdrawable(ASTER_WD_FALLBACK_CHAIN, ASTER_BTW_ASSET);
        asterWithdrawable = cap === null ? avail : Math.min(avail, cap);
        asterWithdrawableChain = ASTER_WD_FALLBACK_CHAIN;
        if (asterWithdrawable <= 0)
          asterBalErr = `No withdrawable USDT on ${chainName(ASTER_WD_FALLBACK_CHAIN)} — `
            + 'it may be locked as margin behind open positions.';
      } catch (e: any) {
        asterBalErr = `Could not read your Aster balance: ${e?.message ?? 'unknown error'}`;
      }
    }

    function onWdAmtInput() {
      const wdAmt = el('wd-amt') as HTMLInputElement | null;
      const a = parseFloat(wdAmt?.value || '0') || 0;
      if (wdSrc === 'hl') {
        set('wd-bal', a && hlEquity
          ? `Balance: $${fmt(hlEquity)} USDC  ·  After: $${fmt(Math.max(0, hlEquity - a))}`
          : evmAddressRef.current ? `Balance: $${fmt(hlEquity)} USDC` : 'Connect wallet to see balance');
      } else if (asterWithdrawable > 0) {
        const on = asterWithdrawableChain ? ` on ${chainName(asterWithdrawableChain)}` : '';
        const d = asterDisplayDecimals(wdAsset);
        set('wd-bal', a
          ? `Withdrawable: ${fmt(asterWithdrawable, d)} ${wdAsset}${on}  ·  After: ${fmt(Math.max(0, asterWithdrawable - a), d)}`
          : `Withdrawable: ${fmt(asterWithdrawable, d)} ${wdAsset}${on}`);
      }
    }

    function wdMax() {
      const wdAmt = el('wd-amt') as HTMLInputElement | null;
      if (!wdAmt) return;
      if (wdSrc === 'hl') {
        if (hlEquity > 0) { wdAmt.value = hlEquity.toFixed(2); onWdAmtInput(); }
        return;
      }
      // Aster's fee comes OUT of the withdrawn amount, so the whole
      // withdrawable amount is a valid ask — execWithdraw only rejects it if it
      // does not exceed the fee. Nothing is reserved here beyond that.
      //
      // Withdrawable, not availableBalance: Aster caps payouts per asset per
      // chain well below free margin, and offering the larger number produced
      // a rejection that reads like a ban ("exceeded the withdrawal limit for
      // this chain") rather than a too-large amount.
      //
      // toFixed(2) is not enough precision for a gas token: a real withdrawable
      // BNB balance of 0.019 rounds to "0.02", which is MORE than the account
      // holds and gets rejected. asterMaxAmount truncates at the asset's own
      // display precision instead.
      if (asterWithdrawable > 0) { wdAmt.value = asterMaxAmount(asterWithdrawable, wdAsset); onWdAmtInput(); }
      else showSt('wd-st', 'err', asterBalErr || `No withdrawable ${wdAsset} in your Aster account — an open position or resting order may be holding it as margin`);
    }

    function onWdToChainChange() {
      const chainEl = el('wd-to-chain') as HTMLSelectElement | null;
      fillTokenSel('wd-to-token', chainEl?.value || '42161', selSym('wd-to-token'));
      updateWdConvHint();
      // Withdrawal capacity is per chain, and asterWdChain() can resolve to a
      // different payout chain than the one just picked. A stale figure here
      // would put a number in MAX that Aster refuses on the new chain, so the
      // balance is re-read rather than carried over.
      if (wdSrc === 'aster') loadAsterAvail();
    }

    function updateWdConvHint() {
      const toTokenEl = el('wd-to-token') as HTMLSelectElement | null;
      const toChainEl = el('wd-to-chain') as HTMLSelectElement | null;
      const toToken = toTokenEl?.value;
      const toChain = toChainEl?.value || '42161';
      const toSym   = selSym('wd-to-token');
      const hint    = el('wd-conv-hint');
      if (!hint) return;
      const direct = wdSrc === 'hl'
        // Hyperliquid only ever pays out native USDC on Arbitrum.
        ? toToken === USDC_ARB && toChain === '42161'
        // Aster's payout chains are per-asset, so "direct" is whatever
        // asterWdChain resolved the destination to for the selected currency.
        : asterWdChain() === toChain && toSym === wdAsset;
      if (direct) {
        hint.style.color = 'var(--text3,#878c8f)';
        hint.textContent = wdSrc === 'hl'
          ? 'Direct withdrawal — arrives as-is on Arbitrum'
          : `Direct withdrawal — Aster pays out ${wdAsset} on ${chainName(toChain)}, no bridge`;
      } else {
        hint.style.color = 'var(--accent,#50d2c1)';
        hint.textContent = wdSrc === 'hl'
          ? `LI.FI will convert to ${toSym} after the withdrawal lands`
          : `Aster pays out ${wdAsset} on ${chainName(asterWdChain())}, then LI.FI converts to ${toSym} on ${chainName(toChain)}`;
      }
      // The fee is quoted per chain (0.11 USDT on BNB Chain against 0.51 on
      // Arbitrum) and it is a SIGNED field, so a destination change has to
      // re-quote it — a stale number on screen is one the user did not
      // actually authorize.
      if (wdSrc === 'aster') refreshAsterWdFee().catch((e: any) => set('wd-fee', e.message));
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
        // Hyperliquid always pays out native USDC on Arbitrum; Aster pays out
        // the SELECTED asset on whichever chain it supports that asset on, so
        // "no conversion needed" is a different test per venue.
        const wdChain  = wdSrc === 'hl' ? '42161' : asterWdChain();
        const isSame   = wdSrc === 'hl'
          ? toToken === USDC_ARB && toChain === '42161'
          : wdChain === toChain && toSym === wdAsset;
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
            const before = await erc20BalOn(prov, ARB_CHAIN, USDC_ARB, user);
            await pollBal(prov, USDC_ARB, user, BigInt(Math.round(amt*1e6*0.97)), before, 360000);
            stepSet(1, 'done', 'USDC arrived in wallet');
            stepSet(2, 'active', `Getting LI.FI route to ${toSym}…`);
            const bal = await erc20BalOn(prov, ARB_CHAIN, USDC_ARB, user);
            const q = await lifiQuote('42161', toChain, USDC_ARB, toToken, bal.toString(), user, destAddr);
            stepSet(2, 'active', 'Approve + convert — confirm in wallet…');
            const h = await lifiExec(prov, q, user);
            stepSet(2, 'active', 'Confirming…');
            await pollReceipt(prov, h);
            stepSet(2, 'done', `${toSym} sent to ${destShort}`);
          }
        } else {
          // The fee goes INTO the signature, so it has to be settled and on
          // screen before the wallet prompt — and it has to be the number the
          // user already saw. A quote that moved between then and now stops
          // the withdrawal rather than substituting itself silently.
          const asset = wdAsset;
          const dec = asterDisplayDecimals(asset);
          const payout = wdPayout(asset, wdChain);
          const shown = asterWdFee;
          const shownChain = asterWdFeeChain;
          const shownAsset = asterWdFeeAsset;
          let fee: string;
          try { fee = (await refreshAsterWdFee()).fee; }
          catch (e: any) { return showSt('wd-st', 'err', e.message); }
          if (shown === null)
            return showSt('wd-st', 'err', `Aster’s withdrawal fee is ${fee} ${asset} — press Withdraw again to authorize it.`);
          // The chain and the currency count as much as the number: the same
          // 0.51 is quoted for USDT and USDC alike on Arbitrum, so comparing
          // fees alone would wave through a change the user never re-confirmed.
          if (shown !== fee || shownChain !== wdChain || shownAsset !== asset)
            return showSt('wd-st', 'err', `Aster’s withdrawal terms are now ${fee} ${asset} paid out on ${chainName(wdChain)} — check them and press Withdraw again.`);
          if (amt <= Number(fee))
            return showSt('wd-st', 'err', `Amount must be more than the ${fee} ${asset} Aster withdrawal fee`);
          // What actually lands in the wallet is net of the fee; polling for
          // the gross amount would time out on a withdrawal that succeeded.
          //
          // In the PAYOUT TOKEN's decimals, which are a property of the token on
          // that chain and not of the symbol — USDT is 6 on Arbitrum and 18 on
          // BNB Chain. The old flat 1e6 was right for exactly the one pairing
          // this flow used to support.
          const arriving = (toUnits(toPlainDecimal(amt - Number(fee)), payout.decimals) * BigInt(97)) / BigInt(100);
          if (isSame) {
            initProg('wd', [`Withdraw ${asset} from Aster to ${chainName(wdChain)}`]);
            stepSet(0, 'active', `Fee ${fee} ${asset} — confirm the withdrawal in your wallet…`);
            await asterWithdrawRaw(prov, user, amt, destAddr, fee, wdChain, asset);
            stepSet(0, 'done', `${fmt(amt, dec)} ${asset} → ${destShort} on ${chainName(wdChain)}`);
          } else {
            // The conversion leg is a transaction on the PAYOUT chain, so it
            // needs that chain's gas — and an account withdrawing USDT to BNB
            // Chain has no particular reason to hold BNB. Checked BEFORE the
            // signature: finding out afterwards means the funds have already
            // left Aster and are sitting somewhere the user cannot move them.
            //
            // Not checked when the payout IS the gas token: the arriving funds
            // are what pays for the swap.
            if (!payout.native) {
              const gas = await nativeBalOn(prov, wdChain, user).catch(() => null);
              if (gas !== null && gas === BigInt(0))
                return showSt('wd-st', 'err',
                  `Converting to ${toSym} happens on ${chainName(wdChain)} and your wallet has no gas there. `
                  + `Fund it first, or withdraw ${asset} on ${chainName(wdChain)} directly.`);
            }
            initProg('wd', [
              `Withdraw ${asset} from Aster to ${chainName(wdChain)}`,
              `Wait for ${asset} in wallet`,
              `Convert ${asset} → ${toSym} via LI.FI`,
            ]);
            stepSet(0, 'active', `Fee ${fee} ${asset} — confirm the withdrawal in your wallet…`);
            await asterWithdrawRaw(prov, user, amt, user, fee, wdChain, asset);
            stepSet(0, 'done', `${fmt(amt, dec)} ${asset} withdrawal submitted`);
            stepSet(1, 'active', 'Polling every 12s…');
            const before = await payoutBalOn(prov, wdChain, payout, user);
            await pollPayoutBal(prov, wdChain, payout, user, arriving, before, 600000);
            stepSet(1, 'done', `${asset} arrived in wallet`);
            stepSet(2, 'active', `Getting LI.FI route to ${toSym}…`);
            const swapping = await convertibleBalance(prov, wdChain, payout, user);
            const q = await lifiQuote(wdChain, toChain, payout.address, toToken, swapping.toString(), user, destAddr);
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
      void autoSwitchChain(chainEl?.value || '42161');
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

    // Native tokens pay for their own transfer, so MAX can never mean "all of
    // it" — the deposit would have nothing left to cover gas.
    // ponytail: one flat reserve across every chain. Fine while these are all
    // cheap L2s; read a real gas estimate if a pricier chain is ever added.
    const NATIVE_GAS_RESERVE = 0.0005;
    let dpBal = 0;
    // The exact balance. dpBal above is a float and only good enough for the
    // hint text; MAX must fill the input from THIS or it can ask for more than
    // the wallet holds.
    let dpBalRaw = BigInt(0);
    // Why dpBal is 0, when the reason is something other than "the wallet
    // really holds none". MAX reads this so it can say what is wrong instead
    // of quietly doing nothing.
    let dpBalErr = '';

    /** Balance of the currently-picked deposit token, for the hint and MAX.
     *  Only meaningful when the wallet is actually ON the picked chain — an
     *  eth_call goes wherever the wallet is pointed, so showing an Arbitrum
     *  balance under a Base selection would be worse than showing none. */
    async function refreshDpBal() {
      dpBal = 0;
      dpBalErr = '';
      const user = evmAddressRef.current;
      const sym = selSym('dp-from-token');
      if (!user) { dpBalErr = 'Connect your wallet from the top nav first'; return set('dp-bal', 'Connect wallet to see balance'); }
      try {
        const prov = getProv();
        const want = (el('dp-from-chain') as HTMLSelectElement | null)?.value || '42161';
        const on = String(parseInt(await prov.request({method:'eth_chainId'}) as string, 16));
        if (on !== want) {
          const name = CHAINS[chainIdx(want)]?.name ?? 'that network';
          dpBalErr = `Switch your wallet to ${name} first — the balance is read from the network the wallet is on`;
          return set('dp-bal', `Switch your wallet to ${name} to see your ${sym} balance`);
        }
        const token = (el('dp-from-token') as HTMLSelectElement | null)?.value || '';
        const dec = selDec('dp-from-token');
        dpBalRaw = await tokenBal(prov, token, user);
        dpBal = Number(dpBalRaw) / 10 ** dec;
        set('dp-bal', `Balance: ${fmt(dpBal, dpBal < 1 ? 6 : 2)} ${sym}`);
      } catch {
        dpBalErr = 'Could not read your balance from the wallet';
        set('dp-bal', 'Could not read balance');
      }
    }

    function dpMax() {
      const dpAmt = el('dp-amt') as HTMLInputElement | null;
      if (!dpAmt) return;
      // dpBal is 0 both when the wallet genuinely holds none of the picked
      // token and when the balance could not be read at all — no wallet, wallet
      // pointed at a different chain, failed call. Returning silently made MAX
      // look broken in exactly the cases the user needs telling about, so say
      // which one it is instead.
      if (dpBal <= 0) return showSt('dp-st', 'err', dpBalErr || `No ${selSym('dp-from-token')} in this wallet on this chain`);
      const isNative = ((el('dp-from-token') as HTMLSelectElement | null)?.value || '').toLowerCase() === ZERO_ADDR;
      const dec = selDec('dp-from-token');
      const usable = isNative ? dpBalRaw - toUnits(String(NATIVE_GAS_RESERVE), dec) : dpBalRaw;
      if (usable <= BigInt(0)) return showSt('dp-st', 'err', `Not enough ${selSym('dp-from-token')} left to cover gas`);
      dpAmt.value = fromUnits(usable, dec);
    }

    function updateDpHint() {
      set('dp-cur', selSym('dp-from-token'));
      refreshDpBal();
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
      labels.push(toHL ? 'Send USDC to the Hyperliquid bridge' : 'Deposit USDT to your Aster futures account');
      initProg('dp', labels);
      try {
        const user = await requireEVM();
        const prov = getProv();
        // Every deposit ENDS on Arbitrum — Hyperliquid's bridge transfer, or
        // Aster's approve + depositFor — and those need ETH there for gas. A
        // conversion route delivers USDT, never gas, so a wallet with none
        // converts successfully and then cannot move the result: MetaMask
        // replaces Confirm with an alert and the flow stalls with no error of
        // its own. Check before anything is signed, not after the funds moved.
        if (await nativeBalOn(prov, ARB_CHAIN, user) === BigInt(0))
          throw new Error('No ETH on Arbitrum to pay gas — the final deposit transaction needs it. Send a little ETH to Arbitrum first, then retry.');
        let sendAmt: bigint;
        if (direct) {
          sendAmt = toUnits(dpAmt?.value || '0', fromDec);
          const bal = await erc20BalOn(prov, ARB_CHAIN, tgt, user);
          if (bal < sendAmt) throw new Error(`Wallet holds only ${fmt(Number(bal) / 1e6)} ${tgtSym}`);
        } else {
          stepSet(0, 'active', 'Getting LI.FI route…');
          const q = await lifiQuote(fromChain, '42161', fromToken, tgt,
            toUnits(dpAmt?.value || '0', fromDec).toString(), user, user);
          // Both of these are knowable from the quote, and both used to be
          // discovered only after the user had signed something.
          await assertCanAffordRoute(prov, fromChain, user, q);
          // HL's floor, checked BEFORE the bridge rather than after it. The
          // old order converted first and then refused to forward the result,
          // leaving the bridged USDC sitting on Arbitrum — technically "still
          // in your wallet", but on a chain the user did not start from and
          // in a token they did not ask for.
          const willGet = BigInt(q.estimate?.toAmountMin ?? '0');
          if (toHL && willGet < HL_MIN_DEPOSIT)
            throw new Error(
              `This converts to about ${fmt(Number(willGet) / 1e6)} USDC, and Hyperliquid ` +
              `ignores deposits under 5 USDC. Deposit more ${fromSym}. Nothing has been signed.`,
            );
          // Arbitrum-pinned: the wallet is on the SOURCE chain here, because
          // the conversion below has to be signed there.
          const before = await erc20BalOn(prov, ARB_CHAIN, tgt, user);
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
        // The final leg is ALWAYS on Arbitrum — Hyperliquid's bridge and
        // Aster's vault both live there — while a converted deposit leaves the
        // wallet on the SOURCE chain, because that is where the conversion had
        // to be signed. eth_sendTransaction goes wherever the wallet is
        // pointed, so both branches switch here; the HL one never did, and sent
        // its "Arbitrum USDC" transfer to that address on BNB Chain.
        await ensureChain(prov, ARB_CHAIN, 'Switch your wallet to Arbitrum to finish the deposit');
        if (!direct) {
          // Re-read rather than trust the figure pollBal saw. Minutes and a
          // wallet confirmation pass between the two, and a route that collects
          // its fee on the DESTINATION side leaves less behind than the arrival
          // that satisfied the poll — 0.578152 USDT held against 0.592398
          // requested, which the token contract rejects as "ERC20: transfer
          // amount exceeds balance" on a transaction the user cannot confirm.
          // Never ask to move more than the wallet holds at this instant.
          const held = await erc20BalOn(prov, ARB_CHAIN, tgt, user);
          if (held < sendAmt) {
            sendAmt = held;
            stepSet(last, 'active', `Adjusted to the ${fmt(Number(held) / 1e6)} ${tgtSym} actually in the wallet…`);
          }
        }
        if (sendAmt <= BigInt(0))
          throw new Error(`No ${tgtSym} arrived in the wallet — nothing to deposit.`);
        if (toHL && sendAmt < HL_MIN_DEPOSIT)
          throw new Error('Hyperliquid ignores deposits under 5 USDC — it would be lost. Funds are still in your wallet.');
        if (toHL) {
          stepSet(last, 'active', `Sending ${fmt(Number(sendAmt) / 1e6)} ${tgtSym} — confirm in wallet…`);
          const dh = await erc20Send(prov, tgt, user, HL_BRIDGE, sendAmt.toString());
          await pollReceipt(prov, dh);
          stepSet(last, 'done', 'Sent — Hyperliquid credits it in ~1 min');
        } else {
          // Aster is a vault call, not a transfer: ensureApproval only prompts
          // when the existing allowance is short.
          stepSet(last, 'active', `Checking ${tgtSym} allowance — approve in wallet if prompted…`);
          await ensureApproval(prov, tgt, user, asterVault(ASTER_DEPOSIT_CHAIN), sendAmt.toString());
          stepSet(last, 'active', `Depositing ${fmt(Number(sendAmt) / 1e6)} ${tgtSym} — confirm in wallet…`);
          const dh = await asterDepositFor(prov, ASTER_DEPOSIT_CHAIN, tgt, user, sendAmt.toString());
          await pollAsterDeposit(prov, dh);
          stepSet(last, 'done', 'Credited to your Aster futures account ✓');
        }
        showSt('dp-st', 'ok', 'Deposit complete ✓');
        if (dpAmt) dpAmt.value = '';
      } catch (e: any) {
        stepFail(e.code === 4001 ? 'Rejected by wallet' : e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    // ── Swap (LI.FI, same-chain) ──────────────────────────────────────────────
    // Same quote endpoint as the Send tab, with fromChain === toChain: LI.FI
    // routes those through DEX aggregators rather than a bridge. Deliberately
    // NOT using a token-list endpoint: those return thousands of tokens per
    // chain and would need a searchable picker to be usable, while CHAINS above
    // already lists the ones this app actually deals in.
    // LI.FI addresses native gas tokens with the zero address, which is what
    // CHAINS already carries — no sentinel translation on the way out.
    const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

    let swQuote: any = null;
    let swTimer: any = null;

    function onSwChainChange() {
      const c = (el('sw-chain') as HTMLSelectElement | null)?.value || '42161';
      fillTokenSel('sw-from', c, selSym('sw-from'));
      fillTokenSel('sw-to', c, selSym('sw-to'));
      void autoSwitchChain(c);
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
      // LI.FI simulates the route against a real account, so fromAddress is
      // required — there is no anonymous price preview to fall back on.
      if (!evmAddressRef.current) return showSt('sw-st', 'err', 'Connect your wallet from the top nav first');
      const wrap = el('sw-quote-wrap'); if (wrap) wrap.style.display = '';
      const card = el('sw-qcard'); if (card) card.className = 'quote-card loading';
      const skel = el('sw-skel'); if (skel) skel.style.display = '';
      const body = el('sw-qbody'); if (body) body.style.display = 'none';
      try {
        const amount = toUnits((el('sw-amt') as HTMLInputElement | null)?.value || '0', selDec('sw-from')).toString();
        const q = await lifiQuote(chain, chain, src, dst, amount, evmAddressRef.current, evmAddressRef.current);
        // A 200 with no transactionRequest is a route LI.FI cannot execute —
        // fail here rather than letting execSwap dereference it.
        if (!q?.transactionRequest?.to) throw new Error('No executable route found');
        const toDec  = q.action?.toToken?.decimals ?? selDec('sw-to');
        const toSym  = q.action?.toToken?.symbol ?? selSym('sw-to');
        const out    = Number(q.estimate?.toAmount ?? 0) / 10 ** toDec;
        // Only the routing steps — includedSteps also carries a `protocol`
        // step for LI.FI's own fee collection, which is not a venue.
        const via = q.includedSteps
          ?.filter((s: any) => s.type === 'swap' || s.type === 'cross')
          .map((s: any) => s.toolDetails?.name || s.tool).filter(Boolean).join(' + ') || '';
        // LI.FI takes a fee on the route (0.25% at the time of writing) where
        // 1inch's API took none — it is already deducted from toAmount above,
        // so show it rather than letting it look like a worse price.
        const fee = q.estimate?.feeCosts?.reduce((a: number, f: any) => a + Number(f.amountUSD || 0), 0) ?? 0;
        // The whole quote is kept, not just its inputs: execSwap signs the
        // transactionRequest LI.FI already built, the way the Send tab does.
        swQuote = q;
        set('sw-recv-amt', fmt(out, out < 1 ? 6 : 4));
        set('sw-recv-sym', toSym);
        set('sw-rate', `1 ${selSym('sw-from')} ≈ ${fmt(out / amt, out / amt < 1 ? 6 : 4)} ${toSym}${via ? ` · via ${via}` : ''}`);
        set('sw-fee', fee ? `Route fee ~$${fmt(fee)} — already deducted above` : ' ');
        if (card) card.className = 'quote-card';
        if (skel) skel.style.display = 'none';
        if (body) body.style.display = '';
        const btn = el('sw-btn') as HTMLButtonElement | null;
        if (btn) btn.disabled = !evmAddressRef.current;
      } catch (e: any) {
        if (card) card.className = 'quote-card error';
        if (skel) skel.style.display = 'none';
        if (body) body.style.display = '';
        set('sw-recv-amt', e.message); set('sw-recv-sym', ''); set('sw-rate', ''); set('sw-fee', '');
      }
    }

    async function execSwap() {
      const q = swQuote;
      if (!q) return;
      const btn = el('sw-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      const st = el('sw-st'); if (st) st.style.display = 'none';
      const fromSym = q.action?.fromToken?.symbol ?? selSym('sw-from');
      const toSym   = q.action?.toToken?.symbol   ?? selSym('sw-to');
      initProg('sw', [`Approve ${fromSym}`, `Swap ${fromSym} → ${toSym}`]);
      try {
        const user = await requireEVM();
        const prov = getProv();
        const tx = q.transactionRequest;
        // The quote is built against one chain's router and
        // eth_sendTransaction goes wherever the wallet is pointed, so put it
        // on that chain before signing anything.
        const chainId = String(q.action?.fromChainId ?? (el('sw-chain') as HTMLSelectElement | null)?.value ?? '42161');
        stepSet(0, 'active', `Switching to ${chainName(chainId)}…`);
        await ensureChain(prov, chainId, `Switch your wallet to ${chainName(chainId)} to swap`);
        // Native gas tokens need no allowance; ensureApproval no-ops on the
        // zero address, and LI.FI names the ERC-20 spender in
        // estimate.approvalAddress (the router can differ per route).
        stepSet(0, 'active', 'Checking allowance…');
        await ensureApproval(prov, q.action?.fromToken?.address ?? '', user, q.estimate?.approvalAddress || tx.to, q.action?.fromAmount ?? '0');
        stepSet(0, 'done', 'Allowance ready');
        stepSet(1, 'active', 'Confirm the swap in your wallet…');
        const hash = await prov.request({method:'eth_sendTransaction', params:[{
          from: user, to: tx.to, data: tx.data,
          value: tx.value ? '0x'+BigInt(tx.value).toString(16) : '0x0',
          ...(tx.gasLimit ? {gas:'0x'+BigInt(tx.gasLimit).toString(16)} : {}),
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
      void autoSwitchChain(fc?.value || '42161');
      void refreshSendBal();
      scheduleQuote();
    }
    function onFromTokenChange() { set('send-cur-badge', selSym('from-token')); void refreshSendBal(); scheduleQuote(); }
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
      const fromAmount = toUnits(sendAmt?.value || '0', fromDec).toString();
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
        // The displayed quote came from a 650ms debounce while the user was
        // still typing, and it is signed whenever they eventually press Send —
        // often minutes later, after reading it and confirming a chain switch.
        // Intent-based routes (NearIntents et al.) embed a deadline and the
        // calldata simply stops being valid, which surfaces as a wallet
        // "likely to fail" warning and a bare custom error rather than
        // anything this app could explain. So re-quote here and sign THAT.
        showSt('send-st', 'inf', 'Refreshing the quote…');
        const fresh = await lifiQuote(
          String(curQuote.action.fromChainId), String(curQuote.action.toChainId),
          curQuote.action.fromToken.address, curQuote.action.toToken.address,
          curQuote.action.fromAmount, user,
          curQuote.action.toAddress || user,
        );
        if (!fresh?.transactionRequest?.to) throw new Error('LI.FI returned no executable route — try again');
        // Only the price may drift, and only downward past the slippage the
        // user already accepted is a reason to stop and re-show it.
        const shown = BigInt(curQuote.estimate?.toAmount ?? '0');
        const now   = BigInt(fresh.estimate?.toAmount ?? '0');
        const floor = shown * BigInt(99) / BigInt(100);
        if (shown > BigInt(0) && now < floor) {
          curQuote = fresh;
          fetchQuote();
          throw new Error('The price moved more than 1% while you were confirming — check the updated quote and send again.');
        }
        curQuote = fresh;
        const tx = fresh.transactionRequest;
        const fAddr = fresh.action?.fromToken?.address ?? '';
        const fAmt  = fresh.action?.fromAmount ?? '0';
        // The quote is built against the SOURCE chain's router, and both the
        // allowance call and the send go wherever the wallet is pointed. The
        // picker auto-switches, but the wallet can be moved from under it
        // afterwards, so confirm here too rather than signing on the wrong one.
        const srcChain = String(fresh.action?.fromChainId ?? (el('from-chain') as HTMLSelectElement | null)?.value ?? '42161');
        await ensureChain(prov, srcChain, `Switch your wallet to ${chainName(srcChain)} to send`);
        showSt('send-st', 'inf', 'Checking allowance…');
        await ensureApproval(prov, fAddr, user, fresh.estimate?.approvalAddress || tx.to, fAmt);
        const sendTx = {
          from:user, to:tx.to, data:tx.data,
          value: tx.value ? '0x'+BigInt(tx.value).toString(16) : '0x0',
          ...(tx.gasLimit ? {gas:'0x'+BigInt(tx.gasLimit).toString(16)} : {}),
        };
        if (btn) btn.textContent = 'Confirm in wallet…';
        showSt('send-st', 'inf', 'Confirm in wallet…');
        const hash = await prov.request({method:'eth_sendTransaction', params:[sendTx]}) as string;
        // eth_sendTransaction resolves as soon as the wallet ACCEPTS the
        // transaction, which says nothing about whether it lands. Reporting
        // "Sent!" there declared success for transactions that were still
        // pending — and for ones the wallet went on to drop or that reverted,
        // leaving the UI claiming success while MetaMask showed a failure.
        // Every other flow on this page waits for the receipt; this one did not.
        showSt('send-st', 'inf', `Submitted — waiting for confirmation… ${hash.slice(0,20)}…`);
        await pollReceipt(prov, hash);
        showSt('send-st', 'ok', `✓ Confirmed! Tx: ${hash.slice(0,20)}…`);
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

    // Mirrors the deposit tab's dpBal/dpBalErr pair: 0 means either "the wallet
    // holds none" or "the balance could not be read", and MAX has to tell the
    // user which. It used to be a stub that only printed a hint, so MAX looked
    // dead — it never read a balance or filled the amount at all.
    let sendBal = 0;
    /** Exact balance — MAX fills from this, never from the float above. */
    let sendBalRaw = BigInt(0);
    let sendBalErr = '';

    /** Balance of the picked send token. Like the deposit tab, only meaningful
     *  when the wallet is on the picked chain — an eth_call goes wherever the
     *  wallet is pointed. onFromChainChange auto-switches it there, so this is
     *  normally true by the time the user reaches MAX. */
    async function refreshSendBal() {
      sendBal = 0;
      sendBalErr = '';
      const user = evmAddressRef.current;
      const sym = selSym('from-token');
      if (!user) { sendBalErr = 'Connect your wallet from the top nav first'; return set('send-bal', 'Connect wallet to see balance'); }
      try {
        const prov = getProv();
        const want = (el('from-chain') as HTMLSelectElement | null)?.value || '42161';
        const on = String(parseInt(await prov.request({method:'eth_chainId'}) as string, 16));
        if (on !== want) {
          const name = chainName(want);
          sendBalErr = `Switch your wallet to ${name} first — the balance is read from the network the wallet is on`;
          return set('send-bal', `Switch your wallet to ${name} to see your ${sym} balance`);
        }
        const token = (el('from-token') as HTMLSelectElement | null)?.value || '';
        const dec = selDec('from-token');
        sendBalRaw = await tokenBal(prov, token, user);
        sendBal = Number(sendBalRaw) / 10 ** dec;
        set('send-bal', `Balance: ${fmt(sendBal, sendBal < 1 ? 6 : 2)} ${sym}`);
      } catch {
        sendBalErr = 'Could not read your balance from the wallet';
        set('send-bal', 'Could not read balance');
      }
    }

    function sendMax() {
      const sendAmt = el('send-amt') as HTMLInputElement | null;
      if (!sendAmt) return;
      if (sendBal <= 0) return showSt('send-st', 'err', sendBalErr || `No ${selSym('from-token')} in this wallet on this chain`);
      // A native token pays for its own transfer, so MAX can never mean "all of
      // it" — the bridge transaction itself would have nothing left for gas.
      const isNative = ((el('from-token') as HTMLSelectElement | null)?.value || '').toLowerCase() === ZERO_ADDR;
      const dec = selDec('from-token');
      const usable = isNative ? sendBalRaw - toUnits(String(NATIVE_GAS_RESERVE), dec) : sendBalRaw;
      if (usable <= BigInt(0)) return showSt('send-st', 'err', `Not enough ${selSym('from-token')} left to cover gas`);
      sendAmt.value = fromUnits(usable, dec);
      scheduleQuote();
    }

    function setDir(dir: string) {
      btwDir = dir;
      const isHL = dir === 'hl-to-aster';
      const hl2as = el('dtab-hl2as'); if (hl2as) hl2as.className = 'dir-tab ' + (isHL ? 'aHL' : '');
      const as2hl = el('dtab-as2hl'); if (as2hl) as2hl.className = 'dir-tab ' + (isHL ? '' : 'aAS');
      set('btw-cur', isHL ? 'USDC' : 'USDT');
      const btwBtn = el('btw-btn'); if (btwBtn) btwBtn.className = 'exec-btn ' + (isHL ? 'hl' : 'as');
      const btwProg = el('btw-prog'); if (btwProg) btwProg.style.display = 'none';
      const btwSt = el('btw-st'); if (btwSt) btwSt.style.display = 'none';
      if (isHL) {
        set('btw-bal', hlEquity ? `Balance: $${fmt(hlEquity)} USDC` : ' ');
      } else {
        // The Aster side of this tab never asked for a balance at all — it
        // blanked the hint and MAX did nothing, which read as "you have no
        // funds" to anyone who did. Same deliberate-action rule as the
        // Withdraw tab: picking this direction is what the agent-approval
        // prompt hangs off, never a page load or a wallet connect.
        set('btw-bal', 'Reading your Aster balance…');
        loadAsterWithdrawable().then(() => {
          if (btwDir !== 'aster-to-hl') return; // user moved on mid-flight
          set('btw-bal', asterWithdrawable > 0
            ? `Withdrawable: ${fmt(asterWithdrawable)} USDT`
            : asterBalErr || 'No withdrawable USDT in your Aster account');
        });
      }
    }

    function btwMax() {
      const btwAmt = el('btw-amt') as HTMLInputElement | null;
      if (!btwAmt) return;
      if (btwDir === 'hl-to-aster') {
        if (hlEquity > 0) btwAmt.value = hlEquity.toFixed(2);
        return;
      }
      // Withdrawable, not account balance — see loadAsterWithdrawable. The
      // Between Accounts route is pinned to Arbitrum because the LI.FI leg and
      // the Hyperliquid bridge both only exist there.
      if (asterWithdrawable > 0) btwAmt.value = asterWithdrawable.toFixed(2);
      else showSt('btw-st', 'err', asterBalErr || 'No withdrawable USDT in your Aster account');
    }

    async function execBtw() {
      const btwAmt = el('btw-amt') as HTMLInputElement | null;
      const amt = parseFloat(btwAmt?.value || '0') || 0;
      if (!amt) return showSt('btw-st', 'err', 'Enter an amount');
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
            'Deposit USDT to your Aster futures account',
          ]);
          stepSet(0, 'active', 'Sign withdrawal in wallet…');
          await hlWithdrawRaw(prov, user, amt, user);
          stepSet(0, 'done', `$${fmt(amt)} USDC submitted to Arbitrum`);
          stepSet(1, 'active', 'Polling every 12s (up to 6 min)…');
          const ub = await erc20BalOn(prov, ARB_CHAIN, USDC_ARB, user);
          await pollBal(prov, USDC_ARB, user, BigInt(Math.round(amt*1e6*0.97)), ub, 360000);
          stepSet(1, 'done', 'USDC arrived in wallet');
          stepSet(2, 'active', 'Getting LI.FI swap route…');
          const usdcBal = await erc20BalOn(prov, ARB_CHAIN, USDC_ARB, user);
          const q = await lifiQuote('42161', '42161', USDC_ARB, USDT_ARB, usdcBal.toString(), user, user);
          stepSet(2, 'active', 'Approve + swap — confirm in wallet…');
          const sh = await lifiExec(prov, q, user);
          stepSet(2, 'active', 'Confirming swap…');
          await pollReceipt(prov, sh);
          stepSet(2, 'done', 'USDC → USDT swapped');
          await ensureChain(prov, ASTER_DEPOSIT_CHAIN, 'Switch your wallet to Arbitrum to deposit to Aster');
          const usdtBal = await erc20BalOn(prov, ARB_CHAIN, USDT_ARB, user);
          stepSet(3, 'active', 'Checking USDT allowance — approve in wallet if prompted…');
          await ensureApproval(prov, USDT_ARB, user, asterVault(ASTER_DEPOSIT_CHAIN), usdtBal.toString());
          stepSet(3, 'active', `Depositing ${fmt(Number(usdtBal)/1e6, 2)} USDT — confirm…`);
          const dh = await asterDepositFor(prov, ASTER_DEPOSIT_CHAIN, USDT_ARB, user, usdtBal.toString());
          await pollAsterDeposit(prov, dh);
          stepSet(3, 'done', 'Credited to your Aster futures account ✓');
          showSt('btw-st', 'ok', `Transfer complete — $${fmt(amt)} BASIC → EXTRA`);
        } else {
          // Same rule as the Withdraw tab: the fee is signed, so it has to be
          // quoted and shown before the wallet prompt, never after it.
          // Pinned to Arbitrum, unlike the Withdraw tab: the next three steps
          // swap that USDT to USDC and hand it to the Hyperliquid bridge, both
          // of which only exist on Arbitrum.
          let fee: string;
          try { fee = await asterWithdrawFee(ASTER_WD_FALLBACK_CHAIN, ASTER_BTW_ASSET); }
          catch (e: any) { return showSt('btw-st', 'err', e.message); }
          if (amt <= Number(fee))
            return showSt('btw-st', 'err', `Amount must be more than the ${fee} USDT Aster withdrawal fee`);
          // Checked BEFORE the first wallet prompt. Aster's payout cap sits
          // well below availableBalance, and finding out afterwards would mean
          // the user has already signed a withdrawal that cannot succeed.
          if (asterWithdrawableChain !== ASTER_WD_FALLBACK_CHAIN) await loadAsterWithdrawable();
          if (asterWithdrawable > 0 && amt > asterWithdrawable)
            return showSt('btw-st', 'err',
              `Aster will only pay out ${fmt(asterWithdrawable)} USDT on ${chainName(ASTER_WD_FALLBACK_CHAIN)} right now — lower the amount`);
          initProg('btw', [
            `Withdraw USDT from Aster (fee ${fee} USDT)`,
            'Wait for USDT in wallet',
            'Swap USDT → USDC on Arbitrum',
            'Send USDC to the Hyperliquid bridge',
          ]);
          stepSet(0, 'active', `Fee ${fee} USDT — confirm both signatures in your wallet…`);
          await asterWithdrawRaw(prov, user, amt, user, fee, ASTER_WD_FALLBACK_CHAIN, ASTER_BTW_ASSET);
          stepSet(0, 'done', `${fmt(amt)} USDT withdrawal submitted`);
          stepSet(1, 'active', 'Polling every 12s (up to 10 min)…');
          const tb = await erc20BalOn(prov, ARB_CHAIN, USDT_ARB, user);
          await pollBal(prov, USDT_ARB, user, BigInt(Math.round((amt - Number(fee)) * 1e6 * 0.97)), tb, 600000);
          stepSet(1, 'done', 'USDT arrived in wallet');
          stepSet(2, 'active', 'Getting LI.FI swap route…');
          const usdtBal = await erc20BalOn(prov, ARB_CHAIN, USDT_ARB, user);
          const q = await lifiQuote('42161', '42161', USDT_ARB, USDC_ARB, usdtBal.toString(), user, user);
          const usdcBefore = await erc20BalOn(prov, ARB_CHAIN, USDC_ARB, user);
          stepSet(2, 'active', 'Approve + swap — confirm in wallet…');
          const sh = await lifiExec(prov, q, user);
          stepSet(2, 'active', 'Confirming swap…');
          await pollReceipt(prov, sh);
          stepSet(2, 'done', 'USDT → USDC swapped on Arbitrum');
          // HL does NOT pick up USDC sitting in the wallet — this step used to
          // just declare success and leave the funds stranded there. The
          // deposit is an explicit transfer to Bridge2.
          const swapped = (await erc20BalOn(prov, ARB_CHAIN, USDC_ARB, user)) - usdcBefore;
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

    /** An eth_call that hit no contract returns '0x' — truthy, so it slipped
     *  past `hex || '0x0'` and surfaced as "Cannot convert 0x to a BigInt".
     *  That is never a zero balance, it means the read went to the wrong place,
     *  so say so instead of quietly reporting 0 (a wrong 0 baseline would
     *  inflate the "how much arrived" delta the deposit forwards). */
    function hexToBigInt(hex: string | null | undefined, what: string): bigint {
      if (hex === null || hex === undefined || hex === '' || hex === '0x')
        throw new Error(`${what}: no answer from the contract — wrong network for this token?`);
      return BigInt(hex);
    }

    /** eth_call pinned to a specific chain, whatever the wallet is pointed at.
     *  Cross-chain flows must read the DESTINATION chain (has the converted
     *  USDT landed on Arbitrum yet?) while the wallet is still on the source
     *  chain to sign there — the wallet cannot answer that, and asking it
     *  anyway is what produced the '0x'. Uses the wallet when it happens to be
     *  on the right chain already, and the backend's read-only RPC proxy
     *  otherwise. */
    async function ethCallOn(prov: any, chainId: string, to: string, data: string): Promise<string> {
      try {
        const on = String(parseInt(await prov.request({method:'eth_chainId'}) as string, 16));
        if (on === chainId) return await prov.request({method:'eth_call', params:[{to, data}, 'latest']});
      } catch { /* fall through to the proxy */ }
      const r = await fetch(`/rpc/${chainId}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({method: 'eth_call', params: [{to, data}, 'latest']}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || `Could not read ${chainName(chainId)}`);
      return d.result as string;
    }

    /** Balance of `token` as held on `chainId`, regardless of where the wallet
     *  is. Callers that are already guaranteed to be on the right chain can
     *  still use it — it costs one extra eth_chainId. */
    async function erc20BalOn(prov: any, chainId: string, token: string, owner: string): Promise<bigint> {
      const data = '0x70a08231' + owner.slice(2).padStart(64, '0');
      const hex = await ethCallOn(prov, chainId, token, data);
      return hexToBigInt(hex, `${chainName(chainId)} balance`);
    }

    /** Native (gas) balance of `chainId`, wherever the wallet is pointed. */
    async function nativeBalOn(prov: any, chainId: string, owner: string): Promise<bigint> {
      try {
        const on = String(parseInt(await prov.request({method:'eth_chainId'}) as string, 16));
        if (on === chainId)
          return hexToBigInt(await prov.request({method:'eth_getBalance', params:[owner, 'latest']}), 'Gas balance');
      } catch { /* fall through to the proxy */ }
      const r = await fetch(`/rpc/${chainId}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({method: 'eth_getBalance', params: [owner, 'latest']}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || `Could not read ${chainName(chainId)}`);
      return hexToBigInt(d.result, 'Gas balance');
    }

    async function getERC20Bal(prov: any, token: string, owner: string): Promise<bigint> {
      const data = '0x70a08231' + owner.slice(2).padStart(64, '0');
      const hex = await prov.request({method:'eth_call', params:[{to:token, data}, 'latest']});
      return hexToBigInt(hex, 'Token balance');
    }

    /** balanceOf for ERC-20s, eth_getBalance for the chain's native token —
     *  the token pickers list ETH/BNB/etc. as the zero address, and calling
     *  balanceOf on 0x0 silently returns 0 rather than failing. */
    async function tokenBal(prov: any, token: string, owner: string): Promise<bigint> {
      if (!token || token.toLowerCase() === ZERO_ADDR)
        return hexToBigInt(await prov.request({method:'eth_getBalance', params:[owner, 'latest']}), 'Native balance');
      return getERC20Bal(prov, token, owner);
    }

    async function ensureApproval(prov: any, token: string, owner: string, spender: string, amount: string) {
      const ZERO = '0x0000000000000000000000000000000000000000';
      if (!token || token === ZERO) return;
      const pad = (v: string) => v.replace(/^0x/, '').padStart(64, '0');
      const allHex = await prov.request({method:'eth_call', params:[{to:token, data:'0xdd62ed3e'+pad(owner)+pad(spender)}, 'latest']});
      if (hexToBigInt(allHex, 'Allowance') >= BigInt(amount)) return;
      const appHash = await prov.request({method:'eth_sendTransaction', params:[{from:owner, to:token, data:'0x095ea7b3'+pad(spender)+BigInt(amount).toString(16).padStart(64,'0')}]});
      await pollReceipt(prov, appHash, 120000);
    }

    async function erc20Send(prov: any, token: string, from: string, to: string, amount: string) {
      const pad = (v: string) => v.replace(/^0x/, '').padStart(64, '0');
      return prov.request({method:'eth_sendTransaction', params:[{from, to:token, data:'0xa9059cbb'+pad(to)+BigInt(amount).toString(16).padStart(64,'0')}]});
    }

    /** Aster's EVM deposit — a vault call, not a transfer to an address.
     *  Credits `user`'s FUTURES account directly; see @/lib/asterDeposit for
     *  the calldata and for why the `broker` argument is the dangerous one.
     *  ERC-20s must be approved for the vault first — the CALLER does that, so
     *  it can report that extra wallet prompt as its own progress step. */
    async function asterDepositFor(prov: any, chainId: string, token: string, user: string, amount: string) {
      const data = encodeDepositFor({ token, forAddress: user, amount });
      return prov.request({method:'eth_sendTransaction', params:[{
        from: user, to: asterVault(chainId), data,
        value: isNativeCurrency(token) ? '0x'+BigInt(amount).toString(16) : '0x0',
      }]});
    }

    /** pollReceipt, but a revert on the vault gets a cause rather than the
     *  bare 'Transaction reverted' — it is almost always an unsupported token
     *  (`CurrencyNotSupport`) or an allowance that did not land. */
    async function pollAsterDeposit(prov: any, hash: string) {
      try {
        return await pollReceipt(prov, hash);
      } catch (e: any) {
        if (/reverted/i.test(String(e?.message ?? '')))
          throw new Error('Aster’s deposit vault reverted — the token is not supported on this chain, or the approval did not go through. Your funds are still in your wallet.');
        throw e;
      }
    }

    async function pollReceipt(prov: any, hash: string, ms = 120000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const r = await prov.request({method:'eth_getTransactionReceipt', params:[hash]});
        if (r) { if (r.status === '0x0') throw new Error('Transaction reverted'); return r; }
        await sleep(2500);
      }
      // A hash with no receipt AND no transaction behind it was never
      // broadcast: the wallet handed back a hash it computed locally and then
      // dropped the transaction. MetaMask's Smart Transactions does exactly
      // this — it routes through a private relay and cancels silently when the
      // relay predicts a failure, leaving nothing on-chain, the nonce
      // untouched and no gas spent. Indistinguishable from a stuck transaction
      // unless we look, so look, and say which one it is.
      const tx = await prov.request({method:'eth_getTransactionByHash', params:[hash]}).catch(() => null);
      if (!tx) throw new Error(
        'Your wallet never broadcast this transaction — it is on no chain and no gas was spent. '
        + 'If you use MetaMask, turn off Settings → Advanced → Smart Transactions and try again.',
      );
      throw new Error('Confirmation timeout');
    }

    /** Balance of an Aster payout token, whichever kind it is. A native payout
     *  (BNB on BSC, ETH on Arbitrum) has no balanceOf to call — eth_call to the
     *  zero address answers '0x', which hexToBigInt rightly refuses to read as
     *  a balance, so this has to branch rather than pass an address through. */
    async function payoutBalOn(prov: any, chainId: string, token: AsterPayoutToken, owner: string): Promise<bigint> {
      return token.native
        ? nativeBalOn(prov, chainId, owner)
        : erc20BalOn(prov, chainId, token.address, owner);
    }

    async function pollPayoutBal(
      prov: any, chainId: string, token: AsterPayoutToken, owner: string,
      needed: bigint, baseline: bigint, timeoutMs: number,
    ): Promise<bigint> {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const bal = await payoutBalOn(prov, chainId, token, owner);
        if (bal >= baseline + needed) return bal;
        await sleep(12000);
      }
      throw new Error('Timeout — funds did not arrive. Check your account and retry.');
    }

    /** How much of a just-arrived payout can actually be handed to LI.FI.
     *
     *  Everything, unless it is the gas token — in which case the swap's own
     *  fee comes out of the same balance being swapped, so offering all of it
     *  produces a route the wallet cannot pay for. Same reserve MAX uses on the
     *  Send tab, for the same reason. */
    async function convertibleBalance(prov: any, chainId: string, token: AsterPayoutToken, owner: string): Promise<bigint> {
      const bal = await payoutBalOn(prov, chainId, token, owner);
      if (!token.native) return bal;
      const reserve = toUnits(String(NATIVE_GAS_RESERVE), token.decimals);
      if (bal <= reserve)
        throw new Error(`Not enough ${chainName(chainId)} gas left to convert — the withdrawal is in your wallet`);
      return bal - reserve;
    }

    async function pollBal(prov: any, token: string, owner: string, needed: bigint, baseline: bigint, timeoutMs: number, chainId = ARB_CHAIN) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const bal = await erc20BalOn(prov, chainId, token, owner);
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

    /** Throws when the wallet cannot cover a LI.FI route on the SOURCE chain.
     *
     *  The route's own transactionRequest is the only honest cost: for a
     *  NATIVE deposit the amount being bridged and the gas paying for it come
     *  out of the same balance, so MAX holding back a flat NATIVE_GAS_RESERVE
     *  is not enough on its own — LI.FI quoted gasLimit 1_400_469 for
     *  BNB → Arbitrum USDC, which at BSC's busier gas prices costs several
     *  times that reserve.
     *
     *  Getting this wrong is invisible rather than loud: the node rejects the
     *  transaction at broadcast for insufficient funds, so it never reaches a
     *  block. The wallet still shows a hash — one that no explorer can find —
     *  and marks it failed, while nothing was actually spent. */
    async function assertCanAffordRoute(prov: any, chainId: string, user: string, quote: any) {
      const tx  = quote?.transactionRequest ?? {};
      const val = BigInt(tx.value ?? 0);
      const px  = BigInt(tx.gasPrice ?? tx.maxFeePerGas ?? 0);
      const gas = BigInt(tx.gasLimit ?? 0) * px;
      // Half again on the gas: the wallet picks its own gas price at
      // confirmation time, minutes after the quote, and a transaction that
      // only just fits is one gas tick away from this exact failure.
      const need = val + gas + gas / BigInt(2);
      if (need <= BigInt(0)) return;
      const have = await nativeBalOn(prov, chainId, user);
      if (have >= need) return;
      const sym = CHAINS[chainIdx(chainId)]?.tokens.find(t => t.addr === ZERO_ADDR)?.sym ?? 'gas';
      throw new Error(
        `Not enough ${sym} on ${chainName(chainId)} — this route needs about ` +
        `${fmt(Number(need) / 1e18, 6)} ${sym} (amount plus gas) and the wallet holds ` +
        `${fmt(Number(have) / 1e18, 6)}. Lower the amount or top up. Nothing has been signed.`,
      );
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

    // ── Aster withdrawal (V3) ─────────────────────────────────────────────
    // Which chains Aster pays which asset out on, and as which token, lives in
    // @/lib/asterAssets — it is per-asset data (BNB only on BSC, USDT on three
    // chains) rather than the one flat set this page used to carry.

    // The Between Accounts flow is still USDT-pinned: its next legs are a LI.FI
    // swap and the Hyperliquid bridge, both of which only exist on Arbitrum.
    // Named separately from the Withdraw tab's fallback so that stays true when
    // this one stops being.
    const ASTER_WD_FALLBACK_CHAIN = '42161';
    const ASTER_BTW_ASSET = 'USDT';

    /** Where a withdrawal of `asset` goes when the user's chosen destination
     *  isn't a chain Aster pays that asset out on.
     *
     *  Arbitrum when it is an option, because that is where the LI.FI leg has
     *  the most depth and where the rest of this page already operates.
     *  Otherwise whichever chain Aster does pay out on — for BNB that is only
     *  ever BSC, and defaulting it to Arbitrum the way the old flat constant
     *  did would have signed a withdrawal Aster rejects outright. */
    function asterWdFallbackChain(asset: string): string {
      const chains = asterWithdrawChains(asset);
      if (!chains.length) return ASTER_WD_FALLBACK_CHAIN;
      if (chains.includes(ASTER_WD_FALLBACK_CHAIN)) return ASTER_WD_FALLBACK_CHAIN;
      // Prefer a chain Aster currently has capacity on, when the matrix has
      // been read — otherwise the first supported one, which is still a chain
      // it CAN pay out on rather than a guess.
      const withCapacity = chains.find(c => (asterMatrix[asset]?.[c]?.withdrawable ?? 0) > 0);
      return withCapacity ?? chains[0];
    }

    /** The chain the withdrawal itself leaves Aster on — which is NOT always
     *  the chain the user picked to receive on. Direct when Aster pays the
     *  selected asset out there and the user asked for that same asset (one
     *  signature pair, one fee, no bridge); otherwise it lands on the fallback
     *  chain and LI.FI converts from there. Withdrawing USDT straight to BNB
     *  Chain costs 0.11 against Arbitrum's 0.51, so this is real money, not
     *  just a hop saved. */
    function asterWdChain(): string {
      const toChain = (el('wd-to-chain') as HTMLSelectElement | null)?.value || '';
      return asterPayoutToken(wdAsset, toChain) && selSym('wd-to-token') === wdAsset
        ? toChain
        : asterWdFallbackChain(wdAsset);
    }

    /** The token Aster will actually deliver, for the asset and chain a
     *  withdrawal is about to use. Throws rather than defaulting: every caller
     *  needs its decimals and its native-ness to watch the funds arrive, and
     *  the wrong answer is a conversion leg that never fires. */
    function wdPayout(asset: string, chainId: string): AsterPayoutToken {
      const t = asterPayoutToken(asset, chainId);
      if (!t) throw new Error(`Aster does not pay ${asset} out on ${chainName(chainId)}`);
      return t;
    }

    const chainName = (id: string) => CHAINS[chainIdx(id)]?.name ?? `chain ${id}`;

    /** Aster's own fee quote for this asset/chain, as the exact plain-decimal
     *  string that goes into the signature. Throws rather than returning a
     *  fallback: `fee` is signed, so a guessed one is either a rejected
     *  signature or a withdrawal on terms the user never saw. */
    async function asterWithdrawFee(chainId: string, asset: string): Promise<string> {
      const r = await fetch(`/aster-withdraw-fee?chainId=${chainId}&asset=${asset}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || typeof d?.fee !== 'string')
        throw new Error(d?.msg || 'Could not get Aster’s withdrawal fee — not signing a withdrawal without it');
      return d.fee;
    }

    /** Quote the fee and put it on screen. Returns it so the caller can check
     *  the user was actually shown what they are about to sign.
     *
     *  The fee is denominated in the asset being withdrawn, not in dollars —
     *  0.00017 BNB, not 0.11 USDT — so the asset travels with it everywhere. */
    async function refreshAsterWdFee(): Promise<{ fee: string; chain: string; asset: string }> {
      const gen = ++asterWdFeeGen;
      const chain = asterWdChain();
      const asset = wdAsset;
      const fee = await asterWithdrawFee(chain, asset);
      // Flicking through destinations leaves several quotes in flight, and they
      // do not answer in issue order — an earlier one landing last would leave
      // the label describing a chain the user has already moved off. Only the
      // newest quote may write. The value is still returned either way, so the
      // caller that asked for it gets its own answer.
      if (gen === asterWdFeeGen) {
        asterWdFee = fee;
        asterWdFeeChain = chain;
        asterWdFeeAsset = asset;
        set('wd-fee', `Aster network fee: ${fee} ${asset} — paid out on ${chainName(chain)}`);
      }
      return { fee, chain, asset };
    }

    /** The wallet will only sign a typed-data payload whose domain chainId is
     *  the chain it is currently on, and the withdrawal authorization is
     *  stamped with the destination chain. */
    async function ensureWdChain(prov: any, chainId: string) {
      return ensureChain(prov, chainId, `Switch your wallet to ${chainName(chainId)} to sign the withdrawal`);
    }

    /** A SOURCE chain picker changing is the user saying "operate on this
     *  chain", and everything behind those pickers — the balance read, the
     *  allowance check, the transaction itself — goes wherever the WALLET is
     *  pointed, not where the select is. Move the wallet with the picker
     *  rather than failing at execution time (or, on the deposit tab, silently
     *  showing no balance and a MAX of 0).
     *
     *  Destination pickers deliberately do NOT call this: a wallet does not
     *  have to sit on a chain to receive funds there, and the one destination
     *  that is also a signing domain (Aster withdrawals) is switched by
     *  execWithdraw via ensureWdChain at the moment it signs. */
    let chainSwitchGen = 0;
    async function autoSwitchChain(chainId: string) {
      if (!evmAddressRef.current) return;
      const prov = getProv();
      if (!prov) return;
      const gen = ++chainSwitchGen;
      try {
        const on = String(parseInt(await prov.request({method:'eth_chainId'}) as string, 16));
        // The user can keep changing the picker while the wallet is still
        // prompting for the previous one — only the newest pick may switch.
        if (on === chainId || gen !== chainSwitchGen) return;
        await ensureChain(prov, chainId, '');
      } catch {
        // Refusing the switch is the user's call, and it must not break the
        // form. Every exec path still calls ensureChain before it signs, so
        // the refusal resurfaces there with a message attached.
      }
    }

    /** eth_sendTransaction and eth_signTypedData_v4 both go wherever the wallet
     *  is pointed, so anything aimed at a specific chain's contracts has to
     *  put it there first. */
    async function ensureChain(prov: any, want: string, why: string) {
      const on = String(parseInt(await prov.request({method:'eth_chainId'}) as string, 16));
      if (on === want) return;
      const net = findEvmNetwork(want);
      const r = net ? await switchEvmNetwork(prov, net) : {ok:false, reason:'Unknown network'};
      if (!r.ok) throw new Error(r.reason || why);
    }

    /**
     * A withdrawal still carries two EIP-712 signatures over two different
     * domains — but only one of them is made here now.
     *
     * 1. the withdrawal authorization (domain `Aster`, destination chainId),
     *    binding destination + amount + fee. THIS ONE, from the user's wallet.
     * 2. the V3 request-auth wrapper (domain `AsterSignTransaction`, chainId
     *    1666). Made by the backend with this user's own agent key.
     *
     * Signature 2 moved because it could not be made here: chainId 1666 is
     * Aster Chain, which publishes no EVM RPC, and MetaMask refuses to sign a
     * domain whose chain it is not connected to — with nothing to switch to,
     * that was a dead end rather than a prompt a user could work through.
     *
     * The server gaining that ability is not the server gaining the ability to
     * withdraw. Aster rejects an agent-signed signature 1 with "Invalid
     * signature. Please sign again." (measured — see
     * docs/aster-withdrawal-findings.md), so signature 1 above is the sole
     * authorization to move funds and it can only come from the wallet. The
     * backend verifies it recovers to the session's user before signing.
     */
    async function asterWithdrawRaw(prov: any, user: string, amt: number, dest: string, fee: string, chainId: string, asset: string) {
      await ensureWdChain(prov, chainId);
      const amount = normalizeAsterAmount(toPlainDecimal(amt));
      const params = {
        chainId,
        asset,
        amount,
        fee,
        receiver: dest,
        userNonce: asterNonce(),
      };
      // ONE wallet signature, on the destination chain the wallet is already
      // switched to. The second signature a withdrawal needs — the V3 auth
      // wrapper, stamped chainId 1666 — is made by this user's server-held
      // agent key instead, because no amount of UI could make MetaMask sign a
      // domain whose chain has no RPC to switch to.
      //
      // This one stays in the wallet on purpose, and is the reason the server
      // cannot move anyone's funds: Aster rejects an agent-signed Action, so
      // this signature over destination/amount/fee is the sole authorization,
      // and the user sees all three in the wallet prompt before granting it.
      const userSignature = await prov.request({
        method: 'eth_signTypedData_v4',
        params: [user, JSON.stringify(buildAsterWithdrawTypedData(params))],
      }) as string;

      // asterFetch, not fetch: the backend picks WHICH agent key signs the
      // 1666 wrapper from the session cookie, so the withdrawal needs a live
      // session the same way every signed read does. It also retries once on
      // 401 after re-establishing one — safe here precisely because 401 can
      // only mean "no session", and the route checks that before it forwards
      // anything to Aster.
      const res = await asterFetch('/aster-withdraw', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({...params, userSignature}),
      });
      // Aster answers 200 with {code,msg} on business failures, so status
      // alone never means success here.
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.code) throw new Error(asterWithdrawErrorMessage(res.status, d));
      return d as {withdrawId?: string; hash?: string};
    }

    /** Aster's own text where it is clear, and a translation where it is
     *  actively misleading. "Exceeded the withdrawal limit for this chain"
     *  reads as a permissions or ban message; it means this asset has no
     *  withdrawal capacity on this particular chain, which is a routing
     *  problem the user can act on. */
    function asterWithdrawErrorMessage(status: number, d: any): string {
      const msg = String(d?.msg ?? d?.message ?? '');
      if (status === 401)
        return 'Your Aster session expired — reconnect your wallet and try again';
      if (/withdrawal limit for this chain/i.test(msg))
        return `Aster has no ${wdAsset} withdrawal capacity on ${chainName(asterWdChain())} right now. `
          + 'Try a different currency or destination chain, or a smaller amount.';
      return msg || 'Aster withdrawal failed';
    }

    function showSt(id: string, type: string, msg: string) {
      const e = el(id); if (!e) return;
      e.textContent = msg; e.className = 'status ' + type; e.style.display = 'block';
    }

    // Expose to window for JSX handlers
    (window as any).setTab       = setTab;
    (window as any).setWdSrc     = setWdSrc;
    (window as any).setWdAsset   = setWdAsset;
    (window as any).onWdAmtInput = onWdAmtInput;
    (window as any).wdMax        = wdMax;
    (window as any).onWdToChainChange = onWdToChainChange;
    (window as any).updateWdConvHint  = updateWdConvHint;
    (window as any).execWithdraw      = execWithdraw;
    (window as any).setDpDest         = setDpDest;
    (window as any).onDpFromChainChange = onDpFromChainChange;
    (window as any).updateDpHint      = updateDpHint;
    (window as any).execDeposit       = execDeposit;
    (window as any).dpMax             = dpMax;
    (window as any).onFromChainChange = onFromChainChange;
    (window as any).onFromTokenChange = onFromTokenChange;
    (window as any).onToChainChange   = onToChainChange;
    (window as any).scheduleQuote     = scheduleQuote;
    (window as any).execSend          = execSend;
    (window as any).sendMax           = sendMax;
    (window as any).onSwChainChange   = onSwChainChange;
    (window as any).scheduleSwQuote   = scheduleSwQuote;
    (window as any).swFlip            = swFlip;
    (window as any).execSwap          = execSwap;
    (window as any).setDir            = setDir;
    (window as any).btwMax            = btwMax;
    (window as any).execBtw           = execBtw;

    // Init
    // ?tab= lets other pages deep-link straight into a tab (the Portfolio
    // action buttons do). Validated against the known list rather than passed
    // through, so a bogus value falls back to Withdraw instead of hiding every
    // tab — setTab only shows the one whose id matches.
    const wanted = new URLSearchParams(window.location.search).get('tab') ?? '';
    setTab(['withdraw','deposit','swap','send','between'].includes(wanted) ? wanted : 'withdraw');
    fillChainSel('wd-to-chain');
    fillTokenSel('wd-to-token', '42161', 'USDC');
    // Populated before any balance is read, so the picker is never empty; the
    // withdrawable annotations fill in once the matrix lands.
    fillWdAssetSel();
    updateWdConvHint();
    fillChainSel('dp-from-chain');
    setDpDest('hl');
    fillChainSel('sw-chain');
    fillTokenSel('sw-from', '42161', 'USDC');
    fillTokenSel('sw-to', '42161', 'ETH');
    set('sw-cur', selSym('sw-from'));
    // Both exec buttons start disabled, but the `disabled` cannot live in the
    // JSX: React only dispatches onClick when ITS OWN props for the node say
    // the button is enabled, and nothing here ever re-renders the component,
    // so a `disabled` written in JSX stays true in React's props forever. The
    // imperative `btn.disabled = false` after a quote then produced a button
    // that LOOKS enabled and swallows every click. Owning the property from
    // JS in both directions keeps React's view and the DOM in agreement.
    disableBtn('sw-btn');
    disableBtn('send-btn');
    fillChainSel('from-chain'); fillChainSel('to-chain');
    fillTokenSel('from-token', '42161');
    fillTokenSel('to-token', '42161', 'ETH');
    set('send-cur-badge', selSym('from-token'));
    void refreshSendBal();
    setDir('hl-to-aster');

    import('@/lib/i18n').then(({ applyTranslations }) => {
      applyTranslations();
    });

    refreshDpBalRef.current = () => { refreshDpBal(); refreshSendBal(); };
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
            {/* Aster holds more than one currency and will pay any of them out;
                Hyperliquid pays USDC only, so this row hides for that source. */}
            <div id="wd-asset-row" style={{display:'none'}}>
              <div className="field-lbl">Currency</div>
              <div className="sel-wrap">
                <select id="wd-asset" onChange={(e) => (window as any).setWdAsset(e.currentTarget.value)}></select>
              </div>
            </div>
            <div className="field-lbl" data-i18n="amount">Amount</div>
            <div className="amt-wrap" id="wd-amt-wrap">
              <input className="amt-input" type="number" id="wd-amt" placeholder="0.00" min="0" step="any" onInput={() => (window as any).onWdAmtInput()} />
              <div className="amt-right">
                <span className="cur-badge" id="wd-from-cur">USDC</span>
                <button className="max-btn" onClick={() => (window as any).wdMax()}>MAX</button>
              </div>
            </div>
            <div className="bal-hint" id="wd-bal">&nbsp;</div>
            {/* Aster's withdrawal fee is a SIGNED field — it lives here so the
                user reads it before the wallet prompt, not inside it. */}
            <div className="bal-hint" id="wd-fee">&nbsp;</div>
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
                <button className="max-btn" onClick={() => (window as any).dpMax()}>MAX</button>
              </div>
            </div>
            <div className="bal-hint" id="dp-bal">&nbsp;</div>
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
                  <div className="conv-hint" id="sw-fee">&nbsp;</div>
                </div>
              </div>
            </div>
            <button className="exec-btn lifi" id="sw-btn" onClick={() => (window as any).execSwap()}>
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
              Same-chain swaps via LI.FI, routed through the backend so any API key stays server-side.
              For <strong>cross-chain</strong> moves use the Send tab, which quotes bridges through the same aggregator.
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
            <button className="exec-btn lifi" id="send-btn" onClick={() => (window as any).execSend()}>
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
