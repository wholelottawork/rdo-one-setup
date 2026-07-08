"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { RdoNav } from "@/lib/RdoNav";
import {
  getPhantomSolana,
  loadSolanaPortfolio,
  type SolAsset,
} from "@/lib/solana";
import { loadArbitrumBalances, type ArbBalances } from "@/lib/arbitrum";
import { getEVMProvider } from "@/lib/wallet";
import {
  getAsterAccount,
  getAsterIncomeHistory,
  approveAsterAgent,
  type AsterAccountInfo,
  type AsterIncomeEntry,
} from "@/lib/aster";
import {
  fmt,
  fmtUSD,
  fmtK,
  shorten,
  pCls,
  fmtDate,
  rangeStartMs,
  formatDuration,
  calcEntryPx,
  buildPnLChartSvg,
  buildDistributionHtml,
  buildCalendar,
  buildSparkPath,
  downloadCard,
  type RawFill,
  type CumPoint,
  type ShareData,
} from "./pnl";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const HL_API = "/api/hl/info";

// Aster's income endpoint (unlike HL's userFillsByTime) caps each call to a
// ~7-day window, so "ALL" is bounded here rather than a true unbounded
// lookback — see getAsterIncomeHistory in lib/aster.ts.
const ASTER_ALL_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

type Range = "7D" | "30D" | "90D" | "ALL";
type PfMode = "hl" | "aster";

interface EIP1193 {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  isPhantom?: boolean;
}

interface PerpsState {
  equity: number;
  upnl: number;
  ntl: number;
  avail: number;
  marginUsed: number;
  lev: string;
  positions: Array<{ coin: string; isLong: boolean; upnl: number }>;
}

export default function PortfolioPage() {
  const { t } = useTranslation();

  // ── Wallet / assets state ──────────────────────────────────────
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [installHint, setInstallHint] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [assets, setAssets] = useState<SolAsset[] | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [chipCopied, setChipCopied] = useState(false);
  const [evmAddr, setEvmAddr] = useState<string | null>(null);
  const [evmSource, setEvmSource] = useState<string>("Wallet");
  const [evmBal, setEvmBal] = useState<
    ArbBalances | "loading" | "error" | null
  >(null);
  const [evmHintMsg, setEvmHintMsg] = useState<string | null>(null);
  const [netBtn, setNetBtn] = useState<
    "idle" | "added" | "failed" | "nowallet"
  >("idle");

  // ── HL PnL state ───────────────────────────────────────────────
  const [hlAddrInput, setHlAddrInput] = useState("");
  const [loadedAddr, setLoadedAddr] = useState<string | null>(null);
  const [hlFills, setHlFills] = useState<RawFill[] | null>(null);
  const [hlLoading, setHlLoading] = useState(false);
  const [hlError, setHlError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("ALL");
  const [pfMode, setPfMode] = useState<PfMode>("hl");
  const [perps, setPerps] = useState<PerpsState | "loading" | "error" | null>(
    null,
  );

  // ── Calendar ───────────────────────────────────────────────────
  const [calOpen, setCalOpen] = useState(false);
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  // ── Aster state ────────────────────────────────────────────────
  // No separate address input — Aster reuses the same connected EVM wallet
  // (evmAddr) as the BASIC/HL section above. That address must have approved
  // our shared Pro API agent (approveAsterAgent) before any data will load.
  const [asterLoading, setAsterLoading] = useState(false);
  const [asterAccount, setAsterAccount] = useState<
    AsterAccountInfo | "error" | null
  >(null);
  const [asterIncome, setAsterIncome] = useState<AsterIncomeEntry[] | null>(
    null,
  );
  const [asterApproving, setAsterApproving] = useState(false);
  const [asterApproveMsg, setAsterApproveMsg] = useState<string | null>(null);

  // ── Modals ─────────────────────────────────────────────────────
  const [depOpen, setDepOpen] = useState(false);
  const [depStep, setDepStep] = useState<"pick" | "lifi">("pick");
  const [depTitle, setDepTitle] = useState("Transfer");
  const [depToken, setDepToken] = useState<SolAsset | null>(null);
  const [depListOpen, setDepListOpen] = useState(false);
  const [depAmount, setDepAmount] = useState("");
  const [depFrameSrc, setDepFrameSrc] = useState("");
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapSrc, setSwapSrc] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertSrc, setConvertSrc] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  const shareDataRef = useRef<ShareData | null>(null);

  // ── loadHLData ─────────────────────────────────────────────────
  const loadHLData = useCallback(async (address: string) => {
    setLoadedAddr(address);
    setHlLoading(true);
    setHlError(null);
    try {
      const startTime = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000; // 3 years
      const res = await fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "userFillsByTime",
          user: address,
          startTime,
          endTime: Date.now(),
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const fills = await res.json();
      setHlFills(Array.isArray(fills) ? fills : []);
      loadPerpsPortfolio(address);
    } catch (e) {
      setHlError(e instanceof Error ? e.message : String(e));
      setHlFills(null);
    } finally {
      setHlLoading(false);
    }
  }, []);

  async function loadPerpsPortfolio(address: string) {
    setPerps("loading");
    try {
      const res = await fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "clearinghouseState", user: address }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const ms = data.crossMarginSummary || data.marginSummary || {};
      const equity = parseFloat(ms.accountValue ?? 0);
      const ntl = parseFloat(ms.totalNtlPos ?? 0);
      const marginUsed = parseFloat(ms.totalMarginUsed ?? 0);
      const rawUsd = parseFloat(ms.totalRawUsd ?? equity);
      const upnl = equity - rawUsd;
      const avail = Math.max(0, equity - marginUsed);
      const lev = marginUsed > 0 ? (ntl / equity).toFixed(2) + "x" : "0.00x";
      const positions = (
        (data.assetPositions || []) as Array<{
          position: { coin: string; szi: string; unrealizedPnl?: string };
        }>
      )
        .filter((p) => parseFloat(p.position?.szi ?? "0") !== 0)
        .map((p) => ({
          coin: p.position.coin,
          isLong: parseFloat(p.position.szi) > 0,
          upnl: parseFloat(p.position.unrealizedPnl ?? "0"),
        }));
      setPerps({ equity, upnl, ntl, avail, marginUsed, lev, positions });
    } catch {
      setPerps("error");
    }
  }

  // ── EVM detect/connect (setEVMAddr / autoDetectEVM / connectEVM) ─
  const setEVMAddress = useCallback(
    (addr: string, source: string) => {
      setEvmAddr(addr);
      setEvmSource(source);
      setHlAddrInput(addr);
      loadHLData(addr);
      setEvmBal("loading");
      loadArbitrumBalances(addr)
        .then(setEvmBal)
        .catch(() => setEvmBal("error"));
    },
    [loadHLData],
  );

  const clearEVMAddr = useCallback(() => {
    setEvmAddr(null);
    setHlAddrInput("");
    setEvmBal(null);
  }, []);

  const autoDetectEVM = useCallback(async () => {
    const w = window as unknown as {
      phantom?: { ethereum?: EIP1193 };
      ethereum?: EIP1193;
    };
    const phEvm = w.phantom?.ethereum;
    if (phEvm) {
      try {
        let accs = (await phEvm.request({
          method: "eth_accounts",
        })) as string[];
        if (!accs?.[0])
          accs = (await phEvm.request({
            method: "eth_requestAccounts",
          })) as string[];
        if (accs?.[0]) {
          setEVMAddress(accs[0], "Phantom");
          return;
        }
      } catch {
        /* EVM not configured in Phantom — fall through */
      }
    }
    const prov = w.ethereum;
    if (prov && !prov.isPhantom) {
      try {
        const accs = (await prov.request({
          method: "eth_accounts",
        })) as string[];
        if (accs?.[0]) {
          setEVMAddress(accs[0], "Wallet");
          return;
        }
      } catch {
        /* silent */
      }
    }
  }, [setEVMAddress]);

  async function connectEVM() {
    const w = window as unknown as {
      phantom?: { ethereum?: EIP1193 };
      ethereum?: EIP1193;
    };
    const phEvm = w.phantom?.ethereum;
    if (phEvm) {
      try {
        let accs = (await phEvm.request({
          method: "eth_accounts",
        })) as string[];
        if (!accs?.[0])
          accs = (await phEvm.request({
            method: "eth_requestAccounts",
          })) as string[];
        if (accs?.[0]) {
          setEVMAddress(accs[0], "Phantom");
          return;
        }
      } catch (e) {
        if ((e as { code?: number }).code !== 4001)
          evmHint(
            "Enable EVM in Phantom → Settings → Networks, then try again.",
          );
        return;
      }
    }
    const provider = w.ethereum;
    if (!provider) {
      evmHint(
        "No EVM wallet found — install MetaMask or Rabby, or enter address manually.",
      );
      return;
    }
    try {
      let accs = (await provider.request({
        method: "eth_accounts",
      })) as string[];
      if (!accs?.[0])
        accs = (await provider.request({
          method: "eth_requestAccounts",
        })) as string[];
      if (accs?.[0]) setEVMAddress(accs[0], "Wallet");
    } catch (e) {
      if ((e as { code?: number }).code !== 4001)
        evmHint("Connection failed — enter your Hyperliquid address manually.");
    }
  }

  function evmHint(msg: string) {
    setEvmHintMsg(msg);
    setTimeout(() => setEvmHintMsg(null), 5000);
  }

  async function addHyperEVM() {
    const w = window as unknown as {
      phantom?: { ethereum?: EIP1193 };
      ethereum?: EIP1193;
    };
    const provider = w.phantom?.ethereum ?? w.ethereum;
    if (!provider) {
      setNetBtn("nowallet");
      setTimeout(() => setNetBtn("idle"), 3000);
      return;
    }
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x3E6",
            chainName: "HyperEVM",
            nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
            rpcUrls: ["https://rpc.hyperliquid.xyz/evm"],
            blockExplorerUrls: ["https://hyperevm-explorer.hyperliquid.xyz"],
          },
        ],
      });
      setNetBtn("added");
    } catch (e) {
      if ((e as { code?: number }).code !== 4001) {
        setNetBtn("failed");
        setTimeout(() => setNetBtn("idle"), 3000);
      }
    }
  }

  // Aster's registerAndApproveAgent signature is hardcoded to chainId 56
  // (BNB Smart Chain) per their spec — some wallets (MetaMask family)
  // reject eth_signTypedData_v4 if that domain chainId doesn't match the
  // wallet's currently active network, so switch (or add, if not present)
  // before ever requesting the signature.
  async function ensureBscNetwork(provider: EIP1193): Promise<boolean> {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x38" }],
      });
      return true;
    } catch (e) {
      const code = (e as { code?: number })?.code;
      if (code === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x38",
                chainName: "BNB Smart Chain",
                nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                rpcUrls: ["https://bsc-dataseed.binance.org/"],
                blockExplorerUrls: ["https://bscscan.com"],
              },
            ],
          });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  // ── Phantom connect flow ───────────────────────────────────────
  async function connectWallet() {
    const p = getPhantomSolana();
    if (!p?.isPhantom) {
      setInstallHint(true);
      return;
    }
    setConnecting(true);
    try {
      const resp = await p.connect();
      setPubkey(resp.publicKey.toString());
    } catch {
      /* rejected */
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectWallet() {
    try {
      await getPhantomSolana()?.disconnect();
    } catch {
      /* ignore */
    }
    setPubkey(null);
    setAssets(null);
    clearEVMAddr();
  }

  const loadPortfolio = useCallback(async (pk: string) => {
    setAssets(null);
    setAssetsError(null);
    try {
      setAssets(await loadSolanaPortfolio(pk));
    } catch (e) {
      setAssetsError(e instanceof Error ? e.message : String(e));
      setAssets([]);
    }
  }, []);

  // on-load: ?hl= param, phantom silent connect (window load handler)
  useEffect(() => {
    const urlHL = new URLSearchParams(window.location.search).get("hl");
    if (urlHL) {
      setHlAddrInput(urlHL);
      loadHLData(urlHL);
    }
    const p = getPhantomSolana();
    if (!p) {
      setInstallHint(true);
      return;
    }
    p.on("disconnect", () => setPubkey((prev) => (prev ? null : prev)));
    p.connect({ onlyIfTrusted: true })
      .then((resp) => setPubkey(resp.publicKey.toString()))
      .catch(() => {});
  }, [loadHLData]);

  useEffect(() => {
    if (!pubkey) return;
    loadPortfolio(pubkey);
    autoDetectEVM();
  }, [pubkey, loadPortfolio, autoDetectEVM]);

  // Escape closes modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDepOpen(false);
        setSwapOpen(false);
        setConvertOpen(false);
        setCalOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function copyFullAddr() {
    if (!pubkey) return;
    await navigator.clipboard.writeText(pubkey).catch(() => {});
    setChipCopied(true);
    setTimeout(() => setChipCopied(false), 1500);
  }

  // ── HL derived stats (applyRangeAndRender + computeAndRenderHL) ─
  const hl = useMemo(() => {
    if (!hlFills || !hlFills.length) return null;
    const cutoff = rangeStartMs(range);
    const filteredAll = hlFills.filter((f) => f.time >= cutoff);
    const noPeriodData = !filteredAll.length && range !== "ALL";
    const fills = filteredAll.length ? filteredAll : hlFills;
    const closing = fills.filter((f) => parseFloat(f.closedPnl ?? "0") !== 0);

    const totalPnl = closing.reduce((s, f) => s + parseFloat(f.closedPnl!), 0);
    const wins = closing.filter((f) => parseFloat(f.closedPnl!) > 0).length;
    const losses = closing.filter((f) => parseFloat(f.closedPnl!) < 0).length;
    const winRate = closing.length
      ? ((wins / closing.length) * 100).toFixed(1) + "%"
      : "—";

    const pnlVals = closing.map((f) => parseFloat(f.closedPnl!));
    const bestVal = closing.length ? Math.max(...pnlVals) : 0;
    const worstVal = closing.length ? Math.min(...pnlVals) : 0;
    const bestFill = closing.find((f) => parseFloat(f.closedPnl!) === bestVal);
    const worstFill = closing.find(
      (f) => parseFloat(f.closedPnl!) === worstVal,
    );

    let avgHoldMs = 0;
    if (closing.length > 1) {
      const byCoins: Record<string, RawFill[]> = {};
      fills.forEach((f) => {
        (byCoins[f.coin] = byCoins[f.coin] || []).push(f);
      });
      let totalHold = 0,
        holdCount = 0;
      Object.values(byCoins).forEach((coinFills) => {
        const cs = coinFills.sort((a, b) => a.time - b.time);
        for (let i = 1; i < cs.length; i++) {
          const d = cs[i].time - cs[i - 1].time;
          if (d > 0 && d < 30 * 86400000) {
            totalHold += d;
            holdCount++;
          }
        }
      });
      if (holdCount) avgHoldMs = totalHold / holdCount;
    }

    const sorted = [...closing].sort((a, b) => a.time - b.time);
    let cum = 0;
    const cumPts: CumPoint[] = sorted.map((f) => {
      cum += parseFloat(f.closedPnl!);
      return { t: f.time, v: cum };
    });

    const dailyPnl: Record<string, number> = {};
    closing.forEach((f) => {
      const d = new Date(f.time);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dailyPnl[key] = (dailyPnl[key] ?? 0) + parseFloat(f.closedPnl!);
    });

    const recent = [...closing].sort((a, b) => b.time - a.time).slice(0, 50);

    return {
      noPeriodData,
      closing,
      totalPnl,
      wins,
      losses,
      winRate,
      bestVal,
      worstVal,
      bestFill,
      worstFill,
      avgHoldMs,
      cumPts,
      dailyPnl,
      recent,
      totalFills: fills.length,
      lastTradeTime: sorted.length ? sorted[sorted.length - 1].time : null,
    };
  }, [hlFills, range]);

  // calendar month follows latest trade (computeAndRenderHL)
  useEffect(() => {
    if (hl?.lastTradeTime) {
      const last = new Date(hl.lastTradeTime);
      setCalYear(last.getFullYear());
      setCalMonth(last.getMonth());
    }
  }, [hl?.lastTradeTime]);

  // share data
  useEffect(() => {
    if (hl && loadedAddr) {
      shareDataRef.current = {
        totalPnl: hl.totalPnl,
        winRate: hl.winRate,
        wins: hl.wins,
        losses: hl.losses,
        bestVal: hl.bestVal,
        cumPts: hl.cumPts,
        address: loadedAddr,
      };
    }
  }, [hl, loadedAddr]);

  const hlChart = useMemo(
    () =>
      buildPnLChartSvg(
        hl?.noPeriodData ? [] : (hl?.cumPts ?? []),
        hl?.totalPnl,
      ),
    [hl],
  );
  const hlDist = useMemo(
    () => buildDistributionHtml(hl && !hl.noPeriodData ? hl.closing : []),
    [hl],
  );
  const calendar = useMemo(
    () => buildCalendar(hl?.dailyPnl ?? {}, calYear, calMonth),
    [hl, calYear, calMonth],
  );

  // ── Aster (loadAsterData etc.) ─────────────────────────────────
  // Data is scoped to evmAddr via our shared Pro API agent (server/lib/aster-auth.js)
  // — that address must have approved the agent first (approveAgent below).
  // Fetches only as much history as the currently selected range needs
  // rather than always pulling the full year: Aster's income endpoint caps
  // each call to a ~7-day window (see getAsterIncomeHistory), so "ALL" is
  // ~53 real upstream requests — that's fine for an occasional load, but
  // firing it on every load/refresh regardless of what's actually selected
  // is what drove us into Aster's own rate limit. 7D/30D/90D are far
  // cheaper (1/5/13 requests) and should use only that much.
  const loadAsterData = useCallback(async () => {
    if (!evmAddr) return;
    setAsterLoading(true);
    setAsterAccount(null);
    setAsterIncome(null);
    const sinceMs = range === "ALL" ? Date.now() - ASTER_ALL_LOOKBACK_MS : rangeStartMs(range);
    const [accountRes, incomeRes] = await Promise.allSettled([
      getAsterAccount(evmAddr),
      getAsterIncomeHistory(sinceMs, evmAddr),
    ]);

    setAsterAccount(
      accountRes.status === "fulfilled" && accountRes.value
        ? accountRes.value
        : "error",
    );
    setAsterIncome(incomeRes.status === "fulfilled" ? incomeRes.value : []);
    setAsterLoading(false);
  }, [evmAddr, range]);

  function switchPortfolioMode(mode: PfMode) {
    setPfMode(mode);
    if (mode === "aster" && evmAddr && asterIncome === null && !asterLoading)
      loadAsterData();
  }

  // Covers connecting the wallet while already on the Aster tab (switchPortfolioMode
  // only fires the initial load on tab switch, not on a later wallet connect).
  useEffect(() => {
    if (pfMode === "aster" && evmAddr && asterIncome === null && !asterLoading)
      loadAsterData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmAddr, pfMode]);

  // One-time on-chain approval letting our shared Pro API agent read/trade
  // for evmAddr — see approveAsterAgent in lib/aster.ts for the signing
  // details and why field order in the signed message matters.
  async function approveAsterAgentFlow() {
    if (!evmAddr) return;
    const provider = getEVMProvider();
    if (!provider) return;
    setAsterApproving(true);
    setAsterApproveMsg(null);
    const onBsc = await ensureBscNetwork(provider as unknown as EIP1193);
    if (!onBsc) {
      setAsterApproveMsg(
        "Please switch your wallet to BNB Smart Chain (BSC) to approve the agent — Aster's approval signature requires it.",
      );
      setAsterApproving(false);
      return;
    }
    try {
      const { ethers } = await import("ethers");
      const signer = await new ethers.BrowserProvider(
        provider as never,
      ).getSigner();
      const result = await approveAsterAgent(evmAddr, signer);
      setAsterApproveMsg(
        result.ok
          ? "Agent approved — loading your Aster data…"
          : `Approval failed: ${result.message}`,
      );
      if (result.ok) loadAsterData();
    } catch (e) {
      setAsterApproveMsg(
        e instanceof Error ? e.message : "Approval failed",
      );
    } finally {
      setAsterApproving(false);
    }
  }

  const aster = useMemo(() => {
    if (!asterIncome) return null;
    const cutoff =
      range === "ALL"
        ? Date.now() - ASTER_ALL_LOOKBACK_MS
        : rangeStartMs(range);
    const closing = asterIncome.filter((e) => e.time >= cutoff);
    if (!closing.length)
      return {
        closing,
        recent: [] as AsterIncomeEntry[],
        totalPnl: 0,
        wins: 0,
        losses: 0,
        winRate: "—",
        bestVal: 0,
        worstVal: 0,
        bestT: undefined as AsterIncomeEntry | undefined,
        worstT: undefined as AsterIncomeEntry | undefined,
        cumPts: [] as CumPoint[],
      };
    const totalPnl = closing.reduce((s, e) => s + e.income, 0);
    const wins = closing.filter((e) => e.income > 0).length;
    const losses = closing.filter((e) => e.income < 0).length;
    const pnlVals = closing.map((e) => e.income);
    const bestVal = Math.max(...pnlVals);
    const worstVal = Math.min(...pnlVals);
    const bestT = closing.find((e) => e.income === bestVal);
    const worstT = closing.find((e) => e.income === worstVal);
    const sorted = [...closing].sort((a, b) => a.time - b.time);
    let cum = 0;
    const cumPts: CumPoint[] = sorted.map((e) => {
      cum += e.income;
      return { t: e.time, v: cum };
    });
    const recent = [...closing].sort((a, b) => b.time - a.time).slice(0, 50);
    return {
      closing,
      recent,
      totalPnl,
      wins,
      losses,
      winRate: ((wins / closing.length) * 100).toFixed(1) + "%",
      bestVal,
      worstVal,
      bestT,
      worstT,
      cumPts,
    };
  }, [asterIncome, range]);

  const asterChart = useMemo(
    () => buildPnLChartSvg(aster?.cumPts ?? [], aster?.totalPnl),
    [aster],
  );
  const asterDist = useMemo(
    () =>
      buildDistributionHtml(
        (aster?.closing ?? []).map((e) => ({ closedPnl: String(e.income) })),
      ),
    [aster],
  );

  // accountWithJoinMargin doesn't return one blended "account leverage" or a
  // notional-value field directly — derive them from open positions (entry
  // price, since there's no live mark price in this payload either).
  const asterDerived = useMemo(() => {
    if (!asterAccount || asterAccount === "error")
      return { ntl: 0, lev: "0.00x" };
    const positions = asterAccount.positions;
    const ntl = positions.reduce(
      (s, p) => s + Math.abs(p.positionAmt * p.entryPrice),
      0,
    );
    const lev = positions.length
      ? (
          positions.reduce((s, p) => s + p.leverage, 0) / positions.length
        ).toFixed(2) + "x"
      : "0.00x";
    return { ntl, lev };
  }, [asterAccount]);

  // ── Deposit modal helpers ──────────────────────────────────────
  function openDeposit() {
    setDepOpen(true);
    depBack();
    if (assets?.length) depSelectToken(assets[0]);
  }
  function depBack() {
    setDepStep("pick");
    setDepTitle("Transfer");
    setDepListOpen(false);
  }
  function depSelectToken(tok: SolAsset) {
    setDepToken(tok);
    setDepListOpen(false);
    setDepAmount("");
  }
  function depMax() {
    if (!depToken) return;
    setDepAmount(
      depToken.balance > 0
        ? String(Math.floor(depToken.balance * 1e6) / 1e6)
        : "",
    );
  }
  function depStartTransfer() {
    if (!depToken) return;
    const amt = parseFloat(depAmount) || 0;
    setDepStep("lifi");
    setDepTitle("Bridge via LI.FI");
    let url = "/swap?mode=deposit";
    const addr = evmAddr || hlAddrInput.trim();
    if (addr) url += "&toAddress=" + encodeURIComponent(addr);
    url +=
      "&fromToken=" +
      encodeURIComponent(depToken.mint === SOL_MINT ? "SOL" : depToken.mint);
    if (amt > 0) url += "&fromAmount=" + amt;
    setDepFrameSrc(url);
  }
  function openPerpsDeposit() {
    const addr = evmAddr || hlAddrInput.trim();
    setDepOpen(true);
    setDepStep("lifi");
    setDepTitle("Deposit to Perps via LI.FI");
    setDepFrameSrc(
      "/swap?mode=deposit" +
        (addr ? "&toAddress=" + encodeURIComponent(addr) : ""),
    );
  }

  function shareCardAction() {
    const addr = hlAddrInput.trim() || pubkey || "";
    if (!addr) return;
    const url = `${window.location.origin}${window.location.pathname}?hl=${addr}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1500);
  }

  const depAmtNum = parseFloat(depAmount) || 0;
  const depUsd = depAmtNum * (depToken?.price || 0);

  const solTotal = (assets ?? []).reduce((s, a) => s + a.value, 0);
  const evmTotal =
    evmBal && evmBal !== "loading" && evmBal !== "error"
      ? evmBal.eth * evmBal.ethPriceUsd + evmBal.usdc
      : 0;
  const totalVal = solTotal + evmTotal;

  return (
    <>
      <RdoNav active="portfolio" />

      <main>
        {/* ══ WALLET SECTION ══ */}
        <div
          id="connect-screen"
          style={pubkey ? { display: "none" } : undefined}
        >
          <div className="phantom-logo">
            <svg viewBox="0 0 128 128" fill="none">
              <path
                d="M110.584 64.9142H99.142C99.142 41.8864 80.6366 23.0625 57.9584 23.0625C35.5556 23.0625 17.2065 41.508 16.8677 64.0735C16.5221 87.0972 35.3756 106 58.2219 106H63.3743C85.6702 106 116.581 88.3047 116.581 66.8896C116.581 65.6864 115.684 64.9142 110.584 64.9142Z"
                fill="white"
              />
            </svg>
          </div>
          <div className="connect-title">{t("connectPhantom")}</div>
          <div className="connect-sub">{t("connectPhantomSub")}</div>
          <button
            className="connect-btn"
            id="connect-btn"
            disabled={connecting}
            onClick={connectWallet}
          >
            <svg width="16" height="16" viewBox="0 0 128 128" fill="none">
              <path
                d="M110.584 64.9142H99.142C99.142 41.8864 80.6366 23.0625 57.9584 23.0625C35.5556 23.0625 17.2065 41.508 16.8677 64.0735C16.5221 87.0972 35.3756 106 58.2219 106H63.3743C85.6702 106 116.581 88.3047 116.581 66.8896C116.581 65.6864 115.684 64.9142 110.584 64.9142Z"
                fill="white"
              />
            </svg>
            {connecting ? "Connecting…" : " Connect Phantom"}
          </button>
          <div
            className="install-hint"
            id="install-hint"
            style={installHint ? { display: "block" } : undefined}
          >
            Phantom not detected —{" "}
            <a
              href="https://phantom.app"
              target="_blank"
              rel="noopener noreferrer"
            >
              install Phantom
            </a>{" "}
            then refresh.
          </div>
        </div>

        <div
          id="portfolio-screen"
          style={pubkey ? { display: "block" } : undefined}
        >
          <div className="pf-topbar">
            <div className="addr-row">
              <div
                className="addr-chip"
                id="addr-chip"
                onClick={copyFullAddr}
                title="Click to copy"
              >
                {chipCopied ? "✓ Copied" : pubkey ? shorten(pubkey) : "—"}
              </div>
              <button className="disc-btn" onClick={disconnectWallet}>
                {t("disconnect")}
              </button>
            </div>
            <button
              className="refresh-btn"
              onClick={() => pubkey && loadPortfolio(pubkey)}
            >
              ↺ Refresh
            </button>
          </div>
          <div className="total-card">
            <div>
              <div className="total-lbl">{t("totalPortfolio")}</div>
              <div className="total-val" id="total-val">
                {assets ? "$" + fmt(totalVal) : "$—"}
              </div>
              <div className="total-sub" id="total-sub">
                {assetsError
                  ? "Error"
                  : assets
                    ? `${assets.length} asset${assets.length !== 1 ? "s" : ""}`
                    : "Loading…"}
              </div>
            </div>
            <div className="action-bar">
              <button className="act-btn fill" onClick={openDeposit}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v13M7 11l5 5 5-5" />
                  <path d="M4 19h16" />
                </svg>
                Deposit
              </button>
              <button
                className="act-btn outline"
                onClick={() => {
                  setSwapOpen(true);
                  if (!swapSrc) setSwapSrc("/swap?mode=swap");
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 3l4 4-4 4M20 7H9a4 4 0 000 8h2" />
                  <path d="M8 21l-4-4 4-4M4 17h11a4 4 0 000-8h-2" />
                </svg>
                Swap
              </button>
              <button
                className="act-btn outline"
                onClick={() => {
                  setConvertOpen(true);
                  if (!convertSrc) setConvertSrc("/swap?mode=convert");
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="8" cy="8" r="3" />
                  <circle cx="16" cy="16" r="3" />
                  <path d="M11 8h4a2 2 0 012 2v2M9 16H5a2 2 0 01-2-2v-2" />
                </svg>
                Convert
              </button>
            </div>
          </div>
          <div className="assets-card">
            <div className="assets-hdr">
              <span>Asset</span>
              <span>Price</span>
              <span>Balance</span>
              <span>Value</span>
            </div>
            <div id="assets-body">
              {assetsError ? (
                <div className="empty-assets">{assetsError}</div>
              ) : !assets ? (
                <div className="empty-assets">Loading…</div>
              ) : !assets.length ? (
                <div className="empty-assets">No assets found.</div>
              ) : (
                assets.map((a) => (
                  <div className="asset-row" key={a.mint}>
                    <div className="asset-left">
                      {a.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="token-icon"
                          src={a.logo}
                          alt=""
                          onError={(e) => {
                            (e.target as HTMLImageElement).outerHTML =
                              `<div class=token-icon-ph>${(a.symbol || "?")[0]}</div>`;
                          }}
                        />
                      ) : (
                        <div className="token-icon-ph">
                          {(a.symbol || "?")[0]}
                        </div>
                      )}
                      <div>
                        <div className="token-name">{a.name}</div>
                        <div className="token-sym">{a.symbol}</div>
                      </div>
                    </div>
                    <div className="cell">
                      {a.price ? fmtUSD(a.price) : "—"}
                    </div>
                    <div className="cell">
                      {fmt(a.balance, a.balance < 1 ? 4 : 2)}
                    </div>
                    <div className="cell val">
                      {a.value > 0.005 ? "$" + fmt(a.value) : "—"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* EVM / Arbitrum balances */}
          <div
            className={`evm-bal-card${evmAddr ? " visible" : ""}`}
            id="evm-bal-card"
          >
            <div className="evm-bal-hdr">
              EVM Wallet
              <span className="evm-bal-chain" id="evm-bal-chain-tag">
                Arbitrum
              </span>
            </div>
            <div id="evm-bal-body">
              <div className="evm-bal-row">
                <div className="evm-bal-left">
                  <div
                    className="evm-tok-dot"
                    style={{ background: "#1b2429", color: "#627EEA" }}
                  >
                    Ξ
                  </div>
                  <div>
                    <div className="evm-bal-sym">ETH</div>
                    <div className="evm-bal-name">Ethereum</div>
                  </div>
                </div>
                <div className="evm-bal-right">
                  <div className="evm-bal-amount" id="evm-eth-bal">
                    {evmBal === "loading"
                      ? "…"
                      : evmBal && evmBal !== "error"
                        ? fmt(evmBal.eth, evmBal.eth < 0.01 ? 4 : 3) + " ETH"
                        : "—"}
                  </div>
                  <div className="evm-bal-usd" id="evm-eth-usd">
                    {evmBal &&
                    evmBal !== "loading" &&
                    evmBal !== "error" &&
                    evmBal.ethPriceUsd
                      ? "$" + fmt(evmBal.eth * evmBal.ethPriceUsd)
                      : ""}
                  </div>
                </div>
              </div>
              <div className="evm-bal-row">
                <div className="evm-bal-left">
                  <div
                    className="evm-tok-dot"
                    style={{ background: "#1b2429", color: "#2775ca" }}
                  >
                    $
                  </div>
                  <div>
                    <div className="evm-bal-sym">USDC</div>
                    <div className="evm-bal-name">USD Coin</div>
                  </div>
                </div>
                <div className="evm-bal-right">
                  <div className="evm-bal-amount" id="evm-usdc-bal">
                    {evmBal === "loading"
                      ? "…"
                      : evmBal && evmBal !== "error"
                        ? fmt(evmBal.usdc) + " USDC"
                        : "—"}
                  </div>
                  <div className="evm-bal-usd" id="evm-usdc-usd">
                    {evmBal && evmBal !== "loading" && evmBal !== "error"
                      ? evmBal.usdc > 0
                        ? "$" + fmt(evmBal.usdc)
                        : "—"
                      : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ══ ALWAYS VISIBLE: section header + mode switcher ══ */}
        <div className="section-divider" style={{ marginTop: 32 }}>
          <span>Trader PnL</span>
        </div>
        <div className="pnl-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                className="pnl-title"
                id="pf-section-title"
                style={pfMode === "aster" ? { color: "#f59e0b" } : undefined}
              >
                {pfMode === "hl" ? t("traderPnl") : "ASTER PNL"}
              </div>
              <div className="mode-switch" id="pfModeSwitch">
                <button
                  className={`mode-btn mode-hl${pfMode === "hl" ? " active" : ""}`}
                  id="pfBtnHL"
                  onClick={() => switchPortfolioMode("hl")}
                >
                  BASIC
                </button>
                <button
                  className={`mode-btn mode-aster${pfMode === "aster" ? " active" : ""}`}
                  id="pfBtnAster"
                  onClick={() => switchPortfolioMode("aster")}
                >
                  EXTRA
                </button>
              </div>
            </div>
            <div className="pnl-addr-sub" id="pnl-addr-sub">
              {loadedAddr
                ? loadedAddr.slice(0, 10) + "…" + loadedAddr.slice(-6)
                : ""}
            </div>
          </div>
          <div className="pnl-controls" id="pf-hl-controls">
            <button className="pnl-cal-btn" onClick={() => setCalOpen(true)}>
              {t("pnlCalendar")}
            </button>
            <div className="range-tabs">
              {(["7D", "30D", "90D", "ALL"] as Range[]).map((r) => (
                <button
                  key={r}
                  className={`range-tab${range === r ? " active" : ""}`}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ══ BASIC MODE (Hyperliquid) ══ */}
        <div
          id="pnl-section-hl"
          style={pfMode === "hl" ? undefined : { display: "none" }}
        >
          <div className="hl-connect-bar">
            <input
              className="hl-addr-input"
              id="hl-addr-input"
              placeholder={
                evmHintMsg ?? "Enter Hyperliquid wallet address (0x…)"
              }
              style={evmHintMsg ? { borderColor: "var(--red)" } : undefined}
              value={hlAddrInput}
              onChange={(e) => setHlAddrInput(e.target.value)}
            />
            <button
              className="hl-load-btn"
              onClick={() => {
                const a = hlAddrInput.trim();
                if (a) loadHLData(a);
              }}
            >
              Load
            </button>
            {evmAddr ? (
              <button
                className="hl-evm-btn"
                id="hl-evm-btn"
                style={{ borderColor: "var(--green)", color: "var(--green)" }}
                title="Click to disconnect"
                onClick={clearEVMAddr}
              >
                <svg width="8" height="8" viewBox="0 0 8 8">
                  <circle cx="4" cy="4" r="4" fill="#1fa67d" />
                </svg>{" "}
                {evmSource}: {shorten(evmAddr)}
              </button>
            ) : (
              <button
                className="hl-evm-btn"
                id="hl-evm-btn"
                onClick={connectEVM}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2v20M2 12h20" />
                </svg>
                {t("connectEvmWallet")}
              </button>
            )}
            <button
              className="hl-evm-btn"
              id="add-network-btn"
              title="Add HyperEVM network to your wallet"
              style={
                netBtn === "added"
                  ? { borderColor: "var(--green)", color: "var(--green)" }
                  : netBtn === "failed" || netBtn === "nowallet"
                    ? { color: "var(--red)" }
                    : undefined
              }
              onClick={addHyperEVM}
            >
              {netBtn === "added" ? (
                <>
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <circle cx="4" cy="4" r="4" fill="#1fa67d" />
                  </svg>{" "}
                  HyperEVM Added
                </>
              ) : netBtn === "nowallet" ? (
                "No wallet found"
              ) : netBtn === "failed" ? (
                "Failed"
              ) : (
                <>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v8M8 12h8" />
                  </svg>{" "}
                  Add HyperEVM
                </>
              )}
            </button>
          </div>

          <div className="pnl-layout">
            <div className="pnl-main">
              {/* 6 stat cards */}
              <div className="pnl-stats">
                <div className="stat-card">
                  <div className="stat-lbl">{t("totalRealizedPnl")}</div>
                  <div
                    className={`stat-val ${hl && !hl.noPeriodData ? pCls(hl.totalPnl) : ""}`.trim()}
                    id="s-total-pnl"
                  >
                    {hlLoading
                      ? "…"
                      : hl && !hl.noPeriodData
                        ? (hl.totalPnl >= 0 ? "+" : "") + "$" + fmt(hl.totalPnl)
                        : "—"}
                  </div>
                  <div className="stat-sub" id="s-total-pnl-sub">
                    All-time
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">{t("winRate")}</div>
                  <div className="stat-val" id="s-win-rate">
                    {hlLoading
                      ? "…"
                      : hl && !hl.noPeriodData
                        ? hl.winRate
                        : "—"}
                  </div>
                  <div className="stat-sub" id="s-win-sub">
                    {hl && !hl.noPeriodData
                      ? `${hl.wins}W / ${hl.losses}L`
                      : "wins / losses"}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">{t("totalTrades")}</div>
                  <div className="stat-val" id="s-trades">
                    {hlLoading
                      ? "…"
                      : hl && !hl.noPeriodData
                        ? hl.closing.length.toLocaleString()
                        : "—"}
                  </div>
                  <div className="stat-sub" id="s-trades-sub">
                    {hl && !hl.noPeriodData
                      ? hl.totalFills.toLocaleString() + " total fills"
                      : "closed positions"}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">{t("avgHoldTime")}</div>
                  <div className="stat-val" id="s-hold">
                    {hlLoading
                      ? "…"
                      : hl && !hl.noPeriodData && hl.avgHoldMs > 0
                        ? formatDuration(hl.avgHoldMs)
                        : "—"}
                  </div>
                  <div className="stat-sub">per trade</div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">{t("bestTrade")}</div>
                  <div className="stat-val pos" id="s-best">
                    {hlLoading
                      ? "…"
                      : hl && !hl.noPeriodData && hl.bestVal
                        ? "+$" + fmt(hl.bestVal)
                        : "—"}
                  </div>
                  <div className="stat-sub" id="s-best-sub">
                    {hl?.bestFill
                      ? hl.bestFill.coin + " · " + fmtDate(hl.bestFill.time)
                      : ""}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">{t("worstTrade")}</div>
                  <div className="stat-val neg" id="s-worst">
                    {hlLoading
                      ? "…"
                      : hl && !hl.noPeriodData && hl.worstVal
                        ? "-$" + fmt(Math.abs(hl.worstVal))
                        : "—"}
                  </div>
                  <div className="stat-sub" id="s-worst-sub">
                    {hl?.worstFill
                      ? hl.worstFill.coin + " · " + fmtDate(hl.worstFill.time)
                      : ""}
                  </div>
                </div>
              </div>

              {/* Charts row */}
              <div className="charts-row">
                <div className="chart-card cum">
                  <div className="chart-hdr">
                    <div className="chart-title">
                      Cumulative PnL · <span id="range-label">{range}</span>
                    </div>
                    <div className={hlChart.totalCls} id="chart-total">
                      {hlChart.total}
                    </div>
                  </div>
                  <svg
                    id="pnl-chart-svg"
                    viewBox="0 0 800 200"
                    preserveAspectRatio="none"
                    dangerouslySetInnerHTML={{
                      __html: hlFills
                        ? hlChart.svg
                        : '<text x="400" y="105" text-anchor="middle" font-size="11" fill="#4a5568">Load a wallet to see PnL chart</text>',
                    }}
                  />
                </div>
                <div className="chart-card dist">
                  <div className="chart-hdr">
                    <div className="chart-title">PnL Distribution</div>
                  </div>
                  <div
                    className="dist-bars"
                    id="dist-bars"
                    dangerouslySetInnerHTML={{
                      __html: hlLoading
                        ? '<div style="color:var(--text3);font-size:11px;text-align:center;padding:40px 0">Loading…</div>'
                        : hlDist,
                    }}
                  />
                </div>
              </div>

              {/* Recent Closed Trades */}
              <div className="trades-card">
                <div className="trades-title">
                  <span>Recent Closed Trades</span>
                  <span
                    id="trades-count"
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--text3)",
                    }}
                  >
                    {hl && !hl.noPeriodData
                      ? hl.recent.length +
                        " of " +
                        hl.closing.length +
                        " trades"
                      : ""}
                  </span>
                </div>
                <div id="trades-body">
                  {hlLoading ? (
                    <div className="hl-placeholder">Loading trades…</div>
                  ) : hlError ? (
                    <div className="hl-placeholder">Error: {hlError}</div>
                  ) : !hlFills ? (
                    <div className="hl-placeholder">
                      Enter your Hyperliquid address above to view trading
                      history.
                    </div>
                  ) : hl?.noPeriodData ? (
                    <div className="hl-placeholder">
                      No trades in this period.
                    </div>
                  ) : !hlFills.length ? (
                    <div className="hl-placeholder">
                      No trades found for this address.
                    </div>
                  ) : !hl?.recent.length ? (
                    <div className="hl-placeholder">
                      No closed trades found.
                    </div>
                  ) : (
                    <>
                      <div className="trades-grid trades-hdr">
                        <span>Token</span>
                        <span>Side</span>
                        <span>Entry</span>
                        <span>Exit</span>
                        <span>Size</span>
                        <span>PnL</span>
                        <span>PnL%</span>
                        <span>Date</span>
                      </div>
                      {hl.recent.map((f, i) => {
                        const pnl = parseFloat(f.closedPnl!);
                        const exitPx = parseFloat(f.px);
                        const sz = parseFloat(f.sz);
                        const entryPx = calcEntryPx(f);
                        const pnlPct =
                          entryPx > 0 ? (pnl / (entryPx * sz)) * 100 : 0;
                        const isLong =
                          (f.dir ?? "").toLowerCase().includes("long") ||
                          f.side === "B";
                        return (
                          <div className="trades-grid trade-row" key={i}>
                            <div className="trade-coin">{f.coin ?? "—"}</div>
                            <div>
                              <span
                                className={`trade-dir ${isLong ? "long" : "short"}`}
                              >
                                {isLong ? "Long" : "Short"}
                              </span>
                            </div>
                            <div className="trade-cell">
                              ${fmt(entryPx, entryPx < 1 ? 4 : 2)}
                            </div>
                            <div className="trade-cell">
                              ${fmt(exitPx, exitPx < 1 ? 4 : 2)}
                            </div>
                            <div className="trade-cell">
                              {fmt(sz, sz < 1 ? 4 : 2)}
                            </div>
                            <div className={`trade-pnl ${pCls(pnl)}`}>
                              {pnl >= 0 ? "+" : ""}${fmt(pnl)}
                            </div>
                            <div className={`trade-pnl ${pCls(pnl)}`}>
                              {pnlPct >= 0 ? "+" : ""}
                              {fmt(Math.abs(pnlPct), 1)}%
                            </div>
                            <div className="trade-cell">{fmtDate(f.time)}</div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: share card sidebar */}
            <div className="pnl-sidebar">
              <div className="share-card">
                <div className="share-brand">
                  <div className="share-dot"></div>
                  <div className="share-logo">
                    RDO<span>ONE</span>
                  </div>
                </div>
                <div id="share-content">
                  {!hl || hl.noPeriodData || !loadedAddr ? (
                    <div className="share-placeholder">
                      Load a Hyperliquid wallet to see your PnL card.
                    </div>
                  ) : (
                    <>
                      <div className="share-addr">{shorten(loadedAddr)}</div>
                      <div
                        className="share-pnl"
                        style={{
                          color:
                            hl.totalPnl >= 0 ? "var(--green)" : "var(--red)",
                        }}
                      >
                        {hl.totalPnl >= 0 ? "+" : ""}${fmt(hl.totalPnl)}
                      </div>
                      <div className="share-pnl-sub">ALL-TIME REALIZED PNL</div>
                      <svg
                        id="share-spark-svg"
                        viewBox="0 0 260 50"
                        preserveAspectRatio="none"
                        style={{
                          display: "block",
                          width: "100%",
                          height: 44,
                          margin: "6px 0",
                        }}
                      >
                        <path
                          d={buildSparkPath(
                            hl.cumPts.map((p) => p.v),
                            260,
                            50,
                          )}
                          fill="none"
                          stroke={hl.totalPnl >= 0 ? "#1fa67d" : "#ed7088"}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <div className="share-stats">
                        <div>
                          <div className="share-stat-lbl">Win Rate</div>
                          <div className="share-stat-val">{hl.winRate}</div>
                        </div>
                        <div>
                          <div className="share-stat-lbl">Trades</div>
                          <div className="share-stat-val">
                            {hl.wins + hl.losses}
                          </div>
                        </div>
                        <div>
                          <div className="share-stat-lbl">Best</div>
                          <div
                            className="share-stat-val"
                            style={{ color: "var(--green)" }}
                          >
                            +${fmt(hl.bestVal)}
                          </div>
                        </div>
                      </div>
                      <div className="share-actions">
                        <button
                          className="share-btn primary"
                          onClick={shareCardAction}
                        >
                          {shareCopied ? "COPIED!" : "SHARE"}
                        </button>
                        <button
                          className="share-btn secondary"
                          onClick={() =>
                            shareDataRef.current &&
                            downloadCard(shareDataRef.current)
                          }
                        >
                          DOWNLOAD
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Perps Portfolio Value card */}
              <div className="perps-val-card" id="perps-val-card">
                <div className="perps-val-hdr">
                  <span className="perps-val-title">Perps Portfolio</span>
                  <span className="perps-val-live">
                    <span
                      className="share-dot"
                      style={{ width: 5, height: 5 }}
                    ></span>{" "}
                    LIVE
                  </span>
                </div>
                <div
                  className="perps-val-eq"
                  id="pv-equity"
                  style={
                    perps &&
                    perps !== "loading" &&
                    perps !== "error" &&
                    perps.equity < 0
                      ? { color: "var(--red)" }
                      : undefined
                  }
                >
                  {perps === "loading"
                    ? "…"
                    : perps && perps !== "error"
                      ? "$" + fmt(perps.equity)
                      : "—"}
                </div>
                <div className="perps-val-sub" id="pv-upnl-row">
                  Unrealized PnL:{" "}
                  <span
                    id="pv-upnl"
                    style={
                      perps && perps !== "loading" && perps !== "error"
                        ? {
                            color:
                              perps.upnl > 0
                                ? "var(--green)"
                                : perps.upnl < 0
                                  ? "var(--red)"
                                  : "var(--text3)",
                          }
                        : undefined
                    }
                  >
                    {perps === "loading"
                      ? "…"
                      : perps && perps !== "error"
                        ? (perps.upnl >= 0 ? "+" : "") + "$" + fmt(perps.upnl)
                        : "—"}
                  </span>
                </div>
                <div className="perps-val-rows">
                  <div className="perps-val-row">
                    <span>Position Value</span>
                    <span id="pv-ntl">
                      {perps === "loading"
                        ? "…"
                        : perps && perps !== "error"
                          ? "$" + fmt(perps.ntl)
                          : "—"}
                    </span>
                  </div>
                  <div className="perps-val-row">
                    <span>Available Margin</span>
                    <span id="pv-avail">
                      {perps === "loading"
                        ? "…"
                        : perps && perps !== "error"
                          ? "$" + fmt(perps.avail)
                          : "—"}
                    </span>
                  </div>
                  <div className="perps-val-row">
                    <span>Margin Used</span>
                    <span id="pv-margin-used">
                      {perps === "loading"
                        ? "…"
                        : perps && perps !== "error"
                          ? "$" + fmt(perps.marginUsed)
                          : "—"}
                    </span>
                  </div>
                  <div className="perps-val-row">
                    <span>Account Leverage</span>
                    <span id="pv-lev">
                      {perps === "loading"
                        ? "…"
                        : perps && perps !== "error"
                          ? perps.lev
                          : "—"}
                    </span>
                  </div>
                </div>
                <div
                  id="pv-positions-wrap"
                  style={{
                    marginTop: 12,
                    display:
                      perps &&
                      perps !== "loading" &&
                      perps !== "error" &&
                      perps.positions.length
                        ? "block"
                        : "none",
                  }}
                >
                  <div className="perps-val-pos-hdr">Open Positions</div>
                  <div id="pv-positions">
                    {perps &&
                      perps !== "loading" &&
                      perps !== "error" &&
                      perps.positions.slice(0, 6).map((p, i) => (
                        <div className="pv-pos-row" key={i}>
                          <span>
                            <span className="pv-pos-coin">{p.coin}</span>
                            <span
                              className={`pv-pos-dir ${p.isLong ? "long" : "short"}`}
                            >
                              {p.isLong ? "LONG" : "SHORT"}
                            </span>
                          </span>
                          <span className={`pv-pos-pnl ${pCls(p.upnl)}`}>
                            {p.upnl >= 0 ? "+" : ""}${fmt(p.upnl)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
                <div
                  className="perps-val-placeholder"
                  id="pv-placeholder"
                  style={{ display: perps ? "none" : undefined }}
                >
                  {perps === "error"
                    ? "Failed to load perps data."
                    : "Load a Hyperliquid wallet to see perps portfolio."}
                </div>
                <button className="perps-dep-btn" onClick={openPerpsDeposit}>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v13M7 11l5 5 5-5" />
                    <path d="M4 19h16" />
                  </svg>
                  {t("depositToPerps")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ══ EXTRA MODE (Aster) ══ */}
        <div
          id="pnl-section-aster"
          style={pfMode === "aster" ? undefined : { display: "none" }}
        >
          <div className="hl-connect-bar">
            {evmAddr ? (
              <>
                <button
                  className="hl-evm-btn"
                  style={{ borderColor: "var(--green)", color: "var(--green)" }}
                  title="Click to disconnect"
                  onClick={clearEVMAddr}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <circle cx="4" cy="4" r="4" fill="#1fa67d" />
                  </svg>{" "}
                  {evmSource}: {shorten(evmAddr)}
                </button>
                <button
                  className="hl-evm-btn"
                  onClick={approveAsterAgentFlow}
                  disabled={asterApproving}
                  title="Approve this app's Aster Pro API agent for this wallet — required once before any data will load"
                >
                  {asterApproving ? "Approving…" : "Approve Agent"}
                </button>
                <button
                  className="aster-load-btn"
                  onClick={loadAsterData}
                  disabled={asterLoading}
                >
                  {asterLoading ? "Loading…" : "↺ Refresh"}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  Connect an EVM wallet, then approve this app&apos;s Aster
                  Pro API agent — Aster has no public per-address lookup like
                  Hyperliquid, so we need that one-time on-chain approval to
                  read or trade on your behalf.
                </div>
                <button
                  className="hl-evm-btn"
                  id="aster-evm-btn"
                  onClick={connectEVM}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2v20M2 12h20" />
                  </svg>
                  {t("connectEvmWallet")}
                </button>
              </>
            )}
          </div>
          {asterApproveMsg && (
            <div
              style={{
                fontSize: 12,
                marginTop: 6,
                color: asterApproveMsg.startsWith("Approval failed")
                  ? "var(--red)"
                  : "var(--green)",
              }}
            >
              {asterApproveMsg}
            </div>
          )}

          <div className="pnl-layout">
            <div className="pnl-main">
              <div className="pnl-stats">
                <div className="stat-card">
                  <div className="stat-lbl">Total Realized PnL</div>
                  <div
                    className={`stat-val ${aster?.closing.length ? pCls(aster.totalPnl) : ""}`.trim()}
                    id="as-total-pnl"
                  >
                    {asterLoading
                      ? "…"
                      : aster?.closing.length
                        ? (aster.totalPnl >= 0 ? "+" : "") +
                          "$" +
                          fmt(aster.totalPnl)
                        : "—"}
                  </div>
                  <div className="stat-sub">All-time</div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">Win Rate</div>
                  <div className="stat-val" id="as-win-rate">
                    {asterLoading
                      ? "…"
                      : aster?.closing.length
                        ? aster.winRate
                        : "—"}
                  </div>
                  <div className="stat-sub" id="as-win-sub">
                    {aster?.closing.length
                      ? `${aster.wins}W / ${aster.losses}L`
                      : "wins / losses"}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">Total Trades</div>
                  <div className="stat-val" id="as-trades">
                    {asterLoading
                      ? "…"
                      : aster?.closing.length
                        ? aster.closing.length.toLocaleString()
                        : "—"}
                  </div>
                  <div className="stat-sub">closed positions</div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">Avg Hold Time</div>
                  <div className="stat-val" id="as-hold">
                    —
                  </div>
                  <div className="stat-sub">per trade</div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">Best Trade</div>
                  <div className="stat-val pos" id="as-best">
                    {asterLoading
                      ? "…"
                      : aster?.closing.length && aster.bestVal
                        ? "+$" + fmt(aster.bestVal)
                        : "—"}
                  </div>
                  <div className="stat-sub" id="as-best-sub">
                    {aster?.bestT
                      ? aster.bestT.symbol + " · " + fmtDate(aster.bestT.time)
                      : ""}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">Worst Trade</div>
                  <div className="stat-val neg" id="as-worst">
                    {asterLoading
                      ? "…"
                      : aster?.closing.length && aster.worstVal
                        ? "-$" + fmt(Math.abs(aster.worstVal))
                        : "—"}
                  </div>
                  <div className="stat-sub" id="as-worst-sub">
                    {aster?.worstT
                      ? aster.worstT.symbol + " · " + fmtDate(aster.worstT.time)
                      : ""}
                  </div>
                </div>
              </div>

              <div className="charts-row">
                <div className="chart-card cum">
                  <div className="chart-hdr">
                    <div className="chart-title">
                      Cumulative PnL · <span id="as-range-label">{range}</span>
                    </div>
                    <div className={asterChart.totalCls} id="as-chart-total">
                      {asterChart.total}
                    </div>
                  </div>
                  <svg
                    id="as-pnl-chart-svg"
                    viewBox="0 0 800 200"
                    preserveAspectRatio="none"
                    dangerouslySetInnerHTML={{
                      __html: asterIncome
                        ? asterChart.svg
                        : '<text x="400" y="105" text-anchor="middle" font-size="11" fill="#4a5568">Loading…</text>',
                    }}
                  />
                </div>
                <div className="chart-card dist">
                  <div className="chart-hdr">
                    <div className="chart-title">PnL Distribution</div>
                  </div>
                  <div
                    className="dist-bars"
                    id="as-dist-bars"
                    dangerouslySetInnerHTML={{ __html: asterDist }}
                  />
                </div>
              </div>

              <div className="trades-card">
                <div className="trades-title">
                  <span>Aster Realized PnL History</span>
                  <span
                    id="aster-trades-count"
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--text3)",
                    }}
                  >
                    {aster?.closing.length
                      ? aster.recent.length +
                        " of " +
                        aster.closing.length +
                        " events"
                      : ""}
                  </span>
                </div>
                <div id="aster-trades-body">
                  {asterLoading ? (
                    <div className="hl-placeholder">Loading…</div>
                  ) : !asterIncome ? (
                    <div className="hl-placeholder">—</div>
                  ) : !aster?.recent.length ? (
                    <div className="hl-placeholder">
                      No realized PnL in this period.
                    </div>
                  ) : (
                    <>
                      {/* Aster's income endpoint gives pnl + symbol + time per closed
                          position, not per-fill entry/exit price like HL's userFillsByTime
                          — /fapi/v3/userTrades would add that, but requires a mandatory
                          per-symbol query, so it can't answer "all of this account's trades"
                          in one call the way this table needs. */}
                      <div
                        className="trades-grid trades-hdr"
                        style={{ gridTemplateColumns: "1fr 100px 120px" }}
                      >
                        <span>Token</span>
                        <span>PnL</span>
                        <span>Date</span>
                      </div>
                      {aster.recent.map((entry, i) => (
                        <div
                          className="trades-grid trade-row"
                          style={{ gridTemplateColumns: "1fr 100px 120px" }}
                          key={i}
                        >
                          <div className="trade-coin">
                            {entry.symbol || "—"}
                          </div>
                          <div className={`trade-pnl ${pCls(entry.income)}`}>
                            {entry.income >= 0 ? "+" : ""}${fmt(entry.income)}
                          </div>
                          <div className="trade-cell">
                            {fmtDate(entry.time)}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="pnl-sidebar">
              <div
                className="share-card"
                style={{ borderColor: "rgba(245,158,11,.2)" }}
              >
                <div className="share-brand">
                  <div
                    className="share-dot"
                    style={{ background: "#f59e0b" }}
                  ></div>
                  <div className="share-logo">
                    RDO<span style={{ color: "#f59e0b" }}>ONE</span>
                  </div>
                </div>
                <div id="aster-share-content">
                  <div className="share-placeholder">
                    Aster share card not built yet — see the stats and chart
                    below instead.
                  </div>
                </div>
              </div>

              <div
                className="perps-val-card"
                id="aster-perps-card"
                style={{ marginTop: 14 }}
              >
                <div className="perps-val-hdr">
                  <span
                    className="perps-val-title"
                    style={{ color: "#f59e0b" }}
                  >
                    Aster Perps
                  </span>
                  <span className="perps-val-live">
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "#f59e0b",
                        display: "inline-block",
                        animation: "pulse 2s ease-in-out infinite",
                      }}
                    ></span>{" "}
                    LIVE
                  </span>
                </div>
                <div className="perps-val-eq" id="as-pv-equity">
                  {asterLoading
                    ? "…"
                    : asterAccount && asterAccount !== "error"
                      ? "$" + fmt(asterAccount.totalMarginBalance)
                      : "—"}
                </div>
                <div className="perps-val-sub">
                  Unrealized PnL:{" "}
                  <span
                    id="as-pv-upnl"
                    style={{
                      fontWeight: 600,
                      ...(asterAccount && asterAccount !== "error"
                        ? {
                            color:
                              asterAccount.totalUnrealizedProfit > 0
                                ? "var(--green)"
                                : asterAccount.totalUnrealizedProfit < 0
                                  ? "var(--red)"
                                  : "var(--text3)",
                          }
                        : {}),
                    }}
                  >
                    {asterLoading
                      ? "…"
                      : asterAccount && asterAccount !== "error"
                        ? (asterAccount.totalUnrealizedProfit >= 0 ? "+" : "") +
                          "$" +
                          fmt(asterAccount.totalUnrealizedProfit)
                        : "—"}
                  </span>
                </div>
                <div className="perps-val-rows">
                  <div className="perps-val-row">
                    <span>Position Value</span>
                    <span id="as-pv-ntl">
                      {asterLoading
                        ? "…"
                        : asterAccount && asterAccount !== "error"
                          ? "$" + fmt(asterDerived.ntl)
                          : "—"}
                    </span>
                  </div>
                  <div className="perps-val-row">
                    <span>Available Margin</span>
                    <span id="as-pv-avail">
                      {asterLoading
                        ? "…"
                        : asterAccount && asterAccount !== "error"
                          ? "$" + fmt(asterAccount.availableBalance)
                          : "—"}
                    </span>
                  </div>
                  <div className="perps-val-row">
                    <span>Margin Used</span>
                    <span id="as-pv-margin">
                      {asterLoading
                        ? "…"
                        : asterAccount && asterAccount !== "error"
                          ? "$" +
                            fmt(
                              asterAccount.totalPositionInitialMargin +
                                asterAccount.totalOpenOrderInitialMargin,
                            )
                          : "—"}
                    </span>
                  </div>
                  <div className="perps-val-row">
                    <span>Account Leverage</span>
                    <span id="as-pv-lev">
                      {asterLoading
                        ? "…"
                        : asterAccount && asterAccount !== "error"
                          ? asterDerived.lev
                          : "—"}
                    </span>
                  </div>
                </div>
                <div
                  id="as-pv-positions-wrap"
                  style={{
                    marginTop: 12,
                    display:
                      asterAccount &&
                      asterAccount !== "error" &&
                      asterAccount.positions.length
                        ? "block"
                        : "none",
                  }}
                >
                  <div className="perps-val-pos-hdr">Open Positions</div>
                  <div id="as-pv-positions">
                    {asterAccount &&
                      asterAccount !== "error" &&
                      asterAccount.positions.slice(0, 6).map((p, i) => (
                        <div className="pv-pos-row" key={i}>
                          <span>
                            <span className="pv-pos-coin">{p.symbol}</span>
                            <span
                              className={`pv-pos-dir ${p.positionAmt > 0 ? "long" : "short"}`}
                            >
                              {p.positionAmt > 0 ? "LONG" : "SHORT"}
                            </span>
                          </span>
                          <span
                            className={`pv-pos-pnl ${pCls(p.unrealizedProfit)}`}
                          >
                            {p.unrealizedProfit >= 0 ? "+" : ""}$
                            {fmt(p.unrealizedProfit)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
                <div
                  className="perps-val-placeholder"
                  id="as-pv-placeholder"
                  style={{
                    display:
                      asterAccount && asterAccount !== "error"
                        ? "none"
                        : undefined,
                  }}
                >
                  {!evmAddr ? (
                    <>
                      Connect an EVM wallet to see your Aster portfolio.
                      <br />
                      <span style={{ fontSize: 10, color: "var(--text3)" }}>
                        Collateral: USDT · Max leverage: 200x
                      </span>
                    </>
                  ) : asterAccount === "error" ? (
                    <>
                      Could not load Aster portfolio — click &quot;Approve
                      Agent&quot; above to grant this app&apos;s Aster agent
                      access to this wallet.
                      <br />
                      <span style={{ fontSize: 10, color: "var(--text3)" }}>
                        Collateral: USDT · Max leverage: 200x
                      </span>
                    </>
                  ) : (
                    <>
                      Loading Aster portfolio…
                      <br />
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--text3)",
                          marginTop: 4,
                          display: "block",
                        }}
                      >
                        Collateral: USDT &nbsp;·&nbsp; Max leverage: 200x
                      </span>
                    </>
                  )}
                </div>
                <button
                  className="perps-dep-btn"
                  style={{ background: "#f59e0b", color: "#1a1044" }}
                  onClick={() =>
                    window.open(
                      "https://www.asterdex.com",
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v13M7 11l5 5 5-5" />
                    <path d="M4 19h16" />
                  </svg>
                  Deposit to Aster Perps
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── PnL Calendar Modal ── */}
      <div
        className={`cal-overlay${calOpen ? " open" : ""}`}
        id="cal-overlay"
        onClick={() => setCalOpen(false)}
      >
        <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cal-modal-hdr">
            <div className="cal-modal-title">
              PNL CALENDAR
              <span
                style={{
                  padding: "3px 8px",
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".5px",
                  color: "var(--text2)",
                }}
              >
                $ USD
              </span>
            </div>
            <div className="cal-modal-nav">
              <button
                className="cal-nav-btn"
                onClick={() => {
                  setCalMonth((m) => {
                    if (m - 1 < 0) {
                      setCalYear((y) => y - 1);
                      return 11;
                    }
                    return m - 1;
                  });
                }}
              >
                ‹
              </button>
              <span className="cal-month-lbl" id="cal-month-lbl">
                {calendar.monthLabel}
              </span>
              <button
                className="cal-nav-btn"
                onClick={() => {
                  setCalMonth((m) => {
                    if (m + 1 > 11) {
                      setCalYear((y) => y + 1);
                      return 0;
                    }
                    return m + 1;
                  });
                }}
              >
                ›
              </button>
              <button
                className="cal-close-btn"
                onClick={() => setCalOpen(false)}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="cal-summary">
            <div className={calendar.monthTotalCls} id="cal-month-total">
              {calendar.monthTotal}
            </div>
            <div className="cal-bar-track">
              <div
                className="cal-bar-fill"
                id="cal-bar-fill"
                style={{
                  width: calendar.barPct + "%",
                  background: calendar.barColor,
                }}
              ></div>
            </div>
            <div className="cal-winloss">
              <span style={{ color: "var(--green)" }} id="cal-win-label">
                {calendar.winLabel}
              </span>
              <span style={{ color: "var(--red)" }} id="cal-loss-label">
                {calendar.lossLabel}
              </span>
            </div>
          </div>
          <div
            className="cal-grid"
            id="cal-grid"
            dangerouslySetInnerHTML={{
              __html: hl
                ? calendar.gridHtml
                : '<div class="hl-placeholder" style="grid-column:1/-1">Load a wallet to see calendar</div>',
            }}
          />
          <div className="cal-footer">
            <span>
              Current Streak:{" "}
              <strong id="cal-streak">{calendar.streakLabel}</strong>
            </span>
            <span
              id="cal-best-streak"
              dangerouslySetInnerHTML={{ __html: calendar.bestStreakHtml }}
            />
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 9,
                letterSpacing: ".08em",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  display: "inline-block",
                }}
              ></span>
              RDO<span style={{ color: "var(--accent)" }}>ONE</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Deposit / Transfer Modal ── */}
      <div
        className={`overlay${depOpen ? " open" : ""}`}
        id="deposit-modal"
        onClick={() => {
          setDepOpen(false);
          depBack();
        }}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 420 }}
        >
          <div className="modal-hdr">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                id="dep-back-btn"
                onClick={depBack}
                style={{
                  display: depStep === "lifi" ? undefined : "none",
                  background: "transparent",
                  border: "none",
                  color: "var(--text2)",
                  cursor: "pointer",
                  fontSize: 20,
                  lineHeight: 1,
                  padding: "0 4px 0 0",
                  fontFamily: "inherit",
                }}
              >
                ‹
              </button>
              <div className="modal-title" id="dep-modal-title">
                {depTitle}
              </div>
            </div>
            <button
              className="modal-x"
              onClick={() => {
                setDepOpen(false);
                depBack();
              }}
            >
              ×
            </button>
          </div>
          {/* Step 1: token picker */}
          <div
            id="dep-step-pick"
            style={{
              padding: "0 16px 16px",
              display: depStep === "pick" ? undefined : "none",
            }}
          >
            <div className="xfer-box">
              <div className="xfer-label">
                From Tokens
                <span className="xfer-bal-hint">
                  <span id="dep-token-bal">
                    {depToken
                      ? fmt(depToken.balance, depToken.balance < 1 ? 4 : 2) +
                        " " +
                        depToken.symbol
                      : "—"}
                  </span>{" "}
                  <button className="xfer-max-btn" onClick={depMax}>
                    Max
                  </button>
                </span>
              </div>
              <div className="xfer-row">
                <button
                  className="xfer-token-btn"
                  id="dep-token-btn"
                  onClick={() => setDepListOpen((o) => !o)}
                >
                  <div id="dep-token-icon-wrap">
                    {depToken?.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="xfer-tok-icon"
                        src={depToken.logo}
                        alt=""
                      />
                    ) : (
                      <div className="xfer-tok-ph">
                        {(depToken?.symbol || "S")[0]}
                      </div>
                    )}
                  </div>
                  <span id="dep-token-sym">{depToken?.symbol ?? "SOL"}</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <div className="xfer-amount-wrap">
                  <input
                    type="number"
                    id="dep-amount"
                    className="xfer-amount-input"
                    placeholder="0.00"
                    value={depAmount}
                    onChange={(e) => setDepAmount(e.target.value)}
                  />
                  <div className="xfer-amount-usd" id="dep-amount-usd">
                    ${fmt(depUsd)}
                  </div>
                </div>
              </div>
            </div>
            <div
              id="dep-token-list"
              className="dep-tok-list"
              style={{ display: depListOpen ? undefined : "none" }}
            >
              {!assets?.length ? (
                <div
                  style={{
                    padding: 16,
                    color: "var(--text3)",
                    textAlign: "center",
                    fontSize: 12,
                  }}
                >
                  Connect wallet to see tokens
                </div>
              ) : (
                assets.map((a, i) => (
                  <div
                    className="dep-tok-item"
                    key={i}
                    onClick={() => depSelectToken(a)}
                  >
                    {a.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="dep-tok-item-icon" src={a.logo} alt="" />
                    ) : (
                      <div className="dep-tok-item-ph">
                        {(a.symbol || "?")[0]}
                      </div>
                    )}
                    <div className="dep-tok-info">
                      <div className="dep-tok-sym">{a.symbol}</div>
                      <div className="dep-tok-name">{a.name}</div>
                    </div>
                    <div className="dep-tok-right">
                      <div className="dep-tok-bal">
                        {fmt(a.balance, a.balance < 1 ? 4 : 2)}
                      </div>
                      <div className="dep-tok-usd">
                        {a.value > 0.005 ? "$" + fmt(a.value) : "—"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="xfer-arrow-row">
              <div className="xfer-arrow-circle">↓</div>
            </div>
            <div className="xfer-box">
              <div className="xfer-label">To Perps</div>
              <div className="xfer-to-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="xfer-to-icon"
                  src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png"
                  alt="USDC"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <div>
                  <div className="xfer-to-name">USDC</div>
                  <div className="xfer-to-sub">Hyperliquid Perps</div>
                </div>
                <div className="xfer-to-right">
                  <div className="xfer-to-val" id="dep-to-val">
                    {fmt(depUsd * 0.995)}
                  </div>
                  <div className="xfer-to-usd" id="dep-to-usd">
                    {depAmtNum ? "~$" + fmt(depUsd * 0.995) : "$0.00"}
                  </div>
                </div>
              </div>
            </div>
            <button
              className="xfer-go-btn"
              id="dep-go-btn"
              onClick={depStartTransfer}
            >
              Transfer
            </button>
          </div>
          {/* Step 2: LI.FI bridge */}
          <div
            id="dep-step-lifi"
            style={{
              display: depStep === "lifi" ? undefined : "none",
              padding: 0,
            }}
          >
            <iframe
              id="lifi-deposit-frame"
              className="lifi-frame"
              title="Bridge via LI.FI"
              allow="clipboard-write"
              src={depFrameSrc || undefined}
            ></iframe>
          </div>
        </div>
      </div>

      {/* ── Swap Modal ── */}
      <div
        className={`overlay${swapOpen ? " open" : ""}`}
        id="swap-modal"
        onClick={() => setSwapOpen(false)}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 520 }}
        >
          <div className="modal-hdr">
            <div className="modal-title">Swap</div>
            <button className="modal-x" onClick={() => setSwapOpen(false)}>
              ×
            </button>
          </div>
          <div className="modal-body" style={{ padding: 0 }}>
            <iframe
              id="lifi-swap-frame"
              className="lifi-frame"
              title="Swap via LI.FI"
              allow="clipboard-write"
              src={swapSrc || undefined}
            ></iframe>
          </div>
        </div>
      </div>

      {/* ── Convert Modal ── */}
      <div
        className={`overlay${convertOpen ? " open" : ""}`}
        id="convert-modal"
        onClick={() => setConvertOpen(false)}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 520 }}
        >
          <div className="modal-hdr">
            <div className="modal-title">Convert to USDC</div>
            <button className="modal-x" onClick={() => setConvertOpen(false)}>
              ×
            </button>
          </div>
          <div className="modal-body" style={{ padding: 0 }}>
            <iframe
              id="lifi-convert-frame"
              className="lifi-frame"
              title="Convert via LI.FI"
              allow="clipboard-write"
              src={convertSrc || undefined}
            ></iframe>
          </div>
        </div>
      </div>
    </>
  );
}
