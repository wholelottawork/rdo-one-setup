'use client';
import { useEffect } from 'react';

const PAGE_CSS = `
main{max-width:1440px;margin:0 auto;padding:0 24px 40px;padding-top:calc(40px + 8px)}
h1{font-size:18px;font-weight:700;letter-spacing:-.03em;margin-bottom:16px}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
@media(max-width:640px){.panels{grid-template-columns:1fr}}
.panel{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:6px;overflow:hidden}
.panel-hdr{padding:10px 14px;border-bottom:1px solid #1f1f1f;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#878c8f}
.prow{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;cursor:pointer;transition:background .1s}
.prow:hover{background:#161616}
.prow-l{display:flex;align-items:center;gap:8px;min-width:0}
.coin-img{width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0}
.coin-nm{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.coin-sy{font-size:10px;color:#878c8f}
.prow-r{display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;gap:2px}
.p-price{font-size:11px;font-variant-numeric:tabular-nums}
.p-pct{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.rank-badge{width:18px;height:18px;border-radius:50%;background:#161616;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#878c8f;flex-shrink:0}
.tbl-wrap{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:6px;overflow:hidden;margin-bottom:16px}
.tbl-hdr{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #1f1f1f}
.tbl-title{font-size:13px;font-weight:600}
.tbl-ts{font-size:11px;color:#878c8f}
table{width:100%;border-collapse:collapse}
th{padding:8px 10px;text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#878c8f;white-space:nowrap;border-bottom:1px solid #1f1f1f}
th.l{text-align:left}
td{padding:9px 10px;border-top:1px solid #1f1f1f}
tr.coin-row{cursor:pointer;transition:background .1s}
tr.coin-row:hover{background:#161616}
.td-r{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:#c8d2d6}
.td-nm{display:flex;align-items:center;gap:8px}
.td-nm-n{font-size:12px;font-weight:600}
.td-nm-s{font-size:10px;color:#878c8f}
.td-px{text-align:right;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.badge{display:inline-flex;align-items:center;gap:2px;padding:2px 5px;border-radius:3px;font-size:10px;font-weight:600;font-variant-numeric:tabular-nums}
.badge.up{background:rgba(31,166,125,.15);color:#1fa67d}
.badge.dn{background:rgba(237,112,136,.15);color:#ed7088}
.hl-wrap{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:6px;overflow:hidden;margin-bottom:16px}
.hl-top{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #1f1f1f}
.hl-search-box{display:flex;align-items:center;gap:8px;background:#161616;border:1px solid #1f1f1f;border-radius:6px;padding:6px 10px;flex:1;max-width:320px}
.hl-search-box svg{flex-shrink:0;opacity:.5}
.hl-search{background:none;border:none;outline:none;color:#fff;font-size:12px;font-family:inherit;width:100%}
.hl-search::placeholder{color:#878c8f}
.hl-tbl{width:100%;border-collapse:collapse}
.hl-tbl th{padding:8px 12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#878c8f;white-space:nowrap;border-bottom:1px solid #1f1f1f;text-align:right;cursor:pointer;user-select:none}
.hl-tbl th:first-child{text-align:left}
.hl-tbl th:hover{color:#fff}
.hl-tbl th.sort-active{color:#50d2c1}
.hl-tbl td{padding:9px 12px;border-top:1px solid rgba(255,255,255,.04);font-size:12px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.hl-tbl tr{cursor:pointer;transition:background .1s}
.hl-tbl tr:hover{background:#161616}
.hl-market{display:flex;align-items:center;gap:8px;text-align:left}
.hl-star{color:#878c8f;font-size:13px;cursor:pointer;flex-shrink:0}
.hl-star:hover{color:#f5c518}
.hl-sym{font-size:12px;font-weight:600;color:#fff}
.hl-lev{font-size:10px;font-weight:600;color:#878c8f;background:#161616;padding:1px 4px;border-radius:3px;flex-shrink:0}
.hl-ch-val{font-weight:600}
.conv-wrap{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:6px;overflow:hidden;margin-bottom:16px}
.conv-body{padding:16px;display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center}
@media(max-width:600px){.conv-body{grid-template-columns:1fr}.conv-arrow{display:none}}
.conv-side{display:flex;gap:6px;align-items:center}
.conv-input{flex:1;background:#161616;border:1px solid #1f1f1f;color:#fff;padding:9px 10px;border-radius:6px;font-size:13px;font-family:inherit;outline:none;font-variant-numeric:tabular-nums;min-width:0}
.conv-input:focus{border-color:#50d2c1}
.conv-sel{background:#161616;border:1px solid #1f1f1f;color:#fff;padding:9px 8px;border-radius:6px;font-size:11px;font-family:inherit;outline:none;cursor:pointer;min-width:64px}
.conv-arrow{font-size:20px;color:#878c8f;text-align:center}
.conv-result{flex:1;background:#161616;border:1px solid #1f1f1f;color:#fff;padding:9px 10px;border-radius:6px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;min-width:0}
.fut-wrap{display:grid;grid-template-columns:1fr 320px;gap:10px;margin-bottom:16px}
@media(max-width:900px){.fut-wrap{grid-template-columns:1fr}}
.fut-left,.fut-right{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:6px;overflow:hidden;display:flex;flex-direction:column}
.fut-hdr{padding:10px 14px;border-bottom:1px solid #1f1f1f;display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}
.fut-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#878c8f}
.fut-tabs{display:flex;gap:2px;margin-left:auto}
.fut-tab{padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;color:#878c8f;background:none;border:none;transition:color .1s,background .1s;font-family:inherit}
.fut-tab.active{background:#161616;color:#fff}
.sym-pills{display:flex;gap:4px}
.sym-pill{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;background:#161616;color:#878c8f;border:none;transition:color .1s,background .1s;font-family:inherit}
.sym-pill.active{background:#50d2c1;color:#000}
.liq-map-body{padding:12px 14px;height:280px;display:flex;flex-direction:column;gap:3px;overflow:hidden}
.liq-map-loading{display:flex;align-items:center;justify-content:center;height:100%;color:#878c8f;font-size:12px}
.liq-bar-row{display:flex;align-items:center;gap:6px;height:16px;flex-shrink:0}
.liq-price{font-size:9px;color:#878c8f;min-width:64px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}
.liq-bar-wrap{flex:1;height:7px;background:rgba(255,255,255,.04);border-radius:2px;overflow:hidden}
.liq-bar-fill{height:100%;border-radius:2px}
.liq-mark-line{border-top:1px dashed #50d2c1;margin:2px 0;flex-shrink:0}
.liq-oi-tag{font-size:9px;color:#878c8f;min-width:44px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}
.ai-body{padding:10px 12px;display:flex;flex-direction:column;gap:6px;flex:1;overflow-y:auto}
.ai-signal{background:#161616;border-radius:6px;padding:8px 10px;flex-shrink:0}
.ai-sig-hdr{display:flex;align-items:center;gap:6px;margin-bottom:3px}
.ai-sig-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.ai-sig-name{font-size:11px;font-weight:600;color:#fff}
.ai-sig-val{font-size:11px;font-weight:700;margin-left:auto;font-variant-numeric:tabular-nums}
.ai-sig-body{font-size:10px;color:#878c8f;line-height:1.4}
.ai-verdict{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid #1f1f1f;flex-shrink:0}
.ai-verdict-lbl{font-size:11px;color:#878c8f}
.ai-verdict-val{font-size:13px;font-weight:700;letter-spacing:.02em}
.inflow-body{padding:12px 14px;height:280px;overflow-y:auto}
.sk{background:#161616;border-radius:3px;animation:pulse-sk 1.5s ease-in-out infinite;display:inline-block}
@keyframes pulse-sk{0%,100%{opacity:1}50%{opacity:.35}}
.loading-rows{padding:20px;text-align:center;color:#878c8f;font-size:12px}
.lang-wrap{position:relative}
.lang-btn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:transparent;border:1px solid #1f1f1f;border-radius:4px;color:#878c8f;cursor:pointer}
.lang-dropdown{position:absolute;top:calc(100% + 6px);right:0;z-index:900;background:#0d0d0d;border:1px solid #1f1f1f;border-radius:4px;padding:4px 0;min-width:110px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:none}
.lang-option{display:block;width:100%;padding:7px 14px;border:none;background:transparent;color:#878c8f;font-size:12px;text-align:left;cursor:pointer;font-family:inherit}
`;

export default function MarketsPage() {
  useEffect(() => {
    const SYMS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','POLUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','TIAUSDT','JUPUSDT','WIFUSDT','BONKUSDT','PEPEUSDT'];
    const LABEL: Record<string,string> = {BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA',AVAXUSDT:'AVAX',LINKUSDT:'LINK',DOTUSDT:'DOT',POLUSDT:'POL',UNIUSDT:'UNI',LTCUSDT:'LTC',ATOMUSDT:'ATOM',NEARUSDT:'NEAR',APTUSDT:'APT',ARBUSDT:'ARB',OPUSDT:'OP',INJUSDT:'INJ',SUIUSDT:'SUI',TIAUSDT:'TIA',JUPUSDT:'JUP',WIFUSDT:'WIF',BONKUSDT:'BONK',PEPEUSDT:'PEPE'};
    const CG_TTL = 70_000;
    const cgCache: Record<string,{data:any,ts:number}> = {};
    let coins: any[] = [];
    let tickerData: Record<string,{px:number,ch:number}> = {};
    let globalData: any = null;
    let hlData: any[] = [];
    let hlSort = { col: 'vol', dir: -1 };
    let hlQuery = '';
    const FUT_SYMS = ['BTC','ETH','SOL','BNB','XRP'];
    let futSym = 'BTC';
    let futTab = 'liqmap';
    let futData: any = null;

    const el  = (id: string) => document.getElementById(id);
    const set = (id: string, v: string) => { const e = el(id); if (e) e.textContent = v; };
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    function fmtLarge(n: number) {
      if (!isFinite(n) || n === null) return '—';
      if (n >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
      if (n >= 1e9)  return '$' + (n/1e9).toFixed(2) + 'B';
      if (n >= 1e6)  return '$' + (n/1e6).toFixed(2) + 'M';
      return '$' + n.toLocaleString('en-US');
    }
    function fmtPx(n: number) {
      if (!isFinite(n) || n === null) return '—';
      if (n >= 10000) return '$' + n.toLocaleString('en-US', {minimumFractionDigits:0,maximumFractionDigits:0});
      if (n >= 1000)  return '$' + n.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
      if (n >= 1)     return '$' + n.toFixed(4);
      if (n >= 0.001) return '$' + n.toFixed(5);
      return '$' + n.toFixed(8);
    }
    function fmtPct(v: number) { if (!isFinite(v)||v===null) return '—'; return (v>=0?'+':'')+v.toFixed(2)+'%'; }
    function pCls(v: number) { return (v??0) >= 0 ? 'up' : 'dn'; }
    function fgColor(v: number) { const n=parseInt(String(v),10); if(n<=25)return'#ed7088';if(n<=45)return'#f97316';if(n<=55)return'#eab308';if(n<=75)return'#50d2c1';return'#1fa67d'; }
    function fmtHL(n: number) { if(!isFinite(n)||n==null)return'—';if(n>=1e9)return'$'+(n/1e9).toFixed(2)+'B';if(n>=1e6)return'$'+(n/1e6).toFixed(2)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(2)+'K';return'$'+n.toFixed(2); }
    function fmtHLPx(n: number) { if(!isFinite(n)||n==null)return'—';if(n>=10000)return n.toLocaleString('en-US',{maximumFractionDigits:0});if(n>=100)return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});if(n>=1)return n.toFixed(4);return n.toPrecision(4); }
    function fmtK(n: number) { if(n>=1e6)return'$'+(n/1e6).toFixed(2)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';return'$'+n.toFixed(2); }

    async function cgFetch(path: string) {
      const now = Date.now();
      const hit = cgCache[path];
      if (hit && now - hit.ts < CG_TTL) return hit.data;
      try {
        const res = await fetch('/coingecko' + path);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.status?.error_code) cgCache[path] = { data, ts: now };
        return data;
      } catch { return null; }
    }

    function buildTicker() {
      const html = SYMS.map(s => `<span class="t-item t-${s}"><span class="t-sym">${LABEL[s]}</span><span class="t-px">—</span><span class="t-ch">—</span></span>`).join('');
      const tickerEl = el('ticker'); if (tickerEl) tickerEl.innerHTML = html + html;
    }

    async function fetchTicker() {
      try {
        const res = await fetch(`/binance/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(SYMS))}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        data.forEach((t: any) => {
          const px = parseFloat(t.lastPrice), ch = parseFloat(t.priceChangePercent);
          if (!isFinite(px)) return;
          tickerData[t.symbol] = { px, ch };
          document.querySelectorAll(`.t-${t.symbol}`).forEach(item => {
            const pxEl = item.querySelector('.t-px'), chEl = item.querySelector('.t-ch');
            if (pxEl) pxEl.textContent = fmtPx(px);
            if (chEl) { chEl.textContent = ' '+fmtPct(ch); chEl.className = 't-ch '+pCls(ch); }
          });
        });
      } catch {}
    }

    function makeSpark(rawPts: number[][], color: string) {
      const step = Math.max(1, Math.floor(rawPts.length/40));
      const pts = rawPts.filter((_,i) => i%step===0);
      if (pts.length < 2) return '';
      const vals = pts.map(p=>p[1]);
      const min = Math.min(...vals), max = Math.max(...vals), rng = max-min||1;
      const W=120, H=44;
      const px = (i:number) => (i/(pts.length-1))*W;
      const py = (v:number) => H-((v-min)/rng)*H*0.8-H*0.1;
      const linePts = pts.map((p,i) => `${px(i).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ');
      const lastX = px(pts.length-1).toFixed(1);
      const areaD = `M 0,${py(pts[0][1]).toFixed(1)} `+pts.slice(1).map((p,i)=>`L ${px(i+1).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ')+` L ${lastX},${H} L 0,${H} Z`;
      const gId = 'sg'+Math.random().toString(36).slice(2,6);
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.3"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${areaD}" fill="url(#${gId})"/><polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    async function fetchSparklines() {
      try {
        const res = await fetch('/binance/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=42');
        if (!res.ok) return;
        const klines = await res.json();
        const mcPts  = klines.map((k:any,i:number) => [i, parseFloat(k[4])]);
        const volPts = klines.map((k:any,i:number) => [i, parseFloat(k[7])]);
        const mcLast  = mcPts[mcPts.length-1][1], mc24ago = mcPts[Math.max(0,mcPts.length-7)][1];
        const mcPct   = mc24ago ? ((mcLast-mc24ago)/mc24ago)*100 : 0;
        const last6Vol = volPts.slice(-6).reduce((s:number,p:any)=>s+p[1],0);
        const prev6Vol = volPts.slice(-12,-6).reduce((s:number,p:any)=>s+p[1],0);
        const volPct   = prev6Vol ? ((last6Vol-prev6Vol)/prev6Vol)*100 : 0;
        const mcColor  = mcPct>=0?'#1fa67d':'#ed7088', volColor=volPct>=0?'#1fa67d':'#ed7088';
        const mcChEl=el('s-mcap-ch'),volChEl=el('s-vol-ch');
        if(mcChEl){mcChEl.textContent=fmtPct(mcPct);mcChEl.className='bc-ch '+pCls(mcPct);}
        if(volChEl){volChEl.textContent=fmtPct(volPct);volChEl.className='bc-ch '+pCls(volPct);}
        const smEl=el('spark-mcap'),svEl=el('spark-vol');
        if(smEl)smEl.innerHTML=makeSpark(mcPts,mcColor);
        if(svEl)svEl.innerHTML=makeSpark(volPts,volColor);
      } catch {}
    }

    function renderMarketStats() {
      const btc=tickerData['BTCUSDT'],eth=tickerData['ETHUSDT'],d=globalData,c0=coins[0];
      const rows=[
        ['BTC Price',btc?fmtPx(btc.px):'—',btc?fmtPct(btc.ch):null,btc?pCls(btc.ch):''],
        ['ETH Price',eth?fmtPx(eth.px):'—',eth?fmtPct(eth.ch):null,eth?pCls(eth.ch):''],
        ['BTC Market Cap',c0?fmtLarge(c0.market_cap):'—',null,''],
        ['BTC 24h Volume',c0?fmtLarge(c0.total_volume):'—',null,''],
        ['Total Market Cap',d?fmtLarge(d.total_market_cap?.usd??0):'—',d?fmtPct(d.market_cap_change_percentage_24h_usd??0):null,d?pCls(d.market_cap_change_percentage_24h_usd??0):''],
        ['BTC Dominance',d?((d.market_cap_percentage?.btc??0).toFixed(1)+'%'):'—',null,''],
        ['Total Volume 24h',d?fmtLarge(d.total_volume?.usd??0):'—',null,''],
      ];
      const body=el('mkt-stats-body');
      if(!body)return;
      body.innerHTML=rows.map(([lbl,val,ch,cls])=>`<div class="mst-row"><span class="mst-lbl">${lbl}</span><span class="mst-val">${val}${ch?`<span class="mst-ch ${cls}">${ch}</span>`:''}</span></div>`).join('');
    }

    async function fetchGlobal() {
      const [gj,fgj]=await Promise.allSettled([
        cgFetch('/api/v3/global'),
        fetch('/feargreed/fng/?limit=1').then(r=>r.json()),
      ]);
      const d=gj.status==='fulfilled'?gj.value?.data:null;
      if(d){globalData=d;set('s-mcap',fmtLarge(d.total_market_cap?.usd??0));set('s-vol',fmtLarge(d.total_volume?.usd??0));set('s-btc',(d.market_cap_percentage?.btc??0).toFixed(1)+'%');renderMarketStats();}
      const fg=fgj.status==='fulfilled'?fgj.value?.data?.[0]:null;
      if(fg){const fgEl=el('s-fg');if(fgEl){fgEl.textContent=fg.value;fgEl.style.color=fgColor(fg.value);}set('s-fg-l',fg.value_classification+' ('+fg.value+')');}
    }

    async function fetchTrending() {
      const json=await cgFetch('/api/v3/search/trending');
      if(!json?.coins)return;
      const items=json.coins.slice(0,7).map((c:any)=>c.item);
      const trendEl=el('trending');
      if(!trendEl)return;
      trendEl.innerHTML=items.map((c:any,i:number)=>{
        const ch=c.data?.price_change_percentage_24h?.usd??0,px=c.data?.price??0;
        return `<div class="prow"><div class="prow-l"><div class="rank-badge">${i+1}</div><img class="coin-img" src="${c.small||c.thumb}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div><div class="coin-nm">${c.name}</div><div class="coin-sy">${c.symbol.toUpperCase()}</div></div></div><div class="prow-r">${px>0?`<div class="p-price">${fmtPx(px)}</div>`:''}<div class="p-pct ${pCls(ch)}">${fmtPct(ch)}</div></div></div>`;
      }).join('');
    }

    async function fetchCoins() {
      const json=await cgFetch('/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=7d,24h');
      if(!Array.isArray(json))return;
      coins=json.slice(0,20);
      const gainers=[...json].filter(c=>(c.price_change_percentage_24h??0)>0).sort((a,b)=>(b.price_change_percentage_24h??0)-(a.price_change_percentage_24h??0)).slice(0,7);
      const gainersEl=el('gainers');
      if(gainersEl)gainersEl.innerHTML=gainers.map((c:any)=>{
        const ch=c.price_change_percentage_24h??0;
        return `<div class="prow"><div class="prow-l"><img class="coin-img" src="${c.image}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div><div class="coin-nm">${c.name}</div><div class="coin-sy">${c.symbol.toUpperCase()}</div></div></div><div class="prow-r"><div class="p-price">${fmtPx(c.current_price)}</div><div class="p-pct up">${fmtPct(ch)}</div></div></div>`;
      }).join('');
      renderTable();
      buildConverter(json.slice(0,12));
      set('tbl-ts','Updated '+new Date().toLocaleTimeString());
      renderMarketStats();
    }

    function renderTable() {
      if(!coins.length)return;
      const coinsEl=el('coins-tbl');
      if(!coinsEl)return;
      coinsEl.innerHTML=`<table><thead><tr><th class="l" style="width:32px">#</th><th class="l">Name</th><th>Price</th><th>24h %</th><th>7d %</th><th>Market Cap</th><th>Volume (24h)</th></tr></thead><tbody>${coins.map((c:any)=>{
        const ch24=c.price_change_percentage_24h??0,ch7d=c.price_change_percentage_7d_in_currency??0;
        return `<tr class="coin-row"><td style="color:#878c8f;font-size:11px">${c.market_cap_rank}</td><td><div class="td-nm"><img src="${c.image}" alt="" width="22" height="22" style="border-radius:50%;object-fit:cover;flex-shrink:0" loading="lazy" onerror="this.style.visibility='hidden'"><div><div class="td-nm-n">${c.name}</div><div class="td-nm-s">${c.symbol.toUpperCase()}</div></div></div></td><td class="td-px">${fmtPx(c.current_price)}</td><td class="td-r"><span class="badge ${pCls(ch24)}">${ch24>=0?'▲':'▼'} ${Math.abs(ch24).toFixed(2)}%</span></td><td class="td-r"><span class="badge ${pCls(ch7d)}">${ch7d>=0?'▲':'▼'} ${Math.abs(ch7d).toFixed(2)}%</span></td><td class="td-r">${fmtLarge(c.market_cap)}</td><td class="td-r">${fmtLarge(c.total_volume)}</td></tr>`;
      }).join('')}</tbody></table>`;
    }

    function buildConverter(list: any[]) {
      const fromSel=el('cv-from') as HTMLSelectElement|null,toSel=el('cv-to') as HTMLSelectElement|null;
      if(!fromSel||!toSel)return;
      const opts=list.map(c=>`<option value="${c.id}" data-px="${c.current_price}">${c.symbol.toUpperCase()}</option>`).join('');
      fromSel.innerHTML=opts;
      toSel.innerHTML='<option value="__usd" data-px="1">USD</option>'+opts;
      const compute=()=>{
        const cvAmt=el('cv-amt') as HTMLInputElement|null;
        const amt=parseFloat(cvAmt?.value||'0')||0;
        const fromPx=parseFloat(fromSel.selectedOptions[0]?.dataset.px||'0');
        const toPx=parseFloat(toSel.selectedOptions[0]?.dataset.px||'1')||1;
        const result=(amt*fromPx)/toPx;
        const rEl=el('cv-result');
        if(rEl)rEl.textContent=isFinite(result)?(result>=1000?result.toLocaleString('en-US',{maximumFractionDigits:2}):result.toFixed(result>=1?4:8)):'—';
      };
      el('cv-amt')?.addEventListener('input',compute);
      fromSel.addEventListener('change',compute);
      toSel.addEventListener('change',compute);
      compute();
    }

    async function fetchHLPerps() {
      try {
        const r=await fetch('/hl/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'metaAndAssetCtxs'})});
        const [meta,ctxs]=await r.json();
        hlData=meta.universe.map((coin:any,i:number)=>{
          const ctx=ctxs[i]||{};
          const px=parseFloat(ctx.markPx)||0,prev=parseFloat(ctx.prevDayPx)||0;
          const chgAbs=px-prev,chgPct=prev?(chgAbs/prev*100):0;
          const fund8h=(parseFloat(ctx.funding)||0)*8*100;
          const vol=parseFloat(ctx.dayNtlVlm)||0,oi=parseFloat(ctx.openInterest)*px||0;
          return{name:coin.name,maxLev:coin.maxLeverage,px,chgAbs,chgPct,fund8h,vol,oi};
        });
        renderHLTable();
      }catch(e){console.error('HL perps:',e);}
    }

    function renderHLTable() {
      let rows=hlData.filter(d=>!hlQuery||d.name.toLowerCase().includes(hlQuery.toLowerCase()));
      rows=rows.slice().sort((a,b)=>{
        const av=hlSort.col==='name'?a.name:(a[hlSort.col as keyof typeof a]??0);
        const bv=hlSort.col==='name'?b.name:(b[hlSort.col as keyof typeof b]??0);
        if(hlSort.col==='name')return hlSort.dir*(av as string).localeCompare(bv as string);
        return hlSort.dir*((av as number)-(bv as number));
      });
      const tbody=el('hl-tbody');
      if(!tbody)return;
      tbody.innerHTML=rows.map(d=>{
        const chgCls=d.chgPct>=0?'up':'dn',fundCls=d.fund8h>=0?'up':'dn',chgSign=d.chgPct>=0?'+':'';
        return `<tr onclick="location.href='/?sym=${encodeURIComponent(d.name)}'"><td><div class="hl-market"><span class="hl-star">☆</span><span class="hl-sym">${d.name}-USDC</span><span class="hl-lev">${d.maxLev}x</span></div></td><td>${fmtHLPx(d.px)}</td><td class="hl-ch-val ${chgCls}">${chgSign}${d.chgAbs.toFixed(d.px>=100?2:4)} / ${chgSign}${d.chgPct.toFixed(2)}%</td><td class="${fundCls}">${d.fund8h>=0?'+':''}${d.fund8h.toFixed(4)}%</td><td>${fmtHL(d.vol)}</td><td>${fmtHL(d.oi)}</td></tr>`;
      }).join('');
    }

    function initHLTable() {
      document.querySelectorAll('.hl-tbl th[data-col]').forEach(th => {
        th.addEventListener('click',()=>{
          const col=(th as HTMLElement).dataset.col||'';
          if(hlSort.col===col)hlSort.dir*=-1;
          else{hlSort.col=col;hlSort.dir=col==='name'?1:-1;}
          document.querySelectorAll('.hl-tbl th').forEach(t=>{
            const tc=(t as HTMLElement).dataset.col||'';
            t.classList.toggle('sort-active',tc===col);
            const labels:Record<string,string>={name:'Market',px:'Last Price',chg:'24h Change',fund:'8h Funding',vol:'Volume',oi:'Open Interest'};
            if(tc===col)t.textContent=(labels[col]||col)+(hlSort.dir<0?' ↓':' ↑');
            else t.textContent=(labels[tc]||t.textContent.replace(/ [↑↓]/,''));
          });
          renderHLTable();
        });
      });
      const hlSearchEl=el('hl-search') as HTMLInputElement|null;
      hlSearchEl?.addEventListener('input',e=>{hlQuery=(e.target as HTMLInputElement).value;renderHLTable();});
    }

    async function fetchFutData(sym: string) {
      const B='/fapi',s=sym+'USDT';
      try {
        const [ticker,oiData,lsRatio,takerRatio,oiHist]=await Promise.all([
          fetch(`${B}/fapi/v1/ticker/24hr?symbol=${s}`).then(r=>r.json()),
          fetch(`${B}/fapi/v1/openInterest?symbol=${s}`).then(r=>r.json()),
          fetch(`${B}/futures/data/globalLongShortAccountRatio?symbol=${s}&period=5m&limit=1`).then(r=>r.json()),
          fetch(`${B}/futures/data/takerlongshortRatio?symbol=${s}&period=5m&limit=1`).then(r=>r.json()),
          fetch(`${B}/futures/data/openInterestHist?symbol=${s}&period=5m&limit=12`).then(r=>r.json()),
        ]);
        return{sym,ticker,oiData,lsRatio,takerRatio,oiHist};
      }catch(e){console.error('futData:',e);return null;}
    }

    function renderLiqMap(data: any) {
      const body=el('liqmap-body');
      if(!body)return;
      if(!data){body.innerHTML='<div class="liq-map-loading">No data</div>';return;}
      const mark=parseFloat(data.ticker.lastPrice)||0;
      const totalOI=parseFloat(data.oiData.openInterest)||0;
      const LEVELS=20,RANGE=0.15,step=(mark*RANGE*2)/LEVELS;
      const levels=[];
      for(let i=0;i<LEVELS;i++){
        const price=mark*(1-RANGE)+i*step,d=Math.abs(price-mark)/mark;
        const weight=Math.exp(-d*12)+Math.exp(-Math.pow(d-0.07,2)*200)*0.6;
        levels.push({price,weight,isLong:price<mark});
      }
      const maxW=Math.max(...levels.map(l=>l.weight)),totalW=levels.reduce((s,l)=>s+l.weight,0);
      const reversed=[...levels].reverse();
      const markIdx=reversed.findIndex(l=>l.price<=mark);
      let html='';
      reversed.forEach((l,i)=>{
        const pct=(l.weight/maxW*100).toFixed(0),oiEst=(totalOI*l.weight/totalW*mark/1e6).toFixed(1);
        const color=l.isLong?'var(--green,#1fa67d)':'var(--red,#ed7088)';
        if(i===markIdx)html+='<div class="liq-mark-line"></div>';
        html+=`<div class="liq-bar-row"><span class="liq-price">${fmtPx(l.price)}</span><div class="liq-bar-wrap"><div class="liq-bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="liq-oi-tag">$${oiEst}M</span></div>`;
      });
      body.innerHTML=html;
    }

    function renderInflow(data: any) {
      const body=el('inflow-body');
      if(!body)return;
      if(!data?.oiHist?.length){body.innerHTML='<div class="liq-map-loading">No data</div>';return;}
      const hist=data.oiHist,px=parseFloat(data.ticker.lastPrice)||0;
      const rows=[...hist].reverse().map((h:any,i:number,arr:any[])=>{
        const oi=parseFloat(h.sumOpenInterest),prev=arr[i+1];
        const delta=prev?oi-parseFloat(prev.sumOpenInterest):0;
        const cls=delta>=0?'up':'dn';
        const time=new Date(h.timestamp).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
        return `<div class="mst-row"><span class="mst-lbl">${time}</span><span class="mst-val">${fmtHL(oi*px)}<span class="${cls}" style="font-size:10px">${delta>=0?'+':''}${fmtHL(Math.abs(delta*px))}</span></span></div>`;
      }).join('');
      body.innerHTML=`<div style="font-size:10px;color:#878c8f;text-transform:uppercase;letter-spacing:.04em;padding:0 0 8px">OI Flow — 5m intervals</div>${rows}`;
    }

    function renderAISignals(data: any) {
      const body=el('ai-body'),verdictEl=el('ai-verdict'),verdictValEl=el('ai-verdict-val'),symLbl=el('ai-sym-lbl');
      if(!body)return;
      if(!data){body.innerHTML='<div style="color:#878c8f;font-size:12px;text-align:center;padding:20px">No data</div>';return;}
      if(symLbl)symLbl.textContent=data.sym;
      const mark=parseFloat(data.ticker.lastPrice)||0,ch24=parseFloat(data.ticker.priceChangePercent)||0;
      const ls=data.lsRatio?.[0],lr=ls?parseFloat(ls.longAccount):0.5,sr=ls?parseFloat(ls.shortAccount):0.5;
      const taker=data.takerRatio?.[0],takerBuy=taker?parseFloat(taker.buyVol)/(parseFloat(taker.sellVol)||1):1;
      const fr=(parseFloat(data.ticker.lastFundingRate||0))*100;
      const hist=data.oiHist||[],oiFirst=hist.length?parseFloat(hist[0].sumOpenInterest):0,oiLast=hist.length?parseFloat(hist[hist.length-1].sumOpenInterest):0;
      const oiTrend=oiFirst?(oiLast-oiFirst)/oiFirst*100:0;
      const signals=[
        {name:'Long/Short Ratio',bull:lr<=0.52,val:`${(lr*100).toFixed(1)}% L / ${(sr*100).toFixed(1)}% S`,body:lr>0.52?'Longs crowded — watch for squeeze':'Shorts heavy — squeeze fuel building'},
        {name:'Taker Flow',bull:takerBuy>=1,val:`Buy ${(takerBuy/(1+takerBuy)*100).toFixed(0)}%`,body:takerBuy>=1?'Takers buying aggressively — bullish':'Takers selling into bids — bearish'},
        {name:'Funding',bull:Math.abs(fr)<0.03,val:`${fr>=0?'+':''}${fr.toFixed(4)}%`,body:Math.abs(fr)<0.03?'Neutral — no leverage extreme':fr>0?'Longs paying — crowded longs':'Shorts paying — bearish excess'},
        {name:'OI Momentum',bull:oiTrend>0,val:`${oiTrend>=0?'+':''}${oiTrend.toFixed(2)}%`,body:oiTrend>0?`OI rising ${oiTrend.toFixed(2)}% — new money in`:`OI falling ${Math.abs(oiTrend).toFixed(2)}% — unwinding`},
        {name:'24h Price',bull:ch24>=0,val:`${ch24>=0?'+':''}${ch24.toFixed(2)}%`,body:ch24>=0?'Bullish trend — continuation bias':'Bearish trend — continuation bias'},
      ];
      const bullCount=signals.filter(s=>s.bull).length;
      const verdict=bullCount>=4?'STRONG BULL':bullCount>=3?'BULL LEAN':bullCount===2?'NEUTRAL':bullCount===1?'BEAR LEAN':'STRONG BEAR';
      const vc=bullCount>=3?'var(--green,#1fa67d)':bullCount===2?'var(--text3,#878c8f)':'var(--red,#ed7088)';
      body.innerHTML=signals.map(s=>`<div class="ai-signal"><div class="ai-sig-hdr"><div class="ai-sig-dot" style="background:${s.bull?'var(--green,#1fa67d)':'var(--red,#ed7088)'}"></div><span class="ai-sig-name">${s.name}</span><span class="ai-sig-val" style="color:${s.bull?'var(--green,#1fa67d)':'var(--red,#ed7088)'}">${s.val}</span></div><div class="ai-sig-body">${s.body}</div></div>`).join('');
      if(verdictEl)verdictEl.style.display='flex';
      if(verdictValEl){verdictValEl.textContent=verdict;verdictValEl.style.color=vc;}
    }

    async function refreshFut() {
      const data=await fetchFutData(futSym);
      futData=data;
      if(futTab==='liqmap')renderLiqMap(data);else renderInflow(data);
      renderAISignals(data);
    }

    function initFut() {
      const pillsEl=el('fut-sym-pills');
      if(pillsEl){
        pillsEl.innerHTML=FUT_SYMS.map(s=>`<button class="sym-pill${s===futSym?' active':''}" data-sym="${s}">${s}</button>`).join('');
        pillsEl.addEventListener('click',e=>{
          const btn=(e.target as Element).closest('.sym-pill') as HTMLElement|null;
          if(!btn)return;
          futSym=btn.dataset.sym||'BTC';
          pillsEl.querySelectorAll('.sym-pill').forEach(b=>b.classList.toggle('active',b===btn));
          refreshFut();
        });
      }
      const tabsEl=el('fut-tabs');
      if(tabsEl){
        tabsEl.addEventListener('click',e=>{
          const btn=(e.target as Element).closest('.fut-tab') as HTMLElement|null;
          if(!btn)return;
          futTab=btn.dataset.tab||'liqmap';
          tabsEl.querySelectorAll('.fut-tab').forEach(b=>b.classList.toggle('active',b===btn));
          const lb=el('liqmap-body'),ib=el('inflow-body');
          if(lb)lb.style.display=futTab==='liqmap'?'':'none';
          if(ib)ib.style.display=futTab==='inflow'?'':'none';
          if(futData){if(futTab==='liqmap')renderLiqMap(futData);else renderInflow(futData);}
        });
      }
      refreshFut();
      setInterval(refreshFut,30_000);
    }

    async function init() {
      buildTicker();
      initHLTable();
      initFut();
      fetchHLPerps();
      fetchTicker();
      await delay(200); fetchGlobal();
      await delay(600); fetchCoins();
      await delay(600); fetchTrending();
      await delay(600); fetchSparklines();
      setInterval(fetchTicker,30_000);
      setInterval(fetchGlobal,120_000);
      setInterval(fetchHLPerps,30_000);
      setInterval(async()=>{await delay(300);fetchCoins();},90_000);
      setInterval(async()=>{await delay(600);fetchTrending();},120_000);
    }

    init();

    import('@/lib/i18n').then(({applyTranslations,setLang,getLang})=>{
      applyTranslations();
      const dd=document.getElementById('langDropdown'),langBtn=document.getElementById('langBtn');
      if(langBtn)langBtn.addEventListener('click',()=>{if(dd)dd.style.display=dd.style.display==='none'?'':'none';});
      dd?.querySelectorAll('.lang-option').forEach(b=>{
        b.addEventListener('click',()=>{setLang((b as HTMLElement).dataset.lang||'');if(dd)dd.style.display='none';updateLH();});
      });
      document.addEventListener('click',e=>{if(!(e.target as Element).closest('.lang-wrap')&&dd)dd.style.display='none';});
      function updateLH(){document.querySelectorAll('.lang-option').forEach(b=>{(b as HTMLElement).style.color=(b as HTMLElement).dataset.lang===getLang()?'var(--accent,#50d2c1)':'';});}
      updateLH();
    });
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: PAGE_CSS}} />

      <nav id="rdo-nav">
        <div className="nav-logo">RDO<span>ONE</span></div>
        <div className="nav-div" />
        <a href="/" data-i18n="trade">Trade</a>
        <a href="/markets" className="active" data-i18n="markets">Markets</a>
        <a href="/news" data-i18n="news">News</a>
        <a href="/portfolio" data-i18n="portfolio">Portfolio</a>
        <a href="/transfer" data-i18n="transfer">Transfer</a>
        <div style={{marginLeft:'auto'}} />
        <div className="lang-wrap">
          <button className="lang-btn" id="langBtn" aria-label="Language">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>
            </svg>
          </button>
          <div className="lang-dropdown" id="langDropdown">
            <button className="lang-option" data-lang="en">English</button>
            <button className="lang-option" data-lang="ru">Русский</button>
            <button className="lang-option" data-lang="zh">中文</button>
          </div>
        </div>
      </nav>

      <div className="ticker-wrap">
        <div className="ticker-track" id="ticker" />
      </div>

      <main>
        <h1 data-i18n="marketOverview">Market Overview</h1>

        <div className="stat-top">
          <div className="big-card">
            <div className="bc-left">
              <div className="bc-val" id="s-mcap">—</div>
              <div className="bc-lbl"><span data-i18n="marketCap">Market Cap</span> <span className="bc-ch" id="s-mcap-ch" /></div>
            </div>
            <div className="bc-spark" id="spark-mcap" />
          </div>
          <div className="big-card">
            <div className="bc-left">
              <div className="bc-val" id="s-vol">—</div>
              <div className="bc-lbl"><span data-i18n="tradingVol24h">24h Trading Volume</span> <span className="bc-ch" id="s-vol-ch" /></div>
            </div>
            <div className="bc-spark" id="spark-vol" />
          </div>
          <div className="small-row">
            <div className="small-card">
              <div className="sc-val" id="s-btc">—</div>
              <div className="sc-lbl" data-i18n="btcDominance">BTC Dominance</div>
            </div>
            <div className="small-card">
              <div className="sc-val" id="s-fg">—</div>
              <div className="sc-lbl" id="s-fg-l" data-i18n="fearGreed">Fear &amp; Greed</div>
            </div>
          </div>
        </div>

        <div className="mkt-stats-wrap">
          <div className="mkt-stats-hdr" data-i18n="marketStats">Market Statistics</div>
          <div id="mkt-stats-body"><div style={{padding:'16px',color:'#878c8f',fontSize:'12px'}}>Loading…</div></div>
        </div>

        <div className="fut-wrap">
          <div className="fut-left">
            <div className="fut-hdr">
              <span className="fut-title">Liquidation Map</span>
              <div className="sym-pills" id="fut-sym-pills" />
              <div className="fut-tabs" id="fut-tabs">
                <button className="fut-tab active" data-tab="liqmap">Liq Map</button>
                <button className="fut-tab" data-tab="inflow">OI Flow</button>
              </div>
            </div>
            <div id="liqmap-body" className="liq-map-body"><div className="liq-map-loading">Loading…</div></div>
            <div id="inflow-body" className="inflow-body" style={{display:'none'}}><div className="liq-map-loading">Loading…</div></div>
          </div>
          <div className="fut-right">
            <div className="fut-hdr">
              <span className="fut-title">AI Signals</span>
              <span style={{fontSize:'10px',color:'#878c8f',marginLeft:'auto'}} id="ai-sym-lbl">BTC</span>
            </div>
            <div className="ai-body" id="ai-body"><div style={{color:'#878c8f',fontSize:'12px',textAlign:'center',padding:'20px'}}>Loading…</div></div>
            <div className="ai-verdict" id="ai-verdict" style={{display:'none'}}>
              <span className="ai-verdict-lbl">AI Signal</span>
              <span className="ai-verdict-val" id="ai-verdict-val">—</span>
            </div>
          </div>
        </div>

        <div className="panels">
          <div className="panel">
            <div className="panel-hdr" data-i18n="trending">Trending</div>
            <div id="trending"><div className="loading-rows">Loading…</div></div>
          </div>
          <div className="panel">
            <div className="panel-hdr" data-i18n="topGainers">Top Gainers (24h)</div>
            <div id="gainers"><div className="loading-rows">Loading…</div></div>
          </div>
        </div>

        <div className="conv-wrap">
          <div className="panel-hdr" data-i18n="converter">Converter</div>
          <div className="conv-body">
            <div className="conv-side">
              <input className="conv-input" type="number" id="cv-amt" defaultValue="1" min="0" />
              <select className="conv-sel" id="cv-from"></select>
            </div>
            <div className="conv-arrow">⇌</div>
            <div className="conv-side">
              <div className="conv-result" id="cv-result">—</div>
              <select className="conv-sel" id="cv-to"></select>
            </div>
          </div>
        </div>

        <div className="hl-wrap">
          <div className="hl-top">
            <div className="hl-search-box">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input className="hl-search" id="hl-search" placeholder="Search" />
            </div>
          </div>
          <table className="hl-tbl">
            <thead>
              <tr>
                <th className="l" data-col="name" data-i18n="market">Market</th>
                <th data-col="px" data-i18n="lastPrice">Last Price</th>
                <th data-col="chg" data-i18n="change24hShort">24h Change</th>
                <th data-col="fund" data-i18n="funding8h">8h Funding</th>
                <th data-col="vol" className="sort-active" data-i18n="volume">Volume ↓</th>
                <th data-col="oi" data-i18n="openInterest">Open Interest</th>
              </tr>
            </thead>
            <tbody id="hl-tbody"><tr><td colSpan={6} style={{textAlign:'center',padding:'20px',color:'#878c8f'}}>Loading…</td></tr></tbody>
          </table>
        </div>

        <div className="tbl-wrap">
          <div className="tbl-hdr">
            <span className="tbl-title" data-i18n="topByMcap">Top 20 by Market Cap</span>
            <span className="tbl-ts" id="tbl-ts">—</span>
          </div>
          <div id="coins-tbl"><div className="loading-rows">Loading market data…</div></div>
        </div>
      </main>
    </>
  );
}
