'use client';

import './transfer.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import {
  CHAINS, USDC_ARB, USDT_ARB, getProv, type EIP1193,
  loadHLEquity, lifiQuote, lifiExec,
  hlWithdrawRaw, asterWithdrawRaw, asterDepositAddr,
  getERC20Bal, ensureApproval, erc20Send, pollReceipt, pollBal,
  type LifiQuote,
} from './transfer-lib';

type Tab = 'withdraw' | 'send' | 'between';
type WdSrc = 'hl' | 'aster';
type BtwDir = 'hl-to-aster' | 'aster-to-hl';

/* ─── helpers ───────────────────────────────────────────────────────── */
const fmt = (n: number, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function chainIdx(id: string) { return CHAINS.findIndex(c => c.id === id); }
function selSym(sel: HTMLSelectElement | null) { return sel?.options[sel.selectedIndex]?.dataset.sym ?? ''; }
function selDec(sel: HTMLSelectElement | null) { return parseInt(sel?.options[sel.selectedIndex]?.dataset.dec ?? '18'); }

/* ─── page ───────────────────────────────────────────────────────────── */
export default function TransferPage() {
  const { t } = useTranslation();

  const [mode, setMode] = useState('hl');

  const [tab, setTab] = useState<Tab>('withdraw');
  const [wdSrc, setWdSrc] = useState<WdSrc>('hl');
  const [btwDir, setBtwDir] = useState<BtwDir>('hl-to-aster');

  const [evmAddr, setEvmAddr] = useState<string | null>(null);
  const [hlEquity, setHlEquity] = useState(0);

  /* ── Withdraw refs / state ── */
  const wdAmtRef = useRef<HTMLInputElement>(null);
  const wdDestRef = useRef<HTMLInputElement>(null);
  const wdToChainRef = useRef<HTMLSelectElement>(null);
  const wdToTokenRef = useRef<HTMLSelectElement>(null);
  const wdKeyRef = useRef<HTMLInputElement>(null);
  const wdSecRef = useRef<HTMLInputElement>(null);
  const [wdBalHint, setWdBalHint] = useState('');
  const [wdConvHint, setWdConvHint] = useState('');
  const [wdProg, setWdProg] = useState<{ labels: string[]; steps: { state: 'wait' | 'active' | 'done' | 'err'; msg: string }[] } | null>(null);
  const [wdStatus, setWdStatus] = useState<{ type: 'ok' | 'err' | 'inf'; msg: string } | null>(null);
  const [wdBusy, setWdBusy] = useState(false);

  /* ── Send refs / state ── */
  const fromChainRef = useRef<HTMLSelectElement>(null);
  const fromTokenRef = useRef<HTMLSelectElement>(null);
  const toChainRef = useRef<HTMLSelectElement>(null);
  const toTokenRef = useRef<HTMLSelectElement>(null);
  const sendAmtRef = useRef<HTMLInputElement>(null);
  const sendDestRef = useRef<HTMLInputElement>(null);
  const [sendCurBadge, setSendCurBadge] = useState('—');
  const [sendBalHint, setSendBalHint] = useState('');
  const [sendQuote, setSendQuote] = useState<LifiQuote | null>(null);
  const [sendQuoteLoading, setSendQuoteLoading] = useState(false);
  const [sendQuoteError, setSendQuoteError] = useState('');
  const [sendRecvAmt, setSendRecvAmt] = useState('—');
  const [sendRecvSym, setSendRecvSym] = useState('');
  const [sendQMeta, setSendQMeta] = useState({ fee: '—', gas: '—', via: '—', time: '—' });
  const [sendStatus, setSendStatus] = useState<{ type: 'ok' | 'err' | 'inf'; msg: string } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Between refs / state ── */
  const btwAmtRef = useRef<HTMLInputElement>(null);
  const btwKeyRef = useRef<HTMLInputElement>(null);
  const btwSecRef = useRef<HTMLInputElement>(null);
  const [btwBalHint, setBtwBalHint] = useState('');
  const [btwProg, setBtwProg] = useState<{ labels: string[]; steps: { state: 'wait' | 'active' | 'done' | 'err'; msg: string }[] } | null>(null);
  const [btwStatus, setBtwStatus] = useState<{ type: 'ok' | 'err' | 'inf'; msg: string } | null>(null);
  const [btwBusy, setBtwBusy] = useState(false);

  /* ── Wallet ── */
  const autoConnectEVM = useCallback(async () => {
    const p = getProv();
    if (!p) return;
    try {
      const a = (await p.request({ method: 'eth_accounts' })) as string[];
      if (a?.[0]) onConnected(a[0]);
    } catch { /* silent */ }
  }, []);

  const requireEVM = useCallback(async () => {
    const p = getProv();
    if (!p) throw new Error('No EVM wallet detected. Install MetaMask or Phantom.');
    let a = (await p.request({ method: 'eth_accounts' })) as string[];
    if (!a?.[0]) a = (await p.request({ method: 'eth_requestAccounts' })) as string[];
    if (!a?.[0]) throw new Error('Wallet not connected');
    if (!evmAddr) onConnected(a[0]);
    return a[0];
  }, [evmAddr]);

  function onConnected(addr: string) {
    setEvmAddr(addr);
    loadHLEquity(addr).then(eq => setHlEquity(eq)).catch(() => {});
  }

  /* ── Init selectors on mount ── */
  useEffect(() => {
    autoConnectEVM();
  }, [autoConnectEVM]);

  useEffect(() => {
    if (wdToChainRef.current && wdToTokenRef.current) {
      fillChainSel(wdToChainRef.current);
      fillTokenSel(wdToTokenRef.current, '42161', 'USDC');
      updateWdConvHint();
    }
    if (fromChainRef.current && fromTokenRef.current) {
      fillChainSel(fromChainRef.current);
      fillTokenSel(fromTokenRef.current, '42161');
      setSendCurBadge(selSym(fromTokenRef.current));
    }
    if (toChainRef.current && toTokenRef.current) {
      fillChainSel(toChainRef.current);
      fillTokenSel(toTokenRef.current, '42161', 'ETH');
    }
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════
     WITHDRAW TAB
     ═══════════════════════════════════════════════════════════════════════ */

  function updateWdConvHint() {
    const srcToken = wdSrc === 'hl' ? USDC_ARB : USDT_ARB;
    const toToken = wdToTokenRef.current?.value ?? '';
    const toChain = wdToChainRef.current?.value ?? '';
    const toSym = selSym(wdToTokenRef.current);
    if (toToken === srcToken && toChain === '42161') {
      setWdConvHint('Direct withdrawal — arrives as-is on Arbitrum');
    } else {
      setWdConvHint(`LI.FI will convert to ${toSym} after the withdrawal lands`);
    }
  }

  function onWdAmtInput() {
    const a = parseFloat(wdAmtRef.current?.value ?? '') || 0;
    if (wdSrc === 'hl') {
      setWdBalHint(
        a && hlEquity
          ? `Balance: $${fmt(hlEquity)} USDC  ·  After: $${fmt(Math.max(0, hlEquity - a))}`
          : evmAddr ? `Balance: $${fmt(hlEquity)} USDC` : 'Connect wallet to see balance'
      );
    }
  }

  function wdMax() {
    if (wdSrc === 'hl' && hlEquity > 0 && wdAmtRef.current) {
      wdAmtRef.current.value = hlEquity.toFixed(2);
      onWdAmtInput();
    }
  }

  async function execWithdraw() {
    const amt = parseFloat(wdAmtRef.current?.value ?? '') || 0;
    const dest = wdDestRef.current?.value.trim() ?? '';
    if (!amt) { setWdStatus({ type: 'err', msg: 'Enter an amount' }); return; }
    setWdBusy(true);
    setWdStatus(null);
    try {
      const user = await requireEVM();
      const prov = getProv()!;
      const destAddr = dest || user;
      const toChain = wdToChainRef.current?.value ?? '42161';
      const toToken = wdToTokenRef.current?.value ?? '';
      const toSym = selSym(wdToTokenRef.current);
      const srcToken = wdSrc === 'hl' ? USDC_ARB : USDT_ARB;
      const isSame = toToken === srcToken && toChain === '42161';
      const destShort = destAddr === user ? 'your wallet' : destAddr.slice(0, 10) + '…';

      if (wdSrc === 'hl') {
        if (isSame) {
          setWdProg({ labels: ['Withdraw USDC from Hyperliquid'], steps: [{ state: 'active', msg: 'Sign withdrawal in wallet…' }] });
          await hlWithdrawRaw(prov, user, amt, destAddr);
          setWdProg({ labels: ['Withdraw USDC from Hyperliquid'], steps: [{ state: 'done', msg: `$${fmt(amt)} USDC → ${destShort} (~2 min)` }] });
        } else {
          setWdProg({
            labels: ['Withdraw USDC from Hyperliquid', 'Wait for USDC on Arbitrum (~2 min)', `Convert USDC → ${toSym} via LI.FI`],
            steps: [
              { state: 'active', msg: 'Sign withdrawal in wallet…' },
              { state: 'wait', msg: 'Waiting…' },
              { state: 'wait', msg: 'Waiting…' },
            ],
          });
          await hlWithdrawRaw(prov, user, amt, user);
          setWdProg(p => p ? { ...p, steps: [{ state: 'done', msg: `$${fmt(amt)} USDC submitted to Arbitrum` }, p.steps[1], p.steps[2]] } : p);

          const before = await getERC20Bal(prov, USDC_ARB, user);
          setWdProg(p => p ? { ...p, steps: [{ state: 'active', msg: 'Polling balance every 12s…' }, p.steps[1], p.steps[2]] } : p);
          await pollBal(prov, USDC_ARB, user, BigInt(Math.round(amt * 1e6 * 0.97)), before, 360000);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], { state: 'done', msg: 'USDC arrived in wallet' }, p.steps[2]] } : p);

          const bal = await getERC20Bal(prov, USDC_ARB, user);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: `Getting LI.FI route to ${toSym}…` }] } : p);
          const q = await lifiQuote('42161', toChain, USDC_ARB, toToken, bal.toString(), user, destAddr);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Approve + convert — confirm in wallet…' }] } : p);
          const h = await lifiExec(prov, q, user);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Confirming…' }] } : p);
          await pollReceipt(prov, h);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'done', msg: `${toSym} sent to ${destShort}` }] } : p);
        }
      } else {
        const key = wdKeyRef.current?.value.trim() ?? '';
        const secret = wdSecRef.current?.value.trim() ?? '';
        if (!key || !secret) { setWdStatus({ type: 'err', msg: 'Enter Aster API credentials' }); setWdBusy(false); return; }

        if (isSame) {
          setWdProg({ labels: ['Withdraw USDT from Aster'], steps: [{ state: 'active', msg: 'Signing and submitting…' }] });
          await asterWithdrawRaw(key, secret, amt, destAddr);
          setWdProg({ labels: ['Withdraw USDT from Aster'], steps: [{ state: 'done', msg: `${fmt(amt)} USDT → ${destShort}` }] });
        } else {
          setWdProg({
            labels: ['Withdraw USDT from Aster', 'Wait for USDT in wallet', `Convert USDT → ${toSym} via LI.FI`],
            steps: [
              { state: 'active', msg: 'Signing Aster withdrawal…' },
              { state: 'wait', msg: 'Waiting…' },
              { state: 'wait', msg: 'Waiting…' },
            ],
          });
          await asterWithdrawRaw(key, secret, amt, user);
          setWdProg(p => p ? { ...p, steps: [{ state: 'done', msg: `${fmt(amt)} USDT withdrawal submitted` }, p.steps[1], p.steps[2]] } : p);

          const before = await getERC20Bal(prov, USDT_ARB, user);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], { state: 'active', msg: 'Polling every 12s…' }, p.steps[2]] } : p);
          await pollBal(prov, USDT_ARB, user, BigInt(Math.round(amt * 1e6 * 0.97)), before, 600000);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], { state: 'done', msg: 'USDT arrived in wallet' }, p.steps[2]] } : p);

          const bal = await getERC20Bal(prov, USDT_ARB, user);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: `Getting LI.FI route to ${toSym}…` }] } : p);
          const q = await lifiQuote('42161', toChain, USDT_ARB, toToken, bal.toString(), user, destAddr);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Approve + convert — confirm in wallet…' }] } : p);
          const h = await lifiExec(prov, q, user);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Confirming…' }] } : p);
          await pollReceipt(prov, h);
          setWdProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'done', msg: `${toSym} sent to ${destShort}` }] } : p);
        }
      }
      setWdStatus({ type: 'ok', msg: 'Withdrawal complete ✓' });
      if (wdAmtRef.current) wdAmtRef.current.value = '';
    } catch (e) {
      const msg = (e as { code?: number; message?: string }).code === 4001 ? 'Rejected by wallet' : (e as Error).message;
      setWdStatus({ type: 'err', msg });
      setWdProg(p => p ? { ...p, steps: p.steps.map((s, i) => i === p.steps.findIndex(x => x.state === 'active') ? { state: 'err', msg } : s) } : p);
    } finally {
      setWdBusy(false);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SEND TAB
     ═══════════════════════════════════════════════════════════════════════ */

  function onFromChainChange() {
    if (!fromChainRef.current || !fromTokenRef.current) return;
    fillTokenSel(fromTokenRef.current, fromChainRef.current.value, selSym(fromTokenRef.current));
    setSendCurBadge(selSym(fromTokenRef.current));
    scheduleQuote();
  }
  function onFromTokenChange() {
    setSendCurBadge(selSym(fromTokenRef.current));
    scheduleQuote();
  }
  function onToChainChange() {
    if (!toChainRef.current || !toTokenRef.current) return;
    fillTokenSel(toTokenRef.current, toChainRef.current.value, selSym(toTokenRef.current));
    scheduleQuote();
  }

  function scheduleQuote() {
    if (qTimer.current) clearTimeout(qTimer.current);
    setSendQuote(null);
    setSendQuoteError('');
    setSendRecvAmt('—');
    setSendRecvSym('');
    setSendQMeta({ fee: '—', gas: '—', via: '—', time: '—' });

    const amt = parseFloat(sendAmtRef.current?.value ?? '') || 0;
    const dst = sendDestRef.current?.value.trim() ?? '';
    if (!amt || dst.length < 10) { setSendQuoteLoading(false); return; }
    setSendQuoteLoading(true);
    qTimer.current = setTimeout(fetchQuote, 650);
  }

  async function fetchQuote() {
    const amt = parseFloat(sendAmtRef.current?.value ?? '') || 0;
    const dest = sendDestRef.current?.value.trim() ?? '';
    const fromChain = fromChainRef.current?.value ?? '42161';
    const toChain = toChainRef.current?.value ?? '42161';
    const fromToken = fromTokenRef.current?.value ?? '';
    const toToken = toTokenRef.current?.value ?? '';
    const fromDec = selDec(fromTokenRef.current);
    if (!amt || !dest) { setSendQuoteLoading(false); return; }
    if (!evmAddr) { setSendStatus({ type: 'err', msg: 'Connect your wallet first' }); setSendQuoteLoading(false); return; }

    const fromAmount = BigInt(Math.round(amt * 10 ** fromDec)).toString();
    try {
      const q = await lifiQuote(fromChain, toChain, fromToken, toToken, fromAmount, evmAddr, dest);
      setSendQuote(q);
      const toDec = q.action?.toToken?.decimals ?? 18;
      const toSym = q.action?.toToken?.symbol ?? selSym(toTokenRef.current);
      const toAmt = Number(q.estimate?.toAmount ?? 0) / 10 ** toDec;
      const fee = (q.estimate?.feeCosts ?? []).reduce((a, f) => a + Number((f as { amountUSD?: string }).amountUSD || 0), 0);
      const gas = (q.estimate?.gasCosts ?? []).reduce((a, g) => a + Number((g as { amountUSD?: string }).amountUSD || 0), 0);
      const secs = q.estimate?.executionDuration ?? 0;
      const via = (q.includedSteps ?? []).map(s => (s.toolDetails?.name || s.tool || s.type) as string).filter(Boolean).join(' + ') || '—';
      setSendRecvAmt(fmt(toAmt, toAmt < 1 ? 6 : 3));
      setSendRecvSym(toSym);
      setSendQMeta({
        fee: fee ? `~$${fmt(fee)}` : '—',
        gas: gas ? `~$${fmt(gas)}` : '—',
        via,
        time: secs ? (secs < 60 ? `~${secs}s` : `~${Math.ceil(secs / 60)}m`) : '—',
      });
      setSendQuoteLoading(false);
      setSendQuoteError('');
    } catch (e) {
      setSendQuoteLoading(false);
      setSendQuoteError((e as Error).message);
      setSendRecvAmt('—');
      setSendRecvSym('');
    }
  }

  async function execSend() {
    if (!sendQuote) return;
    setSendBusy(true);
    setSendStatus({ type: 'inf', msg: 'Checking allowance…' });
    try {
      const user = await requireEVM();
      const prov = getProv()!;
      const tx = sendQuote.transactionRequest;
      const fAddr = sendQuote.action?.fromToken?.address ?? '';
      const fAmt = sendQuote.action?.fromAmount ?? '0';
      await ensureApproval(prov, fAddr, user, sendQuote.estimate?.approvalAddress || tx.to, fAmt);
      setSendStatus({ type: 'inf', msg: 'Confirm in wallet…' });
      const hash = await prov.request({
        method: 'eth_sendTransaction',
        params: [{
          from: user, to: tx.to, data: tx.data,
          value: tx.value ? '0x' + BigInt(tx.value).toString(16) : '0x0',
          ...(tx.gasLimit ? { gas: '0x' + BigInt(tx.gasLimit).toString(16) } : {}),
        }],
      }) as string;
      setSendStatus({ type: 'ok', msg: `✓ Sent! Tx: ${hash.slice(0, 20)}…` });
      setSendQuote(null);
      if (sendAmtRef.current) sendAmtRef.current.value = '';
    } catch (e) {
      setSendStatus({ type: 'err', msg: (e as { code?: number }).code === 4001 ? 'Rejected by wallet.' : (e as Error).message });
    } finally {
      setSendBusy(false);
    }
  }

  function sendMax() { setSendBalHint('Enter the full amount you want to send'); }

  /* ═══════════════════════════════════════════════════════════════════════
     BETWEEN ACCOUNTS TAB
     ═══════════════════════════════════════════════════════════════════════ */

  function btwMax() {
    if (btwDir === 'hl-to-aster' && hlEquity > 0 && btwAmtRef.current) {
      btwAmtRef.current.value = hlEquity.toFixed(2);
    }
  }

  async function execBtw() {
    const amt = parseFloat(btwAmtRef.current?.value ?? '') || 0;
    const key = btwKeyRef.current?.value.trim() ?? '';
    const secret = btwSecRef.current?.value.trim() ?? '';
    if (!amt) { setBtwStatus({ type: 'err', msg: 'Enter an amount' }); return; }
    if (!key || !secret) { setBtwStatus({ type: 'err', msg: 'Enter Aster API credentials' }); return; }
    setBtwBusy(true);
    setBtwStatus(null);
    try {
      const user = await requireEVM();
      const prov = getProv()!;
      if (btwDir === 'hl-to-aster') {
        setBtwProg({
          labels: ['Withdraw USDC from Hyperliquid', 'Wait for USDC in wallet (~2 min)', 'Swap USDC → USDT on Arbitrum', 'Send USDT to Aster'],
          steps: [
            { state: 'active', msg: 'Sign withdrawal in wallet…' },
            { state: 'wait', msg: 'Waiting…' },
            { state: 'wait', msg: 'Waiting…' },
            { state: 'wait', msg: 'Waiting…' },
          ],
        });
        await hlWithdrawRaw(prov, user, amt, user);
        setBtwProg(p => p ? { ...p, steps: [{ state: 'done', msg: `$${fmt(amt)} USDC submitted to Arbitrum` }, p.steps[1], p.steps[2], p.steps[3]] } : p);

        const ub = await getERC20Bal(prov, USDC_ARB, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], { state: 'active', msg: 'Polling every 12s (up to 6 min)…' }, p.steps[2], p.steps[3]] } : p);
        await pollBal(prov, USDC_ARB, user, BigInt(Math.round(amt * 1e6 * 0.97)), ub, 360000);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], { state: 'done', msg: 'USDC arrived in wallet' }, p.steps[2], p.steps[3]] } : p);

        const usdcBal = await getERC20Bal(prov, USDC_ARB, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Getting LI.FI swap route…' }, p.steps[3]] } : p);
        const q = await lifiQuote('42161', '42161', USDC_ARB, USDT_ARB, usdcBal.toString(), user, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Approve + swap — confirm in wallet…' }, p.steps[3]] } : p);
        const sh = await lifiExec(prov, q, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Confirming swap…' }, p.steps[3]] } : p);
        await pollReceipt(prov, sh);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'done', msg: 'USDC → USDT swapped' }, p.steps[3]] } : p);

        let dep = await asterDepositAddr(key, secret);
        if (!dep) dep = user;
        const usdtBal = await getERC20Bal(prov, USDT_ARB, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], p.steps[2], { state: 'active', msg: `Sending ${fmt(Number(usdtBal) / 1e6, 2)} USDT — confirm…` }] } : p);
        const dh = await erc20Send(prov, USDT_ARB, user, dep, usdtBal.toString());
        await pollReceipt(prov, dh);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], p.steps[2], { state: 'done', msg: 'USDT deposited to Aster ✓' }] } : p);
        setBtwStatus({ type: 'ok', msg: `Transfer complete — $${fmt(amt)} BASIC → EXTRA` });
      } else {
        setBtwProg({
          labels: ['Withdraw USDT from Aster', 'Wait for USDT in wallet', 'Swap USDT → USDC on Arbitrum', 'Hyperliquid auto-credits USDC'],
          steps: [
            { state: 'active', msg: 'Signing Aster withdrawal…' },
            { state: 'wait', msg: 'Waiting…' },
            { state: 'wait', msg: 'Waiting…' },
            { state: 'wait', msg: 'Waiting…' },
          ],
        });
        await asterWithdrawRaw(key, secret, amt, user);
        setBtwProg(p => p ? { ...p, steps: [{ state: 'done', msg: `${fmt(amt)} USDT withdrawal submitted` }, p.steps[1], p.steps[2], p.steps[3]] } : p);

        const tb = await getERC20Bal(prov, USDT_ARB, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], { state: 'active', msg: 'Polling every 12s (up to 10 min)…' }, p.steps[2], p.steps[3]] } : p);
        await pollBal(prov, USDT_ARB, user, BigInt(Math.round(amt * 1e6 * 0.97)), tb, 600000);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], { state: 'done', msg: 'USDT arrived in wallet' }, p.steps[2], p.steps[3]] } : p);

        const usdtBal = await getERC20Bal(prov, USDT_ARB, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Getting LI.FI swap route…' }, p.steps[3]] } : p);
        const q = await lifiQuote('42161', '42161', USDT_ARB, USDC_ARB, usdtBal.toString(), user, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Approve + swap — confirm in wallet…' }, p.steps[3]] } : p);
        const sh = await lifiExec(prov, q, user);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'active', msg: 'Confirming swap…' }, p.steps[3]] } : p);
        await pollReceipt(prov, sh);
        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], { state: 'done', msg: 'USDT → USDC swapped on Arbitrum' }, p.steps[3]] } : p);

        setBtwProg(p => p ? { ...p, steps: [p.steps[0], p.steps[1], p.steps[2], { state: 'done', msg: 'Hyperliquid detects USDC on Arbitrum automatically' }] } : p);
        setBtwStatus({ type: 'ok', msg: `Transfer complete — $${fmt(amt)} EXTRA → BASIC` });
      }
    } catch (e) {
      const msg = (e as { code?: number }).code === 4001 ? 'Rejected by wallet' : (e as Error).message;
      setBtwStatus({ type: 'err', msg });
      setBtwProg(p => p ? { ...p, steps: p.steps.map((s, i) => i === p.steps.findIndex(x => x.state === 'active') ? { state: 'err', msg } : s) } : p);
    } finally {
      setBtwBusy(false);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  const isAster = wdSrc === 'aster';
  const isBtwAster = btwDir === 'aster-to-hl';

  return (
    <>
      <div className="page-hdr">
        <div className="page-title">{t('transferTitle')}</div>
        <div className="page-sub">{t('transferSub')}</div>
      </div>

        <div className="xfr-tabs">
          {(['withdraw', 'send', 'between'] as Tab[]).map((tabKey) => (
            <button key={tabKey} className={`xfr-tab${tab === tabKey ? ' active' : ''}`} onClick={() => setTab(tabKey)}>
              {tabKey === 'withdraw' ? t('withdraw') : tabKey === 'send' ? t('send') : t('betweenAccounts')}
            </button>
          ))}
        </div>

        {/* ══ WITHDRAW ══ */}
        <div className={tab === 'withdraw' ? '' : 'hidden'}>
          <div className="card">
            <div className="field-lbl">{t('sourceAccount')}</div>
            <div className="src-tabs">
              <button className={`src-tab hl${wdSrc === 'hl' ? ' active' : ''}`} onClick={() => { setWdSrc('hl'); updateWdConvHint(); }}>BASIC · Hyperliquid</button>
              <button className={`src-tab as${wdSrc === 'aster' ? ' active' : ''}`} onClick={() => { setWdSrc('aster'); updateWdConvHint(); }}>EXTRA · Aster</button>
            </div>

            <div className="field-lbl">{t('amount')}</div>
            <div className={`amt-wrap${isAster ? ' af' : ''}`}>
              <input className="amt-input" type="number" ref={wdAmtRef} placeholder="0.00" min={0} onInput={onWdAmtInput} />
              <div className="amt-right">
                <span className="cur-badge">{wdSrc === 'hl' ? 'USDC' : 'USDT'}</span>
                <button className="max-btn" onClick={wdMax}>MAX</button>
              </div>
            </div>
            <div className="bal-hint">{wdBalHint}</div>

            <div className="field-lbl">{t('receiveAs')}</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{ flex: 1.3 }}>
                <select ref={wdToChainRef} onChange={() => { fillTokenSel(wdToTokenRef.current!, wdToChainRef.current!.value, selSym(wdToTokenRef.current)); updateWdConvHint(); }}>
                  {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="sel-wrap">
                <select ref={wdToTokenRef} onChange={updateWdConvHint}>
                  {CHAINS[chainIdx('42161')]?.tokens.map(t => <option key={t.addr} value={t.addr} data-sym={t.sym} data-dec={t.dec}>{t.sym}</option>)}
                </select>
              </div>
            </div>
            <div className="conv-hint">{wdConvHint}</div>

            <div className="field-lbl">{t('destAddress')}</div>
            <input className="txt-input" type="text" ref={wdDestRef} placeholder={evmAddr ? evmAddr + ' (connected)' : '0x… (default: connected wallet)'} />

            <div className={isAster ? '' : 'hidden'}>
              <div className="field-lbl">{t('asterApiCreds')}</div>
              <div className="api-row">
                <input className="api-input" type="text" ref={wdKeyRef} placeholder="API Key" />
                <input className="api-input" type="password" ref={wdSecRef} placeholder="API Secret" />
              </div>
              <div className="api-note">Used to sign the Aster withdrawal request — never stored.</div>
            </div>

            <button className={`exec-btn ${isAster ? 'as' : 'hl'}`} disabled={wdBusy} onClick={execWithdraw}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 11l5 5 5-5" /><path d="M4 19h16" /></svg>
              {t('withdraw')}
            </button>

            {wdProg && (
              <>
                <div className="divider" />
                <div className="field-lbl">Live progress</div>
                <div className="prog-list">
                  {wdProg.steps.map((s, i) => (
                    <div className="prog-item" key={i}>
                      <div className={`prog-dot${s.state === 'active' ? ' spin' : s.state === 'done' ? ' ok' : s.state === 'err' ? ' fail' : ''}`}>
                        {s.state === 'done' ? '✓' : s.state === 'err' ? '✕' : i + 1}
                      </div>
                      <div className="prog-body">
                        <div className="prog-label">{wdProg.labels[i]}</div>
                        <div className={`prog-msg${s.state === 'active' ? ' go' : s.state === 'done' ? ' ok' : s.state === 'err' ? ' fail' : ''}`}>{s.msg}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {wdStatus && <div className={`status ${wdStatus.type}`}>{wdStatus.msg}</div>}
          </div>
        </div>

        {/* ══ SEND ══ */}
        <div className={tab === 'send' ? '' : 'hidden'}>
          <div className="card">
            <div className="field-lbl">You send</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{ flex: 1.3 }}>
                <select ref={fromChainRef} onChange={onFromChainChange}>
                  {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="sel-wrap">
                <select ref={fromTokenRef} onChange={onFromTokenChange}>
                  {CHAINS[chainIdx('42161')]?.tokens.map(t => <option key={t.addr} value={t.addr} data-sym={t.sym} data-dec={t.dec}>{t.sym}</option>)}
                </select>
              </div>
            </div>
            <div className="amt-wrap">
              <input className="amt-input" type="number" ref={sendAmtRef} placeholder="0.00" min={0} onInput={scheduleQuote} />
              <div className="amt-right">
                <span className="cur-badge">{sendCurBadge}</span>
                <button className="max-btn" onClick={sendMax}>MAX</button>
              </div>
            </div>
            <div className="bal-hint">{sendBalHint}</div>

            <div className="field-lbl">To address</div>
            <input className="txt-input" type="text" ref={sendDestRef} placeholder="0x… destination address" onInput={scheduleQuote} />

            <div className="field-lbl">They receive</div>
            <div className="pair-row">
              <div className="sel-wrap" style={{ flex: 1.3 }}>
                <select ref={toChainRef} onChange={onToChainChange}>
                  {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="sel-wrap">
                <select ref={toTokenRef} onChange={scheduleQuote}>
                  {CHAINS[chainIdx('42161')]?.tokens.map(t => <option key={t.addr} value={t.addr} data-sym={t.sym} data-dec={t.dec}>{t.sym}</option>)}
                </select>
              </div>
            </div>

            {(sendQuoteLoading || sendQuoteError || sendQuote) && (
              <div className="quote-card" style={sendQuoteError ? { background: 'rgba(237,112,136,.05)', borderColor: 'rgba(237,112,136,.2)' } : sendQuoteLoading ? { borderColor: 'var(--border)', background: 'var(--bg3)' } : undefined}>
                <div className="q-title">Estimated route</div>
                {sendQuoteLoading ? <div className="q-skeleton" /> : (
                  <>
                    <div className="q-receive">{sendRecvAmt} <span>{sendRecvSym}</span></div>
                    <div className="q-meta">
                      <div className="q-item">Fee <strong>{sendQMeta.fee}</strong></div>
                      <div className="q-item">Gas <strong>{sendQMeta.gas}</strong></div>
                      <div className="q-item">Via <strong>{sendQMeta.via}</strong></div>
                      <div className="q-item">Time <strong>{sendQMeta.time}</strong></div>
                    </div>
                  </>
                )}
                {sendQuoteError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{sendQuoteError}</div>}
              </div>
            )}

            <button className="exec-btn lifi" disabled={sendBusy || !sendQuote} onClick={execSend}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              Send
            </button>
            {sendStatus && <div className={`status ${sendStatus.type}`}>{sendStatus.msg}</div>}
          </div>
        </div>

        {/* ══ BETWEEN ACCOUNTS ══ */}
        <div className={tab === 'between' ? '' : 'hidden'}>
          <div className="card">
            <div className="field-lbl">{t('direction')}</div>
            <div className="dir-tabs">
              <button className={`dir-tab${btwDir === 'hl-to-aster' ? ' aHL' : ''}`} onClick={() => setBtwDir('hl-to-aster')}>
                <span className="dt-from">BASIC → EXTRA</span>
                Hyperliquid → Aster
              </button>
              <button className={`dir-tab${btwDir === 'aster-to-hl' ? ' aAS' : ''}`} onClick={() => setBtwDir('aster-to-hl')}>
                <span className="dt-from">EXTRA → BASIC</span>
                Aster → Hyperliquid
              </button>
            </div>

            <div className="field-lbl">{t('amount')}</div>
            <div className={`amt-wrap${isBtwAster ? ' af' : ''}`}>
              <input className="amt-input" type="number" ref={btwAmtRef} placeholder="0.00" min={0} />
              <div className="amt-right">
                <span className="cur-badge">{btwDir === 'hl-to-aster' ? 'USDC' : 'USDT'}</span>
                <button className="max-btn" onClick={btwMax}>MAX</button>
              </div>
            </div>
            <div className="bal-hint">{btwBalHint}</div>

            <div className="field-lbl">{t('asterApiCreds')}</div>
            <div className="api-row">
              <input className="api-input" type="text" ref={btwKeyRef} placeholder="API Key" />
              <input className="api-input" type="password" ref={btwSecRef} placeholder="API Secret" />
            </div>
            <div className="api-note">Required to sign the Aster side of the transfer</div>

            <button className={`exec-btn ${isBtwAster ? 'as' : 'hl'}`} disabled={btwBusy} onClick={execBtw}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              {t('autoTransfer')}
            </button>

            {btwProg && (
              <>
                <div className="divider" />
                <div className="field-lbl">Live progress</div>
                <div className="prog-list">
                  {btwProg.steps.map((s, i) => (
                    <div className="prog-item" key={i}>
                      <div className={`prog-dot${s.state === 'active' ? ' spin' : s.state === 'done' ? ' ok' : s.state === 'err' ? ' fail' : ''}`}>
                        {s.state === 'done' ? '✓' : s.state === 'err' ? '✕' : i + 1}
                      </div>
                      <div className="prog-body">
                        <div className="prog-label">{btwProg.labels[i]}</div>
                        <div className={`prog-msg${s.state === 'active' ? ' go' : s.state === 'done' ? ' ok' : s.state === 'err' ? ' fail' : ''}`}>{s.msg}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {btwStatus && <div className={`status ${btwStatus.type}`}>{btwStatus.msg}</div>}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="info-box neu" style={{ marginBottom: 0 }}>
              <strong>Fully automated:</strong> One click executes the full sequence — HL/Aster withdrawal → on-chain swap via LI.FI → deposit to destination account. You&apos;ll sign 2–3 wallet transactions.
            </div>
          </div>
        </div>
    </>
  );
}

/* ─── selector helpers ─────────────────────────────────────────────── */
function fillChainSel(sel: HTMLSelectElement) {
  sel.innerHTML = CHAINS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}
function fillTokenSel(sel: HTMLSelectElement, chainId: string, keepSym?: string) {
  const idx = chainIdx(chainId);
  const tokens = idx >= 0 ? CHAINS[idx].tokens : [];
  const prev = keepSym || selSym(sel);
  sel.innerHTML = tokens.map(t => `<option value="${t.addr}" data-sym="${t.sym}" data-dec="${t.dec}">${t.sym}</option>`).join('');
  const match = Array.from(sel.options).find(o => o.dataset.sym === prev);
  if (match) sel.value = match.value;
}
