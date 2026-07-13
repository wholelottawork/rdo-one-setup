'use client';
import { useEffect } from 'react';
import { SiteNav } from '@/components/shared/SiteNav';
import { cachedFetch } from '@/lib/query';

export default function MarketsPage() {
  useEffect(() => {
    const SYMS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','POLUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','TIAUSDT','JUPUSDT','WIFUSDT','BONKUSDT','PEPEUSDT'];
    const LABEL: Record<string,string> = {BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA',AVAXUSDT:'AVAX',LINKUSDT:'LINK',DOTUSDT:'DOT',POLUSDT:'POL',UNIUSDT:'UNI',LTCUSDT:'LTC',ATOMUSDT:'ATOM',NEARUSDT:'NEAR',APTUSDT:'APT',ARBUSDT:'ARB',OPUSDT:'OP',INJUSDT:'INJ',SUIUSDT:'SUI',TIAUSDT:'TIA',JUPUSDT:'JUP',WIFUSDT:'WIF',BONKUSDT:'BONK',PEPEUSDT:'PEPE'};
    const CG_TTL = 70_000;
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

    // Cached via the shared React Query cache (dedupes + persists across
    // client-side navigations within CG_TTL). Only successful, non-error
    // responses get cached — errors reject and fall through to null.
    async function cgFetch(path: string) {
      try {
        return await cachedFetch(['coingecko', path], async () => {
          const res = await fetch('/coingecko' + path);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (data?.status?.error_code) throw new Error('CG error');
          return data;
        }, CG_TTL);
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
        return `<div class="flex justify-between items-center px-3.5 py-2 cursor-pointer hover:bg-[#161616] transition-colors duration-100"><div class="flex items-center gap-2 min-w-0"><div class="w-[18px] h-[18px] rounded-full bg-[#161616] flex items-center justify-center text-[9px] font-bold text-[#878c8f] shrink-0">${i+1}</div><img class="w-[22px] h-[22px] rounded-full object-cover shrink-0" src="${c.small||c.thumb}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div><div class="text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis">${c.name}</div><div class="text-[10px] text-[#878c8f]">${c.symbol.toUpperCase()}</div></div></div><div class="flex flex-col items-end shrink-0 gap-0.5">${px>0?`<div class="text-[11px] [font-variant-numeric:tabular-nums]">${fmtPx(px)}</div>`:''}<div class="text-[11px] font-semibold [font-variant-numeric:tabular-nums] ${pCls(ch)}">${fmtPct(ch)}</div></div></div>`;
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
        return `<div class="flex justify-between items-center px-3.5 py-2 cursor-pointer hover:bg-[#161616] transition-colors duration-100"><div class="flex items-center gap-2 min-w-0"><img class="w-[22px] h-[22px] rounded-full object-cover shrink-0" src="${c.image}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div><div class="text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis">${c.name}</div><div class="text-[10px] text-[#878c8f]">${c.symbol.toUpperCase()}</div></div></div><div class="flex flex-col items-end shrink-0 gap-0.5"><div class="text-[11px] [font-variant-numeric:tabular-nums]">${fmtPx(c.current_price)}</div><div class="text-[11px] font-semibold [font-variant-numeric:tabular-nums] up">${fmtPct(ch)}</div></div></div>`;
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
      coinsEl.innerHTML=`<table class="w-full border-collapse"><thead><tr><th class="text-left px-[10px] py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f]" style="width:32px">#</th><th class="text-left px-[10px] py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f]">Name</th><th class="text-right px-[10px] py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f]">Price</th><th class="text-right px-[10px] py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f]">24h %</th><th class="text-right px-[10px] py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f]">7d %</th><th class="text-right px-[10px] py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f]">Market Cap</th><th class="text-right px-[10px] py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f]">Volume (24h)</th></tr></thead><tbody>${coins.map((c:any)=>{
        const ch24=c.price_change_percentage_24h??0,ch7d=c.price_change_percentage_7d_in_currency??0;
        return `<tr class="cursor-pointer hover:bg-[#161616] transition-colors duration-100"><td class="px-[10px] py-[9px] border-t border-[#1f1f1f] text-[#878c8f] text-[11px]">${c.market_cap_rank}</td><td class="px-[10px] py-[9px] border-t border-[#1f1f1f]"><div class="flex items-center gap-2"><img src="${c.image}" alt="" width="22" height="22" style="border-radius:50%;object-fit:cover;flex-shrink:0" loading="lazy" onerror="this.style.visibility='hidden'"><div><div class="text-xs font-semibold">${c.name}</div><div class="text-[10px] text-[#878c8f]">${c.symbol.toUpperCase()}</div></div></div></td><td class="text-right px-[10px] py-[9px] border-t border-[#1f1f1f] text-xs font-semibold [font-variant-numeric:tabular-nums]">${fmtPx(c.current_price)}</td><td class="text-right px-[10px] py-[9px] border-t border-[#1f1f1f] text-[11px] [font-variant-numeric:tabular-nums] text-[#c8d2d6]"><span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold [font-variant-numeric:tabular-nums] ${pCls(ch24)==='up'?'bg-[rgba(31,166,125,0.15)] text-[#1fa67d]':'bg-[rgba(237,112,136,0.15)] text-[#ed7088]'}">${ch24>=0?'▲':'▼'} ${Math.abs(ch24).toFixed(2)}%</span></td><td class="text-right px-[10px] py-[9px] border-t border-[#1f1f1f] text-[11px] [font-variant-numeric:tabular-nums] text-[#c8d2d6]"><span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold [font-variant-numeric:tabular-nums] ${pCls(ch7d)==='up'?'bg-[rgba(31,166,125,0.15)] text-[#1fa67d]':'bg-[rgba(237,112,136,0.15)] text-[#ed7088]'}">${ch7d>=0?'▲':'▼'} ${Math.abs(ch7d).toFixed(2)}%</span></td><td class="text-right px-[10px] py-[9px] border-t border-[#1f1f1f] text-[11px] [font-variant-numeric:tabular-nums] text-[#c8d2d6]">${fmtLarge(c.market_cap)}</td><td class="text-right px-[10px] py-[9px] border-t border-[#1f1f1f] text-[11px] [font-variant-numeric:tabular-nums] text-[#c8d2d6]">${fmtLarge(c.total_volume)}</td></tr>`;
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
        return `<tr class="cursor-pointer hover:bg-[#161616] transition-colors duration-100" onclick="location.href='/?sym=${encodeURIComponent(d.name)}'"><td class="px-3 py-[9px] border-t border-[rgba(255,255,255,0.04)] text-xs [font-variant-numeric:tabular-nums] text-right whitespace-nowrap"><div class="flex items-center gap-2 text-left"><span class="text-[#878c8f] text-[13px] cursor-pointer shrink-0 hover:text-[#f5c518]">☆</span><span class="text-xs font-semibold text-white">${d.name}-USDC</span><span class="text-[10px] font-semibold text-[#878c8f] bg-[#161616] px-1 py-px rounded-[3px] shrink-0">${d.maxLev}x</span></div></td><td class="px-3 py-[9px] border-t border-[rgba(255,255,255,0.04)] text-xs [font-variant-numeric:tabular-nums] text-right whitespace-nowrap">${fmtHLPx(d.px)}</td><td class="px-3 py-[9px] border-t border-[rgba(255,255,255,0.04)] text-xs [font-variant-numeric:tabular-nums] text-right whitespace-nowrap font-semibold ${chgCls}">${chgSign}${d.chgAbs.toFixed(d.px>=100?2:4)} / ${chgSign}${d.chgPct.toFixed(2)}%</td><td class="px-3 py-[9px] border-t border-[rgba(255,255,255,0.04)] text-xs [font-variant-numeric:tabular-nums] text-right whitespace-nowrap ${fundCls}">${d.fund8h>=0?'+':''}${d.fund8h.toFixed(4)}%</td><td class="px-3 py-[9px] border-t border-[rgba(255,255,255,0.04)] text-xs [font-variant-numeric:tabular-nums] text-right whitespace-nowrap">${fmtHL(d.vol)}</td><td class="px-3 py-[9px] border-t border-[rgba(255,255,255,0.04)] text-xs [font-variant-numeric:tabular-nums] text-right whitespace-nowrap">${fmtHL(d.oi)}</td></tr>`;
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
            if (tc === col) {
              t.classList.add('text-[#50d2c1]');
              t.classList.remove('text-[#878c8f]');
            } else {
              t.classList.remove('text-[#50d2c1]');
              t.classList.add('text-[#878c8f]');
            }
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
      if(!data){body.innerHTML='<div class="flex items-center justify-center h-full text-[#878c8f] text-xs">No data</div>';return;}
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
        if(i===markIdx)html+='<div class="border-t border-dashed border-[#50d2c1] my-0.5 shrink-0"></div>';
        html+=`<div class="flex items-center gap-1.5 h-4 shrink-0"><span class="text-[9px] text-[#878c8f] min-w-[64px] text-right shrink-0 [font-variant-numeric:tabular-nums]">${fmtPx(l.price)}</span><div class="flex-1 h-[7px] bg-[rgba(255,255,255,0.04)] rounded-[2px] overflow-hidden"><div class="h-full rounded-[2px]" style="width:${pct}%;background:${color}"></div></div><span class="text-[9px] text-[#878c8f] min-w-[44px] text-right shrink-0 [font-variant-numeric:tabular-nums]">$${oiEst}M</span></div>`;
      });
      body.innerHTML=html;
    }

    function renderInflow(data: any) {
      const body=el('inflow-body');
      if(!body)return;
      if(!data?.oiHist?.length){body.innerHTML='<div class="flex items-center justify-center h-full text-[#878c8f] text-xs">No data</div>';return;}
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
      body.innerHTML=signals.map(s=>`<div class="bg-[#161616] rounded-md px-2.5 py-2 shrink-0"><div class="flex items-center gap-1.5 mb-0.5"><div class="w-[7px] h-[7px] rounded-full shrink-0" style="background:${s.bull?'var(--green,#1fa67d)':'var(--red,#ed7088)'}"></div><span class="text-[11px] font-semibold text-white">${s.name}</span><span class="text-[11px] font-bold ml-auto [font-variant-numeric:tabular-nums]" style="color:${s.bull?'var(--green,#1fa67d)':'var(--red,#ed7088)'}">${s.val}</span></div><div class="text-[10px] text-[#878c8f] leading-[1.4]">${s.body}</div></div>`).join('');
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

    import('@/lib/i18n').then(({applyTranslations})=>{
      applyTranslations();
    });
  }, []);

  return (
    <>
      <SiteNav activePage="markets" />

      <div className="ticker-wrap">
        <div className="ticker-track" id="ticker" />
      </div>

      <main className="max-w-[1440px] mx-auto px-6 pb-10 pt-12">
        <h1 className="text-lg font-bold tracking-[-0.03em] mb-4" data-i18n="marketOverview">Market Overview</h1>

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
          <div id="mkt-stats-body"><div className="p-4 text-[#878c8f] text-xs">Loading…</div></div>
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
            <div id="liqmap-body" className="px-3.5 py-3 h-[280px] flex flex-col gap-[3px] overflow-hidden">
              <div className="flex items-center justify-center h-full text-[#878c8f] text-xs">Loading…</div>
            </div>
            <div id="inflow-body" className="px-3.5 py-3 h-[280px] overflow-y-auto" style={{display:'none'}}>
              <div className="flex items-center justify-center h-full text-[#878c8f] text-xs">Loading…</div>
            </div>
          </div>
          <div className="fut-right">
            <div className="fut-hdr">
              <span className="fut-title">AI Signals</span>
              <span className="text-[10px] text-[#878c8f] ml-auto" id="ai-sym-lbl">BTC</span>
            </div>
            <div className="px-3 py-2.5 flex flex-col gap-1.5 flex-1 overflow-y-auto" id="ai-body">
              <div className="text-[#878c8f] text-xs text-center p-5">Loading…</div>
            </div>
            <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-[#1f1f1f] shrink-0" id="ai-verdict" style={{display:'none'}}>
              <span className="text-[11px] text-[#878c8f]">AI Signal</span>
              <span className="text-[13px] font-bold tracking-[0.02em]" id="ai-verdict-val">—</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-4 max-[640px]:grid-cols-1">
          <div className="bg-[#0d0d0d] border border-[#1f1f1f] rounded-md overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-[#1f1f1f] text-[11px] font-semibold uppercase tracking-[0.04em] text-[#878c8f]" data-i18n="trending">Trending</div>
            <div id="trending"><div className="p-5 text-center text-[#878c8f] text-xs">Loading…</div></div>
          </div>
          <div className="bg-[#0d0d0d] border border-[#1f1f1f] rounded-md overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-[#1f1f1f] text-[11px] font-semibold uppercase tracking-[0.04em] text-[#878c8f]" data-i18n="topGainers">Top Gainers (24h)</div>
            <div id="gainers"><div className="p-5 text-center text-[#878c8f] text-xs">Loading…</div></div>
          </div>
        </div>

        <div className="conv-wrap">
          <div className="px-3.5 py-2.5 border-b border-[#1f1f1f] text-[11px] font-semibold uppercase tracking-[0.04em] text-[#878c8f]" data-i18n="converter">Converter</div>
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

        <div className="bg-[#0d0d0d] border border-[#1f1f1f] rounded-md overflow-hidden mb-4">
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[#1f1f1f]">
            <div className="flex items-center gap-2 bg-[#161616] border border-[#1f1f1f] rounded-md px-2.5 py-1.5 flex-1 max-w-[320px]">
              <svg className="shrink-0 opacity-50" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input className="bg-transparent border-none outline-none text-white text-xs font-[inherit] w-full placeholder:text-[#878c8f]" id="hl-search" placeholder="Search" />
            </div>
          </div>
          <table className="hl-tbl w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f] cursor-pointer select-none hover:text-white" data-col="name" data-i18n="market">Market</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f] cursor-pointer select-none hover:text-white" data-col="px" data-i18n="lastPrice">Last Price</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f] cursor-pointer select-none hover:text-white" data-col="chg" data-i18n="change24hShort">24h Change</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f] cursor-pointer select-none hover:text-white" data-col="fund" data-i18n="funding8h">8h Funding</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#50d2c1] whitespace-nowrap border-b border-[#1f1f1f] cursor-pointer select-none hover:text-white" data-col="vol" data-i18n="volume">Volume ↓</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#878c8f] whitespace-nowrap border-b border-[#1f1f1f] cursor-pointer select-none hover:text-white" data-col="oi" data-i18n="openInterest">Open Interest</th>
              </tr>
            </thead>
            <tbody id="hl-tbody"><tr><td colSpan={6} className="text-center p-5 text-[#878c8f]">Loading…</td></tr></tbody>
          </table>
        </div>

        <div className="bg-[#0d0d0d] border border-[#1f1f1f] rounded-md overflow-hidden mb-4">
          <div className="flex justify-between items-center px-3.5 py-2.5 border-b border-[#1f1f1f]">
            <span className="text-[13px] font-semibold" data-i18n="topByMcap">Top 20 by Market Cap</span>
            <span className="text-[11px] text-[#878c8f]" id="tbl-ts">—</span>
          </div>
          <div id="coins-tbl"><div className="p-5 text-center text-[#878c8f] text-xs">Loading market data…</div></div>
        </div>
      </main>
    </>
  );
}
