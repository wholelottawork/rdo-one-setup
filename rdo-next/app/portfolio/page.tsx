'use client';
import { useEffect } from 'react';
import { ensureAsterAgentApproved, ensureBscNetwork, getAsterIncomeHistory } from '@/lib/aster-agent';

const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#000000;--bg2:#0d0d0d;--bg3:#161616;--border:#1f1f1f;--accent:#50d2c1;--green:#1fa67d;--red:#ed7088;--text:#ffffff;--text2:#c8d2d6;--text3:#878c8f;--r:6px;--nav:40px}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5;min-height:100vh}
a{text-decoration:none;color:inherit}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--bg3);border-radius:3px}
#rdo-nav{position:fixed;top:0;left:0;right:0;height:var(--nav);min-height:var(--nav);max-height:var(--nav);overflow:hidden;background:var(--bg);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;padding:0 24px;z-index:1000}
.nav-logo{font-size:13px;font-weight:800;letter-spacing:.5px;color:#f5f1ea;flex-shrink:0}
.nav-logo span{color:var(--accent)}
.nav-div{width:1px;height:18px;background:var(--border);margin:0 4px;flex-shrink:0}
#rdo-nav a{font-size:12px;font-weight:500;color:var(--text3);padding:5px 12px;border-radius:7px;transition:color .12s,background .12s;flex-shrink:0}
#rdo-nav a:hover{color:var(--text);background:#1a1a1a}
#rdo-nav a.active{color:var(--text);background:#1f1f1f;font-weight:600}
main{max-width:1400px;margin:0 auto;padding:0 24px 60px;padding-top:calc(var(--nav) + 8px)}
.section-divider{display:flex;align-items:center;gap:12px;margin:28px 0 20px}
.section-divider span{font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;white-space:nowrap}
.section-divider::before,.section-divider::after{content:'';flex:1;height:1px;background:var(--border)}
#connect-screen{display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;padding:32px 20px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)}
.phantom-logo{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#534bb1,#551bf9);display:flex;align-items:center;justify-content:center}
.phantom-logo svg{width:36px;height:36px}
.connect-title{font-size:16px;font-weight:700}
.connect-sub{font-size:12px;color:var(--text3);max-width:280px}
.connect-btn{display:inline-flex;align-items:center;gap:7px;background:#ab9ff2;color:#1a1044;font-weight:700;font-size:12px;padding:9px 22px;border-radius:var(--r);cursor:pointer;border:none;font-family:inherit;transition:opacity .15s}
.connect-btn:hover{opacity:.9}
.connect-btn:disabled{opacity:.5;cursor:not-allowed}
.install-hint{font-size:11px;color:var(--text3);display:none}
.install-hint a{color:var(--accent)}
#portfolio-screen{display:none}
.pf-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap}
.addr-row{display:flex;align-items:center;gap:8px}
.addr-chip{font-size:11px;font-weight:600;font-family:monospace;color:var(--text2);background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:4px 12px;cursor:pointer;transition:border-color .12s,color .12s}
.addr-chip:hover{border-color:var(--accent);color:var(--accent)}
.disc-btn{font-size:11px;color:var(--text3);background:transparent;border:none;cursor:pointer;font-family:inherit;padding:3px 8px;border-radius:3px;transition:color .12s,background .12s}
.disc-btn:hover{color:var(--red);background:rgba(237,112,136,.08)}
.refresh-btn{font-size:11px;font-weight:600;color:var(--text3);background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:5px 12px;cursor:pointer;font-family:inherit;transition:color .12s,border-color .12s}
.refresh-btn:hover{color:var(--accent);border-color:var(--accent)}
.total-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:20px 22px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.total-lbl{font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px}
.total-val{font-size:28px;font-weight:700;letter-spacing:-.03em}
.total-sub{font-size:11px;color:var(--text3);margin-top:2px}
.action-bar{display:flex;gap:8px;flex-wrap:wrap}
.act-btn{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:8px 18px;border-radius:var(--r);cursor:pointer;border:1px solid transparent;font-family:inherit;transition:all .15s;white-space:nowrap}
.act-btn.fill{background:var(--accent);color:#0f1a1e;border-color:var(--accent)}
.act-btn.fill:hover{opacity:.88}
.act-btn.outline{background:transparent;color:var(--text2);border-color:var(--border)}
.act-btn.outline:hover{border-color:var(--accent);color:var(--accent)}
.assets-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.assets-hdr{display:grid;grid-template-columns:1fr 110px 110px 110px;padding:9px 16px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em}
.assets-hdr span:not(:first-child){text-align:right}
.asset-row{display:grid;grid-template-columns:1fr 110px 110px 110px;padding:11px 16px;border-bottom:1px solid var(--border);align-items:center;transition:background .1s}
.asset-row:last-child{border-bottom:none}
.asset-row:hover{background:rgba(255,255,255,.025)}
.asset-left{display:flex;align-items:center;gap:10px;min-width:0}
.token-icon{width:30px;height:30px;border-radius:50%;background:var(--bg3);object-fit:cover;flex-shrink:0}
.token-icon-ph{width:30px;height:30px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--text2);flex-shrink:0}
.token-name{font-size:12px;font-weight:600}
.token-sym{font-size:10px;color:var(--text3);margin-top:1px}
.cell{text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--text2)}
.cell.val{color:var(--text);font-weight:600}
.empty-assets{padding:40px 24px;text-align:center;color:var(--text3);font-size:12px}
.sk{background:var(--bg3);border-radius:3px;animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.hl-connect-bar{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.hl-addr-input{flex:1;min-width:240px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:7px 12px;font-size:12px;font-family:monospace;color:var(--text);outline:none;transition:border-color .12s}
.hl-addr-input:focus{border-color:var(--accent)}
.hl-addr-input::placeholder{color:var(--text3);font-family:'Inter',sans-serif}
.hl-load-btn{font-size:12px;font-weight:600;color:#0f1a1e;background:var(--accent);border:none;border-radius:4px;padding:7px 16px;cursor:pointer;font-family:inherit;transition:opacity .15s;white-space:nowrap}
.hl-load-btn:hover{opacity:.88}
.hl-evm-btn{font-size:12px;font-weight:600;color:var(--text2);background:transparent;border:1px solid var(--border);border-radius:4px;padding:7px 14px;cursor:pointer;font-family:inherit;transition:all .15s;display:flex;align-items:center;gap:6px;white-space:nowrap}
.hl-evm-btn:hover{border-color:var(--accent);color:var(--accent)}
.pnl-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.pnl-title{font-size:18px;font-weight:800;letter-spacing:.5px;color:var(--text)}
.pnl-addr-sub{font-size:11px;color:var(--text3);margin-top:2px}
.pnl-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pnl-cal-btn{padding:6px 14px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--text3);font-size:10px;font-weight:700;letter-spacing:.08em;cursor:pointer;font-family:inherit;transition:all .12s}
.pnl-cal-btn:hover{border-color:var(--accent);color:var(--accent)}
.range-tabs{display:flex;gap:4px}
.range-tab{padding:5px 12px;background:transparent;border:1px solid transparent;border-radius:3px;color:var(--text3);font-size:10px;font-weight:700;letter-spacing:.05em;cursor:pointer;font-family:inherit;transition:all .12s}
.range-tab:hover{color:var(--text2)}
.range-tab.active{background:var(--bg2);border-color:var(--border);color:var(--text)}
.pnl-layout{display:flex;gap:22px;align-items:flex-start}
.pnl-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px}
.pnl-sidebar{width:280px;flex-shrink:0;position:sticky;top:calc(var(--nav) + 16px)}
@media(max-width:900px){.pnl-layout{flex-direction:column}.pnl-sidebar{width:100%;position:static}}
.pnl-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
@media(max-width:1100px){.pnl-stats{grid-template-columns:repeat(3,1fr)}}
@media(max-width:600px){.pnl-stats{grid-template-columns:repeat(2,1fr)}}
.stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px}
.stat-lbl{font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.stat-val{font-size:20px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat-sub{font-size:9.5px;color:var(--text3);margin-top:3px}
.stat-val.pos{color:var(--green)}
.stat-val.neg{color:var(--red)}
.charts-row{display:flex;gap:14px}
.chart-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px}
.chart-card.cum{flex:1.4}
.chart-card.dist{flex:1;min-width:0}
.chart-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.chart-title{font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.1em}
.chart-total{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
#pnl-chart-svg{width:100%;height:200px;display:block}
.dist-bars{display:flex;flex-direction:column;gap:7px;margin-top:4px}
.dist-row{display:flex;flex-direction:column;gap:3px}
.dist-meta{display:flex;justify-content:space-between;font-size:10px}
.dist-label{color:var(--text2)}
.dist-count{color:var(--text3)}
.dist-track{height:5px;background:var(--bg3);border-radius:3px;overflow:hidden}
.dist-bar{height:100%;border-radius:3px;transition:width .3s}
.share-card{background:linear-gradient(160deg,#162025 0%,#0f1a1e 65%);border:1px solid rgba(80,210,193,.2);border-radius:8px;padding:20px;display:flex;flex-direction:column;gap:14px;position:relative;overflow:hidden}
.share-card::before{content:'';position:absolute;top:-50px;right:-50px;width:150px;height:150px;border-radius:50%;background:var(--accent);opacity:.07;pointer-events:none}
.share-brand{display:flex;align-items:center;gap:7px}
.share-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 2s ease-in-out infinite}
.share-logo{font-size:12px;font-weight:800;letter-spacing:2px;color:#fff}
.share-logo span{color:var(--accent)}
.share-addr{font-size:9px;color:var(--text3);letter-spacing:.05em;margin-bottom:4px;font-family:monospace}
.share-pnl{font-size:26px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.share-pnl-sub{font-size:9px;color:var(--text3);letter-spacing:.08em;margin-top:2px}
#share-spark-svg{width:100%;height:44px;display:block;margin:2px 0}
.share-stats{display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,.07);padding-top:12px}
.share-stat-lbl{font-size:8.5px;color:var(--text3);letter-spacing:.08em;margin-bottom:3px;text-transform:uppercase}
.share-stat-val{font-size:14px;font-weight:700}
.share-actions{display:flex;gap:8px}
.share-btn{flex:1;padding:10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.1em;cursor:pointer;font-family:inherit;border:none;transition:opacity .15s}
.share-btn.primary{background:var(--accent);color:#0f1a1e}
.share-btn.secondary{background:transparent;border:1px solid rgba(255,255,255,.12);color:var(--text2)}
.share-btn:hover{opacity:.82}
.share-placeholder{color:var(--text3);font-size:11px;line-height:1.7;text-align:center;padding:20px 0}
.trades-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.trades-title{padding:12px 16px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;justify-content:space-between}
.trades-grid{display:grid;grid-template-columns:90px 64px 88px 88px 70px 90px 72px 88px;font-size:10px}
@media(max-width:1100px){.trades-grid{grid-template-columns:80px 60px 80px 80px 60px 84px 60px 80px}}
.trades-hdr{padding:7px 14px;border-bottom:1px solid var(--border);font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em}
.trades-hdr>*:not(:first-child){text-align:right}
.trade-row{padding:10px 14px;border-bottom:1px solid var(--border);align-items:center;transition:background .1s}
.trade-row:last-child{border-bottom:none}
.trade-row:hover{background:rgba(255,255,255,.02)}
.trade-row>*:not(:first-child){text-align:right}
.trade-coin{font-size:12px;font-weight:700;color:var(--text)}
.trade-dir{display:inline-block;font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;white-space:nowrap}
.trade-dir.long{background:rgba(31,166,125,.15);color:var(--green)}
.trade-dir.short{background:rgba(237,112,136,.15);color:var(--red)}
.trade-cell{font-size:11px;color:var(--text2);font-variant-numeric:tabular-nums}
.trade-pnl{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.trade-pnl.pos{color:var(--green)}
.trade-pnl.neg{color:var(--red)}
.hl-placeholder{padding:40px 24px;text-align:center;color:var(--text3);font-size:12px;line-height:1.7}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
.overlay.open{display:flex}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:10px;width:100%;max-width:460px;display:flex;flex-direction:column;overflow:hidden;max-height:90vh}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.modal-title{font-size:14px;font-weight:700}
.modal-x{background:none;border:none;color:var(--text3);font-size:20px;line-height:1;cursor:pointer;padding:2px 4px;transition:color .12s}
.modal-x:hover{color:var(--text)}
.modal-body{padding:20px;overflow-y:auto;flex:1}
.lifi-frame{width:100%;height:560px;border:none;border-radius:var(--r);display:block;background:var(--bg)}
.xfer-box{background:var(--bg3);border-radius:12px;padding:14px 16px;margin-bottom:1px}
.xfer-label{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px}
.xfer-bal-hint{font-size:11px;font-weight:500;color:var(--text3);text-transform:none;letter-spacing:0;display:flex;align-items:center;gap:4px}
.xfer-max-btn{font-size:10px;font-weight:700;color:var(--accent);background:transparent;border:none;cursor:pointer;font-family:inherit;padding:0;text-transform:uppercase}
.xfer-row{display:flex;align-items:center;gap:10px}
.xfer-token-btn{display:flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;padding:6px 10px 6px 6px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;color:var(--text);transition:border-color .12s;white-space:nowrap;flex-shrink:0}
.xfer-token-btn:hover{border-color:var(--accent)}
.xfer-tok-icon{width:24px;height:24px;border-radius:50%;object-fit:cover;display:block}
.xfer-tok-ph{width:24px;height:24px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--text2)}
.xfer-amount-wrap{flex:1;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.xfer-amount-input{width:100%;background:transparent;border:none;outline:none;font-family:inherit;font-size:22px;font-weight:700;color:var(--text);text-align:right}
.xfer-amount-input::placeholder{color:var(--text3)}
.xfer-amount-usd{font-size:11px;color:var(--text3)}
.xfer-arrow-row{display:flex;justify-content:center;align-items:center;height:26px;position:relative;z-index:1;margin:0}
.xfer-arrow-circle{width:26px;height:26px;border-radius:50%;background:var(--bg2);border:2px solid var(--bg3);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text3)}
.xfer-to-row{display:flex;align-items:center;gap:12px}
.xfer-to-icon{width:36px;height:36px;border-radius:50%;object-fit:cover}
.xfer-to-name{font-size:14px;font-weight:700}
.xfer-to-sub{font-size:11px;color:var(--text3);margin-top:1px}
.xfer-to-right{margin-left:auto;text-align:right}
.xfer-to-val{font-size:20px;font-weight:700}
.xfer-to-usd{font-size:11px;color:var(--text3)}
.xfer-go-btn{width:100%;padding:13px;background:#9b7fee;color:#fff;font-weight:700;font-size:14px;border-radius:12px;border:none;cursor:pointer;font-family:inherit;margin-top:12px;transition:opacity .15s}
.xfer-go-btn:hover{opacity:.88}
.xfer-go-btn:disabled{opacity:.4;cursor:not-allowed}
.dep-tok-list{background:var(--bg2);border:1px solid var(--border);border-radius:8px;margin:4px 0 0;max-height:220px;overflow-y:auto}
.dep-tok-item{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background .1s;border-bottom:1px solid rgba(39,48,53,.5)}
.dep-tok-item:last-child{border-bottom:none}
.dep-tok-item:hover{background:var(--bg3)}
.dep-tok-item-icon{width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0}
.dep-tok-item-ph{width:32px;height:32px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--text2);flex-shrink:0}
.dep-tok-info{flex:1;min-width:0}
.dep-tok-sym{font-size:13px;font-weight:700}
.dep-tok-name{font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dep-tok-right{text-align:right;flex-shrink:0}
.dep-tok-bal{font-size:12px;font-weight:600}
.dep-tok-usd{font-size:11px;color:var(--text3)}
.cal-overlay{display:none;position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);align-items:center;justify-content:center;padding:20px}
.cal-overlay.open{display:flex}
.cal-modal{width:860px;max-width:96vw;max-height:90vh;overflow-y:auto;background:#111820;border:1px solid rgba(255,255,255,.09);border-radius:8px;padding:24px 28px;display:flex;flex-direction:column;gap:18px}
.cal-modal-hdr{display:flex;align-items:center;justify-content:space-between}
.cal-modal-title{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:800;letter-spacing:1px;color:var(--text)}
.cal-modal-nav{display:flex;align-items:center;gap:12px}
.cal-nav-btn{background:transparent;border:1px solid rgba(255,255,255,.12);border-radius:4px;color:var(--text3);width:26px;height:26px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .12s}
.cal-nav-btn:hover{border-color:var(--accent);color:var(--accent)}
.cal-month-lbl{font-size:12px;color:var(--text2);letter-spacing:.5px;min-width:120px;text-align:center}
.cal-close-btn{background:transparent;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:0 0 0 8px;transition:color .12s}
.cal-close-btn:hover{color:var(--text)}
.cal-summary{display:flex;flex-direction:column;gap:6px}
.cal-total{font-size:28px;font-weight:800;font-variant-numeric:tabular-nums}
.cal-bar-track{height:3px;background:var(--bg3);border-radius:2px;overflow:hidden;margin-top:4px}
.cal-bar-fill{height:100%;border-radius:2px}
.cal-winloss{display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;margin-top:4px}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.cal-day-hdr{font-size:9.5px;color:var(--text3);text-align:center;padding:3px 0;text-transform:uppercase;letter-spacing:.08em}
.cal-day{min-height:58px;border-radius:5px;display:flex;flex-direction:column;justify-content:space-between;padding:7px;position:relative}
.cal-day.empty{background:transparent}
.cal-day.today{border:1px solid var(--accent)}
.cal-day.pos{background:rgba(31,166,125,.14)}
.cal-day.neg{background:rgba(237,112,136,.13)}
.cal-day.zero{background:var(--bg2)}
.cal-day.empty-bg{background:var(--bg2);opacity:.3}
.cal-day-num{font-size:10px;color:var(--text3);font-weight:500}
.cal-day-pnl{font-size:9px;font-weight:700}
.cal-day.pos .cal-day-pnl{color:var(--green)}
.cal-day.neg .cal-day-pnl{color:var(--red)}
.cal-day.zero .cal-day-pnl{color:var(--text3)}
.cal-footer{display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:12px;font-size:10.5px;color:var(--text3)}
.cal-footer strong{color:var(--text2)}
.perps-val-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:18px;margin-top:14px;display:flex;flex-direction:column;gap:10px}
.perps-val-hdr{display:flex;align-items:center;justify-content:space-between}
.perps-val-title{font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.1em}
.perps-val-live{display:flex;align-items:center;gap:5px;font-size:9px;font-weight:700;color:var(--text3);letter-spacing:.08em}
.perps-val-eq{font-size:26px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.perps-val-sub{font-size:11px;color:var(--text3)}
.perps-val-sub span{font-weight:600}
.perps-val-rows{display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--border);padding-top:10px;margin-top:2px}
.perps-val-row{display:flex;justify-content:space-between;font-size:11px}
.perps-val-row span:first-child{color:var(--text3)}
.perps-val-row span:last-child{font-weight:600;font-variant-numeric:tabular-nums}
.perps-val-pos-hdr{font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.pv-pos-row{display:flex;justify-content:space-between;align-items:center;font-size:10px;padding:5px 0;border-bottom:1px solid var(--border)}
.pv-pos-row:last-child{border-bottom:none}
.pv-pos-coin{font-weight:700;color:var(--text)}
.pv-pos-dir{font-size:9px;font-weight:600;padding:1px 5px;border-radius:3px;margin-left:5px}
.pv-pos-dir.long{background:rgba(31,166,125,.15);color:var(--green)}
.pv-pos-dir.short{background:rgba(237,112,136,.15);color:var(--red)}
.pv-pos-pnl{font-weight:700;font-variant-numeric:tabular-nums}
.perps-val-placeholder{font-size:11px;color:var(--text3);text-align:center;padding:10px 0;line-height:1.6}
.perps-dep-btn{width:100%;padding:10px;background:var(--accent);color:#0f1a1e;font-weight:700;font-size:12px;border-radius:var(--r);border:none;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;transition:opacity .15s;margin-top:4px}
.perps-dep-btn:hover{opacity:.88}
.mode-switch-wrap{position:relative;display:flex;align-items:center;gap:10px;flex-shrink:0}
.mode-switch{display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--border);background:var(--bg2)}
.mode-btn{padding:4px 12px;font-size:11px;font-weight:700;letter-spacing:.04em;border:none;background:transparent;color:var(--text3);cursor:pointer;font-family:inherit;transition:all .15s}
.mode-btn.active{background:var(--bg3);color:var(--text)}
.mode-btn.mode-hl.active{color:var(--accent)}
.mode-btn.mode-aster.active{color:#f59e0b}
.aster-load-btn{font-size:12px;font-weight:600;color:#1a1044;background:#f59e0b;border:none;border-radius:4px;padding:7px 16px;cursor:pointer;font-family:inherit;transition:opacity .15s;white-space:nowrap}
.aster-load-btn:hover{opacity:.88}
.evm-bal-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin-top:12px;display:none}
.evm-bal-card.visible{display:block}
.evm-bal-hdr{font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.evm-bal-chain{font-size:9px;font-weight:600;color:var(--accent);background:rgba(80,210,193,.08);padding:2px 6px;border-radius:3px}
.evm-bal-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)}
.evm-bal-row:last-child{border-bottom:none}
.evm-bal-left{display:flex;align-items:center;gap:8px}
.evm-tok-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.evm-bal-sym{font-size:12px;font-weight:600}
.evm-bal-name{font-size:10px;color:var(--text3)}
.evm-bal-right{text-align:right}
.evm-bal-amount{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.evm-bal-usd{font-size:10px;color:var(--text3)}
`;

export default function PortfolioPage() {
  useEffect(() => {
    const SOL_MINT   = 'So11111111111111111111111111111111111111112';
    const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const SOL_RPC    = 'https://api.mainnet-beta.solana.com';
    const HL_API     = '/hl/info';
    const ARB_RPC    = 'https://arb1.arbitrum.io/rpc';
    const USDC_ARB   = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

    let pubkey: string | null = null;
    let tokenMeta: Record<string, any> = {};
    let evmAddr: string | null = null;
    let walletAssets: any[] = [];
    let depToken: any = null;
    let depTokListOpen = false;
    let hlFills: any[] = [];
    let hlDailyPnl: Record<string, number> = {};
    let currentRange = 'ALL';
    let calYear = new Date().getFullYear();
    let calMonth = new Date().getMonth();
    let shareData: any = null;
    let portfolioMode = 'hl';
    let asterFills: any[] = [];

    const el = (id: string) => document.getElementById(id);
    const set = (id: string, v: string) => { const e = el(id); if (e) e.textContent = v; };
    const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const fmtUSD = (n: number) => '$' + fmt(n, n >= 1 ? 2 : 6);
    const fmtK = (n: number) => n >= 1e6 ? '$'+fmt(n/1e6,2)+'M' : n >= 1e3 ? '$'+fmt(n/1e3,1)+'K' : '$'+fmt(n);
    const shorten = (a: string) => a.slice(0,6)+'…'+a.slice(-4);
    const pCls = (v: number) => v > 0 ? 'pos' : v < 0 ? 'neg' : '';

    function rangeStartMs(range: string) {
      const now = Date.now();
      if (range === '7D')  return now - 7  * 86400000;
      if (range === '30D') return now - 30 * 86400000;
      if (range === '90D') return now - 90 * 86400000;
      return 0;
    }

    function phantom() { return (window as any)?.phantom?.solana ?? (window as any)?.solana ?? null; }

    async function connectWallet() {
      const p = phantom();
      if (!p?.isPhantom) { const h = el('install-hint'); if (h) h.style.display = 'block'; return; }
      const btn = el('connect-btn') as HTMLButtonElement | null;
      if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
      try {
        const resp = await p.connect();
        pubkey = resp.publicKey.toString();
        showPortfolio();
      } catch {
        if (btn) { btn.disabled = false; btn.innerHTML = phantomBtnHTML(); }
      }
    }

    async function disconnectWallet() {
      try { await phantom()?.disconnect(); } catch {}
      pubkey = null;
      clearEVMAddr();
      const cs = el('connect-screen'); if (cs) cs.style.display = 'flex';
      const ps = el('portfolio-screen'); if (ps) ps.style.display = 'none';
      const btn = el('connect-btn') as HTMLButtonElement | null;
      if (btn) { btn.disabled = false; btn.innerHTML = phantomBtnHTML(); }
    }

    function phantomBtnHTML() {
      return `<svg width="16" height="16" viewBox="0 0 128 128" fill="none"><path d="M110.584 64.9142H99.142C99.142 41.8864 80.6366 23.0625 57.9584 23.0625C35.5556 23.0625 17.2065 41.508 16.8677 64.0735C16.5221 87.0972 35.3756 106 58.2219 106H63.3743C85.6702 106 116.581 88.3047 116.581 66.8896C116.581 65.6864 115.684 64.9142 110.584 64.9142Z" fill="white"/></svg> Connect Phantom`;
    }

    function showPortfolio() {
      const cs = el('connect-screen'); if (cs) cs.style.display = 'none';
      const ps = el('portfolio-screen'); if (ps) ps.style.display = 'block';
      const chip = el('addr-chip'); if (chip && pubkey) chip.textContent = shorten(pubkey);
      loadPortfolio();
      autoDetectEVM();
    }

    async function autoDetectEVM() {
      const phEvm = (window as any).phantom?.ethereum;
      if (phEvm) {
        try {
          let accs = await phEvm.request({ method: 'eth_accounts' });
          if (!accs?.[0]) accs = await phEvm.request({ method: 'eth_requestAccounts' });
          if (accs?.[0]) { setEVMAddr(accs[0], 'Phantom'); return; }
        } catch {}
      }
      const prov = (window as any).ethereum;
      if (prov && !prov.isPhantom) {
        try {
          const accs = await prov.request({ method: 'eth_accounts' });
          if (accs?.[0]) { setEVMAddr(accs[0], 'Wallet'); return; }
        } catch {}
      }
    }

    function setEVMAddr(addr: string, source: string) {
      evmAddr = addr;
      const inp = el('hl-addr-input') as HTMLInputElement | null;
      if (inp) inp.value = addr;
      loadHLData(addr);
      loadEVMBalance(addr);
      const btn = el('hl-evm-btn');
      if (btn) {
        btn.innerHTML = `<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#1fa67d"/></svg> ${source}: ${shorten(addr)}`;
        (btn as HTMLElement).style.borderColor = 'var(--green)';
        (btn as HTMLElement).style.color = 'var(--green)';
        (btn as any).onclick = () => clearEVMAddr();
        btn.title = 'Click to disconnect';
      }
    }

    function clearEVMAddr() {
      evmAddr = null;
      const inp = el('hl-addr-input') as HTMLInputElement | null;
      if (inp) inp.value = '';
      const btn = el('hl-evm-btn');
      if (btn) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/></svg> Connect EVM Wallet`;
        (btn as HTMLElement).style.borderColor = '';
        (btn as HTMLElement).style.color = '';
        (btn as any).onclick = () => connectEVM();
        btn.title = '';
      }
      const card = el('evm-bal-card');
      if (card) card.classList.remove('visible');
    }

    async function loadEVMBalance(addr: string) {
      const card = el('evm-bal-card');
      if (card) card.classList.add('visible');
      set('evm-eth-bal', '…'); set('evm-eth-usd', '');
      set('evm-usdc-bal', '…'); set('evm-usdc-usd', '');
      try {
        const callData = '0x70a08231' + addr.replace('0x','').padStart(64, '0');
        const [ethRes, usdcRes, priceRes] = await Promise.all([
          fetch(ARB_RPC, { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBalance',params:[addr,'latest']}) }),
          fetch(ARB_RPC, { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({jsonrpc:'2.0',id:2,method:'eth_call',params:[{to:USDC_ARB,data:callData},'latest']}) }),
          fetch('/coingecko/api/v3/simple/price?ids=ethereum&vs_currencies=usd').catch(() => null),
        ]);
        const [ethData, usdcData] = await Promise.all([ethRes.json(), usdcRes.json()]);
        const ethBal  = parseInt(ethData.result  || '0x0', 16) / 1e18;
        const usdcBal = parseInt(usdcData.result || '0x0', 16) / 1e6;
        const ethPx   = priceRes ? ((await priceRes.json())?.ethereum?.usd ?? 0) : 0;
        set('evm-eth-bal',  fmt(ethBal, ethBal < 0.01 ? 4 : 3) + ' ETH');
        set('evm-eth-usd',  ethPx ? '$' + fmt(ethBal * ethPx) : '');
        set('evm-usdc-bal', fmt(usdcBal) + ' USDC');
        set('evm-usdc-usd', usdcBal > 0 ? '$' + fmt(usdcBal) : '—');
        if (ethPx && (ethBal > 0 || usdcBal > 0)) {
          const totalEl = el('total-val');
          if (totalEl && totalEl.textContent !== '$—') {
            const existing = parseFloat(totalEl.textContent!.replace(/[$,]/g,'')) || 0;
            const evmTotal = ethBal * ethPx + usdcBal;
            if (evmTotal > 0) totalEl.textContent = '$' + fmt(existing + evmTotal);
          }
        }
      } catch {
        set('evm-eth-bal', '—'); set('evm-usdc-bal', '—');
      }
    }

    async function rpc(method: string, params: any[]) {
      const r = await fetch(SOL_RPC, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
      return r.json();
    }
    async function getSolBal() {
      const { result } = await rpc('getBalance', [pubkey, {commitment:'confirmed'}]);
      return (result?.value ?? 0) / 1e9;
    }
    async function getTokenAccs() {
      const { result } = await rpc('getTokenAccountsByOwner', [pubkey, {programId:TOKEN_PROG}, {encoding:'jsonParsed',commitment:'confirmed'}]);
      return (result?.value ?? []).map((a: any) => ({ mint: a.account.data.parsed.info.mint, balance: a.account.data.parsed.info.tokenAmount.uiAmount ?? 0 })).filter((t: any) => t.balance > 0);
    }
    async function getJupPrices(mints: string[]) {
      if (!mints.length) return {};
      try { const r = await fetch(`https://api.jup.ag/price/v2?ids=${mints.join(',')}`); return (await r.json())?.data ?? {}; } catch { return {}; }
    }
    async function loadTokenMeta() {
      if (Object.keys(tokenMeta).length) return;
      try { const list = await (await fetch('https://tokens.jup.ag/tokens?tags=strict')).json(); list.forEach((t: any) => { tokenMeta[t.address] = {name:t.name,symbol:t.symbol,logo:t.logoURI}; }); } catch {}
      tokenMeta[SOL_MINT] = {name:'Solana',symbol:'SOL',logo:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'};
    }
    async function loadPortfolio() {
      const ab = el('assets-body'); if (ab) ab.innerHTML = skeleRows(3);
      set('total-val','$—'); set('total-sub','Loading…');
      try {
        await loadTokenMeta();
        const [solBal, tokenAccs] = await Promise.all([getSolBal(), getTokenAccs()]);
        const mints = [SOL_MINT, ...tokenAccs.map((t: any) => t.mint)];
        const prices = await getJupPrices(mints);
        const assets: any[] = [];
        const solPx = parseFloat(prices[SOL_MINT]?.price ?? 0);
        assets.push({mint:SOL_MINT,balance:solBal,price:solPx,value:solBal*solPx,...(tokenMeta[SOL_MINT]??{name:'Solana',symbol:'SOL',logo:''})});
        tokenAccs.forEach((t: any) => {
          const px = parseFloat(prices[t.mint]?.price ?? 0);
          const meta = tokenMeta[t.mint] ?? {name:t.mint.slice(0,8)+'…',symbol:'???',logo:''};
          assets.push({mint:t.mint,balance:t.balance,price:px,value:t.balance*px,...meta});
        });
        assets.sort((a,b) => b.value - a.value);
        const total = assets.reduce((s,a) => s+a.value, 0);
        set('total-val','$'+fmt(total)); set('total-sub',assets.length+' asset'+(assets.length!==1?'s':''));
        renderAssets(assets);
      } catch(e: any) { set('total-sub','Error'); const ab2 = el('assets-body'); if (ab2) ab2.innerHTML=`<div class="empty-assets">${e.message}</div>`; }
    }
    function renderAssets(assets: any[]) {
      walletAssets = assets;
      const ab = el('assets-body');
      if (!ab) return;
      if (!assets.length) { ab.innerHTML='<div class="empty-assets">No assets found.</div>'; return; }
      ab.innerHTML = assets.map(a => {
        const icon = a.logo ? `<img class="token-icon" src="${a.logo}" alt="" onerror="this.outerHTML='<div class=token-icon-ph>${(a.symbol||'?')[0]}</div>'">` : `<div class="token-icon-ph">${(a.symbol||'?')[0]}</div>`;
        return `<div class="asset-row"><div class="asset-left">${icon}<div><div class="token-name">${a.name}</div><div class="token-sym">${a.symbol}</div></div></div><div class="cell">${a.price?fmtUSD(a.price):'—'}</div><div class="cell">${fmt(a.balance,a.balance<1?4:2)}</div><div class="cell val">${a.value>0.005?'$'+fmt(a.value):'—'}</div></div>`;
      }).join('');
    }
    function skeleRows(n: number) {
      return Array.from({length:n},()=>`<div class="asset-row"><div class="asset-left"><div class="sk" style="width:30px;height:30px;border-radius:50%;flex-shrink:0"></div><div><div class="sk" style="width:76px;height:10px;margin-bottom:5px"></div><div class="sk" style="width:34px;height:9px"></div></div></div><div class="cell"><div class="sk" style="width:54px;height:10px;margin-left:auto"></div></div><div class="cell"><div class="sk" style="width:44px;height:10px;margin-left:auto"></div></div><div class="cell"><div class="sk" style="width:62px;height:10px;margin-left:auto"></div></div></div>`).join('');
    }

    async function addHyperEVM() {
      const provider = (window as any).phantom?.ethereum ?? (window as any).ethereum;
      const btn = el('add-network-btn');
      if (!provider) {
        if (btn) { btn.textContent = 'No wallet found'; (btn as HTMLElement).style.color = 'var(--red)'; setTimeout(() => { if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg> Add HyperEVM'; (btn as HTMLElement).style.color = ''; } }, 3000); }
        return;
      }
      try {
        await provider.request({ method:'wallet_addEthereumChain', params:[{chainId:'0x3E6',chainName:'HyperEVM',nativeCurrency:{name:'HYPE',symbol:'HYPE',decimals:18},rpcUrls:['https://rpc.hyperliquid.xyz/evm'],blockExplorerUrls:['https://hyperevm-explorer.hyperliquid.xyz']}] });
        if (btn) { btn.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#1fa67d"/></svg> HyperEVM Added'; (btn as HTMLElement).style.borderColor = 'var(--green)'; (btn as HTMLElement).style.color = 'var(--green)'; }
      } catch (e: any) {
        if (e.code !== 4001 && btn) { btn.textContent = 'Failed'; (btn as HTMLElement).style.color = 'var(--red)'; setTimeout(() => { if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg> Add HyperEVM'; (btn as HTMLElement).style.color = ''; } }, 3000); }
      }
    }

    async function connectEVM() {
      const phEvm = (window as any).phantom?.ethereum;
      if (phEvm) {
        try {
          let accs = await phEvm.request({ method: 'eth_accounts' });
          if (!accs?.[0]) accs = await phEvm.request({ method: 'eth_requestAccounts' });
          if (accs?.[0]) { setEVMAddr(accs[0], 'Phantom'); return; }
        } catch(e: any) { if (e.code !== 4001) evmHint('Enable EVM in Phantom → Settings → Networks, then try again.'); return; }
      }
      const provider = (window as any).ethereum;
      if (!provider) { evmHint('No EVM wallet found — install MetaMask or Rabby, or enter address manually.'); return; }
      try {
        let accs = await provider.request({ method: 'eth_accounts' });
        if (!accs?.[0]) accs = await provider.request({ method: 'eth_requestAccounts' });
        if (accs?.[0]) setEVMAddr(accs[0], 'Wallet');
      } catch(e: any) { if (e.code !== 4001) evmHint('Connection failed — enter your Hyperliquid address manually.'); }
    }
    function evmHint(msg: string) {
      const inp = el('hl-addr-input') as HTMLInputElement | null;
      if (!inp) return;
      inp.placeholder = msg; inp.style.borderColor='var(--red)';
      setTimeout(()=>{ if (inp) { inp.placeholder='Enter Hyperliquid wallet address (0x…)'; inp.style.borderColor=''; } }, 5000);
    }

    function handleHLLoad() {
      const inp = el('hl-addr-input') as HTMLInputElement | null;
      const addr = inp?.value.trim() || '';
      if (!addr) return;
      loadHLData(addr);
    }

    async function loadHLData(address: string) {
      set('pnl-addr-sub', address.slice(0,10)+'…'+address.slice(-6));
      ['s-total-pnl','s-win-rate','s-trades','s-hold','s-best','s-worst'].forEach(id => set(id,'…'));
      const tb = el('trades-body'); if (tb) tb.innerHTML = '<div class="hl-placeholder">Loading trades…</div>';
      const db = el('dist-bars'); if (db) db.innerHTML = '<div style="color:var(--text3);font-size:11px;text-align:center;padding:40px 0">Loading…</div>';
      try {
        const startTime = Date.now() - 3*365*24*60*60*1000;
        const res = await fetch(HL_API, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'userFillsByTime',user:address,startTime,endTime:Date.now()})});
        if (!res.ok) throw new Error('HTTP '+res.status);
        const fills = await res.json();
        if (!Array.isArray(fills)||fills.length===0) {
          ['s-total-pnl','s-win-rate','s-trades','s-hold','s-best','s-worst'].forEach(id=>set(id,'—'));
          const tb2 = el('trades-body'); if (tb2) tb2.innerHTML='<div class="hl-placeholder">No trades found for this address.</div>';
          const db2 = el('dist-bars'); if (db2) db2.innerHTML='<div style="color:var(--text3);font-size:11px;text-align:center;padding:40px 0">No data</div>';
          renderPnLChart([]); updateShareCard(null, address);
          return;
        }
        hlFills = fills;
        applyRangeAndRender(address);
        loadPerpsPortfolio(address);
      } catch(e: any) {
        const tb3 = el('trades-body'); if (tb3) tb3.innerHTML=`<div class="hl-placeholder">Error: ${e.message}</div>`;
        ['s-total-pnl','s-win-rate','s-trades','s-hold','s-best','s-worst'].forEach(id=>set(id,'—'));
      }
    }

    function setRange(r: string) {
      currentRange = r;
      document.querySelectorAll('.range-tab').forEach((b: Element) => (b as HTMLElement).classList.toggle('active', b.textContent===r));
      set('range-label', r);
      if (portfolioMode === 'aster') { if (asterFills.length) applyAsterRangeAndRender(); }
      else { if (hlFills.length) { const inp = el('hl-addr-input') as HTMLInputElement | null; applyRangeAndRender(inp?.value.trim() || ''); } }
    }

    function applyRangeAndRender(address: string) {
      const cutoff = rangeStartMs(currentRange);
      const filtered = hlFills.filter(f => f.time >= cutoff);
      if (!filtered.length && currentRange!=='ALL') {
        ['s-total-pnl','s-win-rate','s-trades','s-hold','s-best','s-worst'].forEach(id=>set(id,'—'));
        const tb = el('trades-body'); if (tb) tb.innerHTML='<div class="hl-placeholder">No trades in this period.</div>';
        renderPnLChart([]); renderDistribution([]);
        return;
      }
      computeAndRenderHL(filtered.length?filtered:hlFills, address);
    }

    function calcEntryPx(fill: any) {
      const exitPx = parseFloat(fill.px);
      const pnl    = parseFloat(fill.closedPnl);
      const sz     = parseFloat(fill.sz);
      if (sz===0) return 0;
      const isLong = (fill.dir??'').toLowerCase().includes('long')||fill.side==='B';
      return isLong ? exitPx - pnl/sz : exitPx + pnl/sz;
    }

    function computeAndRenderHL(fills: any[], address: string) {
      const closing = fills.filter(f => parseFloat(f.closedPnl??0)!==0);
      const totalPnl = closing.reduce((s,f)=>s+parseFloat(f.closedPnl),0);
      const wins     = closing.filter(f=>parseFloat(f.closedPnl)>0).length;
      const losses   = closing.filter(f=>parseFloat(f.closedPnl)<0).length;
      const winRate  = closing.length?((wins/closing.length)*100).toFixed(1)+'%':'—';
      const pnlVals  = closing.map(f=>parseFloat(f.closedPnl));
      const bestVal  = closing.length?Math.max(...pnlVals):0;
      const worstVal = closing.length?Math.min(...pnlVals):0;
      const bestFill = closing.find(f=>parseFloat(f.closedPnl)===bestVal);
      const worstFill = closing.find(f=>parseFloat(f.closedPnl)===worstVal);
      let avgHoldMs = 0;
      if (closing.length > 1) {
        const byCoins: Record<string,any[]> = {};
        fills.forEach(f => { (byCoins[f.coin]=byCoins[f.coin]||[]).push(f); });
        let totalHold=0, holdCount=0;
        Object.values(byCoins).forEach(coinFills => {
          const cs = coinFills.sort((a,b)=>a.time-b.time);
          for (let i=1;i<cs.length;i++) { const d=cs[i].time-cs[i-1].time; if(d>0&&d<30*86400000){totalHold+=d;holdCount++;} }
        });
        if (holdCount) avgHoldMs = totalHold/holdCount;
      }
      const holdLabel = avgHoldMs>0 ? formatDuration(avgHoldMs) : '—';
      const totalEl = el('s-total-pnl');
      if (totalEl) { totalEl.textContent = (totalPnl>=0?'+':'')+'$'+fmt(totalPnl); totalEl.className = 'stat-val '+pCls(totalPnl); }
      set('s-win-rate', winRate);
      set('s-win-sub', `${wins}W / ${losses}L`);
      set('s-trades', closing.length.toLocaleString());
      set('s-trades-sub', fills.length.toLocaleString()+' total fills');
      set('s-hold', holdLabel);
      set('s-best', bestVal?'+$'+fmt(bestVal):'—');
      if (bestFill) set('s-best-sub', bestFill.coin+' · '+fmtDate(bestFill.time));
      set('s-worst', worstVal?'-$'+fmt(Math.abs(worstVal)):'—');
      if (worstFill) set('s-worst-sub', worstFill.coin+' · '+fmtDate(worstFill.time));
      const sorted = [...closing].sort((a,b)=>a.time-b.time);
      let cum=0;
      const cumPts = sorted.map(f=>{ cum+=parseFloat(f.closedPnl); return {t:f.time,v:cum}; });
      renderPnLChart(cumPts, totalPnl);
      hlDailyPnl = {};
      closing.forEach(f => {
        const d = new Date(f.time);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        hlDailyPnl[key] = (hlDailyPnl[key]??0)+parseFloat(f.closedPnl);
      });
      if (sorted.length) { const last = new Date(sorted[sorted.length-1].time); calYear=last.getFullYear(); calMonth=last.getMonth(); }
      renderDistribution(closing);
      const recent = [...closing].sort((a,b)=>b.time-a.time).slice(0,50);
      set('trades-count', recent.length+' of '+closing.length+' trades');
      renderTrades(recent);
      updateShareCard({totalPnl,winRate,wins,losses,bestVal,cumPts}, address);
    }

    function formatDuration(ms: number) {
      if (ms < 60000) return Math.round(ms/1000)+'s';
      if (ms < 3600000) return Math.round(ms/60000)+'m';
      if (ms < 86400000) return (ms/3600000).toFixed(1)+'h';
      return (ms/86400000).toFixed(1)+'d';
    }

    function renderPnLChart(pts: any[], totalPnl?: number, svgId='pnl-chart-svg', totalId='chart-total') {
      const svg = el(svgId);
      if (!svg) return;
      if (!pts.length) { svg.innerHTML='<text x="400" y="105" text-anchor="middle" font-size="11" fill="#4a5568">No PnL data</text>'; set(totalId,''); return; }
      const W=800,H=200,PAD={t:10,r:8,b:28,l:56};
      const cw=W-PAD.l-PAD.r,ch=H-PAD.t-PAD.b;
      const vals=pts.map((p: any)=>p.v);
      const minV=Math.min(0,...vals),maxV=Math.max(0,...vals);
      const rng=maxV-minV||1;
      const px=(i: number)=>PAD.l+(i/(pts.length-1||1))*cw;
      const py=(v: number)=>PAD.t+(1-(v-minV)/rng)*ch;
      const zeroY=py(0);
      const points=pts.map((p: any,i: number)=>`${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ');
      const color=(totalPnl??vals[vals.length-1])>=0?'#1fa67d':'#ed7088';
      const fid='cf'+Math.random().toString(36).slice(2,6);
      const yLabels: string[]=[],xLabels: string[]=[];
      for(let i=0;i<=4;i++){const v=minV+(rng/4)*i;const y=py(v);yLabels.push(`<text x="${PAD.l-6}" y="${y+3}" text-anchor="end" font-size="9" fill="#878c8f">${fmtK(v).replace('$','')}</text><line x1="${PAD.l}" y1="${y}" x2="${W-PAD.r}" y2="${y}" stroke="#1d2c32" stroke-width="1"/>`);}
      const lc=Math.min(6,pts.length);
      for(let i=0;i<lc;i++){const idx=Math.floor((i/(lc-1||1))*(pts.length-1));const d=new Date(pts[idx].t);xLabels.push(`<text x="${px(idx)}" y="${H-PAD.b+10}" text-anchor="middle" font-size="9" fill="#878c8f">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</text>`);}
      const areaPath=`M${px(0)},${zeroY} `+pts.map((p: any,i: number)=>`L${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ')+` L${px(pts.length-1)},${zeroY} Z`;
      svg.innerHTML=`<defs><linearGradient id="${fid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>${yLabels.join('')}${xLabels.join('')}<line x1="${PAD.l}" y1="${zeroY}" x2="${W-PAD.r}" y2="${zeroY}" stroke="#273035" stroke-width="1" stroke-dasharray="3,3"/><path d="${areaPath}" fill="url(#${fid})"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${px(pts.length-1)}" cy="${py(vals[vals.length-1])}" r="3" fill="${color}"/>`;
      const finalPnl=vals[vals.length-1];
      const ct=el(totalId);
      if (ct) { ct.textContent=(finalPnl>=0?'+':'')+'$'+fmt(finalPnl); ct.className='chart-total '+pCls(finalPnl); }
    }

    function renderDistribution(closing: any[], containerId='dist-bars') {
      const buckets=[
        {label:'> +$500',  min:500,    max:Infinity, color:'#1fa67d'},
        {label:'+$100–500',min:100,    max:500,      color:'#2bc08a'},
        {label:'+$25–100', min:25,     max:100,      color:'#4dd4a0'},
        {label:'+$0–25',   min:0,      max:25,       color:'#7de3c0'},
        {label:'-$0–25',   min:-25,    max:0,        color:'#f4a0b0'},
        {label:'-$25–100', min:-100,   max:-25,      color:'#ed7088'},
        {label:'-$100–500',min:-500,   max:-100,     color:'#d94f6a'},
        {label:'< -$500',  min:-Infinity,max:-500,   color:'#c03050'},
      ];
      const counts = buckets.map(b => closing.filter(f=>{ const p=parseFloat(f.closedPnl); return p>=b.min&&p<b.max; }).length);
      const maxCount = Math.max(...counts,1);
      const container = el(containerId);
      if (!container) return;
      if (!closing.length) { container.innerHTML='<div style="color:var(--text3);font-size:11px;text-align:center;padding:40px 0">No data</div>'; return; }
      container.innerHTML = buckets.map((b,i)=>{
        const pct = closing.length?(counts[i]/closing.length*100).toFixed(1):'0';
        const w   = (counts[i]/maxCount*100).toFixed(1);
        return `<div class="dist-row"><div class="dist-meta"><span class="dist-label">${b.label}</span><span class="dist-count">${counts[i]} · ${pct}%</span></div><div class="dist-track"><div class="dist-bar" style="width:${w}%;background:${b.color}"></div></div></div>`;
      }).join('');
    }

    async function loadPerpsPortfolio(address: string) {
      const ph = el('pv-placeholder'); if (ph) ph.style.display = 'none';
      ['pv-equity','pv-upnl','pv-ntl','pv-avail','pv-margin-used','pv-lev'].forEach(id => set(id, '…'));
      try {
        const res = await fetch(HL_API, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:'clearinghouseState',user:address}) });
        if (!res.ok) throw new Error('HTTP '+res.status);
        const data = await res.json();
        const ms = data.crossMarginSummary || data.marginSummary || {};
        const equity     = parseFloat(ms.accountValue   ?? 0);
        const ntl        = parseFloat(ms.totalNtlPos    ?? 0);
        const marginUsed = parseFloat(ms.totalMarginUsed ?? 0);
        const rawUsd     = parseFloat(ms.totalRawUsd    ?? equity);
        const upnl       = equity - rawUsd;
        const avail      = Math.max(0, equity - marginUsed);
        const lev        = marginUsed > 0 ? (ntl / equity).toFixed(2)+'x' : '0.00x';
        const eqEl = el('pv-equity');
        if (eqEl) { eqEl.textContent = '$'+fmt(equity); (eqEl as HTMLElement).style.color = equity >= 0 ? '' : 'var(--red)'; }
        const upnlEl = el('pv-upnl');
        if (upnlEl) { upnlEl.textContent = (upnl>=0?'+':'')+' $'+fmt(upnl); (upnlEl as HTMLElement).style.color = upnl>0?'var(--green)':upnl<0?'var(--red)':'var(--text3)'; }
        set('pv-ntl', '$'+fmt(ntl)); set('pv-avail', '$'+fmt(avail)); set('pv-margin-used', '$'+fmt(marginUsed)); set('pv-lev', lev);
        const positions = (data.assetPositions || []).filter((p: any) => parseFloat(p.position?.szi ?? 0) !== 0);
        const wrap = el('pv-positions-wrap'); const posDiv = el('pv-positions');
        if (positions.length && wrap && posDiv) {
          wrap.style.display = 'block';
          posDiv.innerHTML = positions.slice(0,6).map((p: any) => {
            const pos = p.position; const szi = parseFloat(pos.szi); const isLong = szi > 0; const upnlP = parseFloat(pos.unrealizedPnl ?? 0);
            return `<div class="pv-pos-row"><span><span class="pv-pos-coin">${pos.coin}</span><span class="pv-pos-dir ${isLong?'long':'short'}">${isLong?'LONG':'SHORT'}</span></span><span class="pv-pos-pnl ${pCls(upnlP)}">${upnlP>=0?'+':''}$${fmt(upnlP)}</span></div>`;
          }).join('');
        } else if (wrap) { wrap.style.display = 'none'; }
      } catch {
        ['pv-equity','pv-ntl','pv-avail','pv-margin-used','pv-lev'].forEach(id => set(id, '—'));
        set('pv-upnl', '—');
        const ph2 = el('pv-placeholder'); if (ph2) { ph2.style.display = 'block'; ph2.textContent = 'Failed to load perps data.'; }
      }
    }

    function updateShareCard(data: any, address: string) {
      if (data) shareData = { ...data, address };
      const sc = el('share-content');
      if (!sc) return;
      if (!data) { sc.innerHTML='<div class="share-placeholder">Load a Hyperliquid wallet to see your PnL card.</div>'; return; }
      const {totalPnl,winRate,wins,losses,bestVal,cumPts} = data;
      const pnlColor = totalPnl>=0?'var(--green)':'var(--red)';
      const sparkPath = buildSparkPath(cumPts.map((p: any)=>p.v), 260, 50);
      const accentColor = totalPnl>=0?'#1fa67d':'#ed7088';
      sc.innerHTML = `
        <div class="share-addr">${shorten(address)}</div>
        <div class="share-pnl" style="color:${pnlColor}">${totalPnl>=0?'+':''}$${fmt(totalPnl)}</div>
        <div class="share-pnl-sub">ALL-TIME REALIZED PNL</div>
        <svg id="share-spark-svg" viewBox="0 0 260 50" preserveAspectRatio="none" style="display:block;width:100%;height:44px;margin:6px 0">
          <path d="${sparkPath}" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="share-stats">
          <div><div class="share-stat-lbl">Win Rate</div><div class="share-stat-val">${winRate}</div></div>
          <div><div class="share-stat-lbl">Trades</div><div class="share-stat-val">${wins+losses}</div></div>
          <div><div class="share-stat-lbl">Best</div><div class="share-stat-val" style="color:var(--green)">+$${fmt(bestVal)}</div></div>
        </div>
        <div class="share-actions">
          <button class="share-btn primary" onclick="shareCard()">SHARE</button>
          <button class="share-btn secondary" onclick="downloadCard()">DOWNLOAD</button>
        </div>`;
    }

    function buildSparkPath(vals: number[], W: number, H: number) {
      if (vals.length < 2) return '';
      const min=Math.min(...vals),max=Math.max(...vals);
      const rng=max-min||1;
      const px=(i: number)=>(i/(vals.length-1))*W;
      const py=(v: number)=>H-(((v-min)/rng)*(H*0.8)+H*0.1);
      return vals.map((v,i)=>`${i===0?'M':'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    }

    function shareCard() {
      const inp = el('hl-addr-input') as HTMLInputElement | null;
      const addr = inp?.value.trim() || pubkey || '';
      if (!addr) return;
      const url = `${location.origin}${location.pathname}?hl=${addr}`;
      navigator.clipboard.writeText(url).catch(()=>{});
      const btn = (event as MouseEvent | undefined)?.target as HTMLButtonElement | null;
      if (btn) { btn.textContent = 'COPIED!'; setTimeout(() => { if (btn) btn.textContent = 'SHARE'; }, 1500); }
    }

    async function downloadCard() {
      if (!shareData) {
        const btn = (event as MouseEvent | undefined)?.target as HTMLButtonElement | null;
        if (btn) { btn.textContent='Load wallet first'; setTimeout(()=>{ if (btn) btn.textContent='DOWNLOAD'; },1500); }
        return;
      }
      const { totalPnl, winRate, wins, losses, bestVal, cumPts, address } = shareData;
      const W = 480, H = 280, DPR = 2;
      const C = document.createElement('canvas');
      C.width = W*DPR; C.height = H*DPR;
      const ctx = C.getContext('2d')!;
      ctx.scale(DPR, DPR);
      const bg = ctx.createLinearGradient(0,0,0,H);
      bg.addColorStop(0,'#162025'); bg.addColorStop(1,'#0f1a1e');
      ctx.fillStyle = bg;
      ctx.beginPath(); (ctx as any).roundRect(0,0,W,H,12); ctx.fill();
      const glow = ctx.createRadialGradient(W-50,-20,0,W-50,-20,150);
      glow.addColorStop(0,'rgba(80,210,193,0.10)'); glow.addColorStop(1,'rgba(80,210,193,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); (ctx as any).roundRect(0,0,W,H,12); ctx.fill();
      ctx.strokeStyle='rgba(80,210,193,0.22)'; ctx.lineWidth=1;
      ctx.beginPath(); (ctx as any).roundRect(0.5,0.5,W-1,H-1,12); ctx.stroke();
      ctx.beginPath(); ctx.arc(22,26,3.5,0,Math.PI*2);
      ctx.fillStyle='#50d2c1'; ctx.fill();
      ctx.font='bold 12px system-ui,-apple-system,sans-serif';
      const rdoW=ctx.measureText('RDO').width;
      ctx.fillStyle='#f5f1ea'; ctx.fillText('RDO',32,31);
      ctx.fillStyle='#50d2c1'; ctx.fillText('ONE',32+rdoW,31);
      ctx.font='10px monospace'; ctx.fillStyle='#555e63';
      ctx.fillText(address.slice(0,10)+'…'+address.slice(-6),20,50);
      const pnlColor2=totalPnl>=0?'#1fa67d':'#ed7088';
      const pnlStr=(totalPnl>=0?'+':'')+'$'+fmt(totalPnl);
      ctx.font='bold 36px system-ui,-apple-system,sans-serif';
      ctx.fillStyle=pnlColor2; ctx.fillText(pnlStr,20,108);
      ctx.font='9px system-ui,-apple-system,sans-serif'; ctx.fillStyle='#5a666b';
      ctx.fillText('ALL-TIME REALIZED PNL',20,126);
      ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(20,134); ctx.lineTo(W-20,134); ctx.stroke();
      if (cumPts.length>1) {
        const vals2=cumPts.map((p: any)=>p.v);
        const minV2=Math.min(...vals2),maxV2=Math.max(...vals2),rng2=maxV2-minV2||1;
        const SX=20,SY=142,SW=W-40,SH=48;
        const spx=(i: number)=>SX+(i/(cumPts.length-1))*SW;
        const spy=(v: number)=>SY+SH-((v-minV2)/rng2)*SH;
        const aFill=ctx.createLinearGradient(0,SY,0,SY+SH);
        const ac0=totalPnl>=0?'rgba(31,166,125,0.22)':'rgba(237,112,136,0.22)';
        const ac1=totalPnl>=0?'rgba(31,166,125,0)':'rgba(237,112,136,0)';
        aFill.addColorStop(0,ac0); aFill.addColorStop(1,ac1);
        ctx.beginPath(); ctx.moveTo(spx(0),SY+SH);
        cumPts.forEach((p: any,i: number)=>ctx.lineTo(spx(i),spy(p.v)));
        ctx.lineTo(spx(cumPts.length-1),SY+SH); ctx.closePath();
        ctx.fillStyle=aFill; ctx.fill();
        ctx.beginPath(); ctx.moveTo(spx(0),spy(cumPts[0].v));
        cumPts.forEach((p: any,i: number)=>{ if(i>0) ctx.lineTo(spx(i),spy(p.v)); });
        ctx.strokeStyle=pnlColor2; ctx.lineWidth=1.5; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
        ctx.beginPath(); ctx.arc(spx(cumPts.length-1),spy(vals2[vals2.length-1]),3,0,Math.PI*2);
        ctx.fillStyle=pnlColor2; ctx.fill();
      }
      ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(20,206); ctx.lineTo(W-20,206); ctx.stroke();
      const stats2=[['WIN RATE',winRate],['TRADES',String(wins+losses)],['BEST TRADE','+$'+fmt(bestVal)]];
      stats2.forEach((s,i)=>{
        const cx2=20+i*(W-40)/3+(W-40)/6;
        ctx.textAlign='center';
        ctx.font='8px system-ui,-apple-system,sans-serif'; ctx.fillStyle='#5a666b'; ctx.fillText(s[0],cx2,220);
        ctx.font='bold 14px system-ui,-apple-system,sans-serif'; ctx.fillStyle='#e8eaed'; ctx.fillText(s[1],cx2,238);
      });
      ctx.textAlign='left';
      ctx.font='9px system-ui,-apple-system,sans-serif'; ctx.fillStyle='#2a3a40';
      ctx.fillText('rdoone.com',20,H-10);
      ctx.textAlign='right';
      ctx.fillText(new Date().toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}),W-20,H-10);
      ctx.textAlign='left';
      const link=document.createElement('a');
      link.download=`rdo-pnl-${address.slice(0,6)}.png`;
      link.href=C.toDataURL('image/png');
      link.click();
    }

    function openCalendarModal()  { const o = el('cal-overlay'); if (o) o.classList.add('open'); renderCalendar(); }
    function closeCalendarModal() { const o = el('cal-overlay'); if (o) o.classList.remove('open'); }

    function renderCalendar() {
      const DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      set('cal-month-lbl', months[calMonth]+' '+calYear);
      const today=new Date();
      const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
      let firstDay=new Date(calYear,calMonth,1).getDay();
      firstDay=(firstDay+6)%7;
      let html=DAYS.map(d=>`<div class="cal-day-hdr">${d}</div>`).join('');
      for(let i=0;i<firstDay;i++) html+=`<div class="cal-day empty-bg"></div>`;
      let winDays=0,lossDays=0,totalMonthPnl=0,bestStreak=0,runStreak=0;
      for(let d=1;d<=daysInMonth;d++){
        const key=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const pnl=hlDailyPnl[key];
        const isToday=today.getDate()===d&&today.getMonth()===calMonth&&today.getFullYear()===calYear;
        let cls='cal-day'; let pnlHtml='';
        if(pnl!==undefined){
          totalMonthPnl+=pnl;
          if(pnl>0){cls+=' pos';winDays++;runStreak++;bestStreak=Math.max(bestStreak,runStreak);}
          else if(pnl<0){cls+=' neg';lossDays++;runStreak=0;}
          else{cls+=' zero';runStreak=0;}
          const sign=pnl>0?'+':'';
          pnlHtml=`<span class="cal-day-pnl">${sign}${Math.abs(pnl)>=1000?fmtK(pnl).replace('$',''):('$'+fmt(Math.abs(pnl),0))}</span>`;
        }else{cls+=' empty-bg';}
        if(isToday)cls+=' today';
        html+=`<div class="${cls}"><span class="cal-day-num">${d}</span>${pnlHtml}</div>`;
      }
      const cg = el('cal-grid'); if (cg) cg.innerHTML=html;
      const ct=el('cal-month-total');
      if (ct) { ct.textContent=(totalMonthPnl>=0?'+':'')+'$'+fmt(totalMonthPnl); ct.className='cal-total '+pCls(totalMonthPnl); }
      const tradingDays=winDays+lossDays;
      const barPct=tradingDays?((winDays/tradingDays)*100).toFixed(1):'0';
      const barFill=el('cal-bar-fill');
      if (barFill) { (barFill as HTMLElement).style.width=barPct+'%'; (barFill as HTMLElement).style.background=winDays>lossDays?'var(--green)':'var(--red)'; }
      set('cal-win-label',winDays+' day'+(winDays!==1?'s':'')+' profitable');
      set('cal-loss-label',lossDays+' day'+(lossDays!==1?'s':'')+' losing');
      let cStreak=0;
      for(let d=today.getDate();d>=1;d--){
        const key=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if(hlDailyPnl[key]>0)cStreak++;
        else if(hlDailyPnl[key]!==undefined)break;
        else break;
      }
      set('cal-streak',cStreak>0?cStreak+' day'+(cStreak!==1?'s':''):'—');
      const bsEl=el('cal-best-streak'); if (bsEl) bsEl.innerHTML='Best Streak: <strong>'+(bestStreak>0?bestStreak+' day'+(bestStreak!==1?'s':''):'—')+'</strong>';
    }

    function calPrev(){ calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCalendar(); }
    function calNext(){ calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCalendar(); }

    function renderTrades(fills: any[]) {
      const tb = el('trades-body');
      if (!tb) return;
      if(!fills.length){tb.innerHTML='<div class="hl-placeholder">No closed trades found.</div>';return;}
      const hdr=`<div class="trades-grid trades-hdr"><span>Token</span><span>Side</span><span>Entry</span><span>Exit</span><span>Size</span><span>PnL</span><span>PnL%</span><span>Date</span></div>`;
      const rows=fills.map(f=>{
        const pnl=parseFloat(f.closedPnl);
        const exitPx=parseFloat(f.px);
        const sz=parseFloat(f.sz);
        const entryPx=calcEntryPx(f);
        const pnlPct=entryPx>0?((pnl/(entryPx*sz))*100):0;
        const isLong=(f.dir??'').toLowerCase().includes('long')||f.side==='B';
        return `<div class="trades-grid trade-row"><div class="trade-coin">${f.coin??'—'}</div><div><span class="trade-dir ${isLong?'long':'short'}">${isLong?'Long':'Short'}</span></div><div class="trade-cell">$${fmt(entryPx,entryPx<1?4:2)}</div><div class="trade-cell">$${fmt(exitPx,exitPx<1?4:2)}</div><div class="trade-cell">${fmt(sz,sz<1?4:2)}</div><div class="trade-pnl ${pCls(pnl)}">${pnl>=0?'+':''}$${fmt(pnl)}</div><div class="trade-pnl ${pCls(pnl)}">${pnlPct>=0?'+':''}${fmt(Math.abs(pnlPct),1)}%</div><div class="trade-cell">${fmtDate(f.time)}</div></div>`;
      }).join('');
      tb.innerHTML=hdr+rows;
    }

    function fmtDate(ts: number){ return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}); }

    function openDeposit() {
      const dm = el('deposit-modal'); if (dm) dm.classList.add('open');
      depBack();
      if (walletAssets.length) depSelectToken(walletAssets[0]);
    }
    function closeDeposit() { const dm = el('deposit-modal'); if (dm) dm.classList.remove('open'); depBack(); }
    function depBack() {
      const pick = el('dep-step-pick'); if (pick) pick.style.display='';
      const lifi = el('dep-step-lifi'); if (lifi) lifi.style.display='none';
      const back = el('dep-back-btn'); if (back) (back as HTMLElement).style.display='none';
      const title = el('dep-modal-title'); if (title) title.textContent='Transfer';
      depTokListOpen=false;
      const tl = el('dep-token-list'); if (tl) (tl as HTMLElement).style.display='none';
    }
    function toggleDepTokenList() {
      depTokListOpen=!depTokListOpen;
      const tl = el('dep-token-list'); if (tl) (tl as HTMLElement).style.display=depTokListOpen?'':'none';
      if(depTokListOpen) renderDepTokList();
    }
    function renderDepTokList() {
      const tl = el('dep-token-list');
      if (!tl) return;
      if(!walletAssets.length){tl.innerHTML='<div style="padding:16px;color:var(--text3);text-align:center;font-size:12px">Connect wallet to see tokens</div>';return;}
      tl.innerHTML=walletAssets.map((a,i)=>{
        const ic=a.logo?`<img class="dep-tok-item-icon" src="${a.logo}" alt="" onerror="this.className='dep-tok-item-ph';this.textContent='${(a.symbol||'?')[0]}'">`:`<div class="dep-tok-item-ph">${(a.symbol||'?')[0]}</div>`;
        return `<div class="dep-tok-item" onclick="depSelectIdx(${i})">${ic}<div class="dep-tok-info"><div class="dep-tok-sym">${a.symbol}</div><div class="dep-tok-name">${a.name}</div></div><div class="dep-tok-right"><div class="dep-tok-bal">${fmt(a.balance,a.balance<1?4:2)}</div><div class="dep-tok-usd">${a.value>0.005?'$'+fmt(a.value):'—'}</div></div></div>`;
      }).join('');
    }
    function depSelectIdx(i: number){ depSelectToken(walletAssets[i]); }
    function depSelectToken(tok: any){
      depToken=tok; depTokListOpen=false;
      const tl = el('dep-token-list'); if (tl) (tl as HTMLElement).style.display='none';
      const ic=tok.logo?`<img class="xfer-tok-icon" src="${tok.logo}" alt="" onerror="this.outerHTML='<div class=xfer-tok-ph>${(tok.symbol||'?')[0]}</div>'">`:`<div class="xfer-tok-ph">${(tok.symbol||'?')[0]}</div>`;
      const iw = el('dep-token-icon-wrap'); if (iw) iw.innerHTML=ic;
      const sym = el('dep-token-sym'); if (sym) sym.textContent=tok.symbol;
      const bal = el('dep-token-bal'); if (bal) bal.textContent=fmt(tok.balance,tok.balance<1?4:2)+' '+tok.symbol;
      const amt = el('dep-amount') as HTMLInputElement | null; if (amt) amt.value='';
      const usd = el('dep-amount-usd'); if (usd) usd.textContent='$0.00';
      const tov = el('dep-to-val'); if (tov) tov.textContent='0.00';
      const tou = el('dep-to-usd'); if (tou) tou.textContent='$0.00';
    }
    function depMax(){
      if(!depToken)return;
      const amt = el('dep-amount') as HTMLInputElement | null;
      if (amt) amt.value=depToken.balance>0?String(Math.floor(depToken.balance*1e6)/1e6):'';
      depAmountChanged();
    }
    function depAmountChanged(){
      if(!depToken)return;
      const amt = el('dep-amount') as HTMLInputElement | null;
      const val=parseFloat(amt?.value||'0')||0, usd=val*(depToken.price||0);
      const au = el('dep-amount-usd'); if (au) au.textContent='$'+fmt(usd);
      const tv = el('dep-to-val'); if (tv) tv.textContent=fmt(usd*0.995);
      const tu = el('dep-to-usd'); if (tu) tu.textContent='~$'+fmt(usd*0.995);
    }
    function depStartTransfer(){
      if(!depToken)return;
      const amtEl = el('dep-amount') as HTMLInputElement | null;
      const amt=parseFloat(amtEl?.value||'0')||0;
      const pick = el('dep-step-pick'); if (pick) pick.style.display='none';
      const lifi = el('dep-step-lifi'); if (lifi) lifi.style.display='';
      const back = el('dep-back-btn'); if (back) (back as HTMLElement).style.display='';
      const title = el('dep-modal-title'); if (title) title.textContent='Bridge via LI.FI';
      const hlInp = el('hl-addr-input') as HTMLInputElement | null;
      let url='/lifi.html?mode=deposit';
      const addr=evmAddr||hlInp?.value.trim()||'';
      if(addr) url+='&toAddress='+encodeURIComponent(addr);
      url+='&fromToken='+encodeURIComponent(depToken.mint===SOL_MINT?'SOL':depToken.mint);
      if(amt>0) url+='&fromAmount='+amt;
      const frame = el('lifi-deposit-frame') as HTMLIFrameElement | null;
      if (frame) frame.src=url;
    }
    function openPerpsDeposit(){
      const hlInp = el('hl-addr-input') as HTMLInputElement | null;
      const addr=evmAddr||hlInp?.value.trim()||'';
      const dm = el('deposit-modal'); if (dm) dm.classList.add('open');
      const pick = el('dep-step-pick'); if (pick) pick.style.display='none';
      const lifi = el('dep-step-lifi'); if (lifi) lifi.style.display='';
      const back = el('dep-back-btn'); if (back) (back as HTMLElement).style.display='';
      const title = el('dep-modal-title'); if (title) title.textContent='Deposit to Perps via LI.FI';
      const frame = el('lifi-deposit-frame') as HTMLIFrameElement | null;
      if (frame) frame.src='/lifi.html?mode=deposit'+(addr?'&toAddress='+encodeURIComponent(addr):'');
    }
    function openSwap(){ const sm = el('swap-modal'); if (sm) sm.classList.add('open'); const f = el('lifi-swap-frame') as HTMLIFrameElement | null; if(f&&!f.src) f.src='/lifi.html?mode=swap'; }
    function closeSwap(){ const sm = el('swap-modal'); if (sm) sm.classList.remove('open'); }
    function openConvert(){ const cm = el('convert-modal'); if (cm) cm.classList.add('open'); const f = el('lifi-convert-frame') as HTMLIFrameElement | null; if(f&&!f.src) f.src='/lifi.html?mode=convert'; }
    function closeConvert(){ const cm = el('convert-modal'); if (cm) cm.classList.remove('open'); }
    async function copyFullAddr() {
      if (!pubkey) return;
      await navigator.clipboard.writeText(pubkey).catch(()=>{});
      const chip=el('addr-chip');
      if (!chip) return;
      const orig=chip.textContent||'';
      chip.textContent='✓ Copied'; setTimeout(()=>{ if (chip) chip.textContent=orig; },1500);
    }

    function switchPortfolioMode(mode: string) {
      portfolioMode = mode;
      const hlBtn = el('pfBtnHL'); if (hlBtn) hlBtn.classList.toggle('active', mode === 'hl');
      const asBtn = el('pfBtnAster'); if (asBtn) asBtn.classList.toggle('active', mode === 'aster');
      const hlSec = el('pnl-section-hl'); if (hlSec) hlSec.style.display = mode === 'hl' ? '' : 'none';
      const asSec = el('pnl-section-aster'); if (asSec) asSec.style.display = mode === 'aster' ? '' : 'none';
      const title = el('pf-section-title');
      if (title) { title.textContent = mode === 'hl' ? 'TRADER PNL' : 'ASTER PNL'; (title as HTMLElement).style.color = mode === 'aster' ? '#f59e0b' : ''; }
      if (mode === 'aster') {
        const inp = el('aster-addr-input') as HTMLInputElement | null;
        const asterAddr = inp?.value.trim() || '';
        if (asterAddr) loadAsterData(asterAddr);
        else if (evmAddr) { if (inp) inp.value = evmAddr; loadAsterData(evmAddr); }
      }
    }

    function handleAsterLoad() {
      const inp = el('aster-addr-input') as HTMLInputElement | null;
      const addr = inp?.value.trim() || '';
      if (!addr) return;
      loadAsterData(addr);
    }

    async function connectAsterEVM() {
      const phEvm = (window as any).phantom?.ethereum;
      if (phEvm) {
        try {
          let accs = await phEvm.request({ method: 'eth_accounts' });
          if (!accs?.[0]) accs = await phEvm.request({ method: 'eth_requestAccounts' });
          if (accs?.[0]) { const inp = el('aster-addr-input') as HTMLInputElement | null; if (inp) inp.value = accs[0]; loadAsterData(accs[0]); return; }
        } catch {}
      }
      const provider = (window as any).ethereum;
      if (provider) {
        try {
          let accs = await provider.request({ method: 'eth_accounts' });
          if (!accs?.[0]) accs = await provider.request({ method: 'eth_requestAccounts' });
          if (accs?.[0]) { const inp = el('aster-addr-input') as HTMLInputElement | null; if (inp) inp.value = accs[0]; loadAsterData(accs[0]); return; }
        } catch {}
      }
      const inp = el('aster-addr-input') as HTMLInputElement | null;
      if (inp) { inp.placeholder='No EVM wallet found — enter address manually'; inp.style.borderColor='var(--red)'; setTimeout(()=>{ if (inp) { inp.placeholder='Enter Aster / EVM wallet address (0x…)'; inp.style.borderColor=''; } },4000); }
    }

    async function loadAsterData(address: string) {
      ['as-pv-equity','as-pv-upnl','as-pv-ntl','as-pv-avail','as-pv-margin','as-pv-lev'].forEach(id=>set(id,'…'));
      const ph = el('as-pv-placeholder'); if (ph) ph.style.display='none';
      const pw = el('as-pv-positions-wrap'); if (pw) pw.style.display='none';
      const tb = el('aster-trades-body'); if (tb) tb.innerHTML='<div class="hl-placeholder">Loading…</div>';
      ['as-total-pnl','as-win-rate','as-trades','as-hold','as-best','as-worst'].forEach(id=>set(id,'…'));

      // Aster deprecated the old public v2/account bulk endpoint this used to
      // call — the current V3 Pro API requires our shared trading agent to
      // be approved first. ensureAsterAgentApproved probes silently and only
      // prompts the wallet for a signature when this address hasn't already
      // approved (e.g. via the main app, same shared agent) — "one time, and
      // again only if needed," no separate button.
      const provider = (window as any).phantom?.ethereum ?? (window as any).ethereum ?? null;
      const approval = await ensureAsterAgentApproved(address, async () => {
        if (!provider) throw new Error('connect an EVM wallet to approve the Aster agent');
        const onBsc = await ensureBscNetwork(provider);
        if (!onBsc) throw new Error("switch your wallet to BNB Smart Chain (BSC) — Aster's approval signature requires it");
        const { ethers } = await import('ethers');
        return new ethers.BrowserProvider(provider).getSigner();
      });
      if (!approval.ok) {
        ['as-pv-equity','as-pv-upnl','as-pv-ntl','as-pv-avail','as-pv-margin','as-pv-lev'].forEach(id=>set(id,'—'));
        const ph1 = el('as-pv-placeholder'); if (ph1) { ph1.style.display='block'; ph1.innerHTML=`Could not load Aster portfolio: ${approval.message}<br><span style="font-size:10px;color:var(--text3)">Collateral: USDT · Max leverage: 200x</span>`; }
        ['as-total-pnl','as-win-rate','as-trades','as-hold','as-best','as-worst'].forEach(id=>set(id,'—'));
        const tb1 = el('aster-trades-body'); if (tb1) tb1.innerHTML='<div class="hl-placeholder">No trade history found for this address.</div>';
        return;
      }

      const [posRes, tradesRes] = await Promise.allSettled([
        fetchAsterPositions(address),
        fetchAsterTrades(address),
      ]);
      if (posRes.status === 'fulfilled') { renderAsterPortfolio(posRes.value, address); }
      else {
        ['as-pv-equity','as-pv-upnl','as-pv-ntl','as-pv-avail','as-pv-margin','as-pv-lev'].forEach(id=>set(id,'—'));
        const ph2 = el('as-pv-placeholder'); if (ph2) { ph2.style.display='block'; ph2.innerHTML='Could not load Aster portfolio.<br><span style="font-size:10px;color:var(--text3)">Collateral: USDT · Max leverage: 200x</span>'; }
      }
      if (tradesRes.status === 'fulfilled' && tradesRes.value.length) {
        renderAsterTrades(tradesRes.value);
        computeAsterStats(tradesRes.value);
      } else {
        ['as-total-pnl','as-win-rate','as-trades','as-hold','as-best','as-worst'].forEach(id=>set(id,'—'));
        const tb2 = el('aster-trades-body'); if (tb2) tb2.innerHTML='<div class="hl-placeholder">No trade history found for this address.</div>';
      }
    }

    // Raw accountWithJoinMargin shape matches what renderAsterPortfolio
    // already expects (totalWalletBalance/positions/etc. are Aster's own
    // field names) — only the URL + signed auth changed from the old,
    // now-dead v2/account endpoint.
    async function fetchAsterPositions(address: string) {
      const r = await fetch(`/aster-signed/fapi/v3/accountWithJoinMargin?user=${encodeURIComponent(address)}`);
      if (!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      if (!data || !Array.isArray(data.positions)) throw new Error('agent not approved');
      return data;
    }
    // The old v1/userTrades (per-fill: price/qty/side/realizedPnl) has no
    // direct V3 replacement without iterating every traded symbol — income
    // history (symbol/pnl/time only) is what's available in one bulk call.
    // renderAsterTrades shows "—" for the price/size/side columns it can't
    // fill from this shape rather than fabricating misleading values.
    async function fetchAsterTrades(address: string) {
      const sinceMs = Date.now() - 365*24*60*60*1000;
      const income = await getAsterIncomeHistory(sinceMs, address);
      return income.map(e => ({ realizedPnl: e.income, symbol: e.symbol, time: e.time }));
    }

    function renderAsterPortfolio(data: any, _address: string) {
      const totalWalletBalance = parseFloat(data.totalWalletBalance ?? data.totalMarginBalance ?? 0);
      const totalUnrealizedProfit = parseFloat(data.totalUnrealizedProfit ?? 0);
      const totalPositionInitialMargin = parseFloat(data.totalPositionInitialMargin ?? 0);
      const totalOpenOrderInitialMargin = parseFloat(data.totalOpenOrderInitialMargin ?? 0);
      const availableBalance = parseFloat(data.availableBalance ?? totalWalletBalance - totalPositionInitialMargin);
      const totalCrossUnPnl = parseFloat(data.totalCrossUnPnl ?? totalUnrealizedProfit);
      const equity = totalWalletBalance + totalCrossUnPnl;
      const ntl = totalPositionInitialMargin;
      const lev = ntl > 0 ? (ntl/Math.max(equity,0.01)).toFixed(2)+'x' : '0.00x';
      const eqEl = el('as-pv-equity'); if (eqEl) eqEl.textContent = '$'+fmt(equity);
      const upEl = el('as-pv-upnl'); if (upEl) { upEl.textContent=(totalCrossUnPnl>=0?'+':'')+' $'+fmt(totalCrossUnPnl); (upEl as HTMLElement).style.color=totalCrossUnPnl>0?'var(--green)':totalCrossUnPnl<0?'var(--red)':'var(--text3)'; }
      set('as-pv-ntl','$'+fmt(ntl)); set('as-pv-avail','$'+fmt(availableBalance)); set('as-pv-margin','$'+fmt(totalPositionInitialMargin+totalOpenOrderInitialMargin)); set('as-pv-lev',lev);
      const positions = (data.positions || []).filter((p: any) => parseFloat(p.positionAmt ?? p.initialMargin ?? 0) !== 0);
      const wrap = el('as-pv-positions-wrap'); const posDiv = el('as-pv-positions');
      if (positions.length && wrap && posDiv) {
        wrap.style.display='block';
        posDiv.innerHTML=positions.slice(0,6).map((p: any)=>{
          const amt=parseFloat(p.positionAmt??0); const isLong=amt>0; const upnl=parseFloat(p.unrealizedProfit??0);
          return `<div class="pv-pos-row"><span><span class="pv-pos-coin">${p.symbol?.replace('USDT','')?? '—'}</span><span class="pv-pos-dir ${isLong?'long':'short'}">${isLong?'LONG':'SHORT'}</span></span><span class="pv-pos-pnl ${pCls(upnl)}">${upnl>=0?'+':''}$${fmt(upnl)}</span></div>`;
        }).join('');
      }
    }

    function renderAsterTrades(trades: any[]) {
      const closing = trades.filter(t => parseFloat(t.realizedPnl??0)!==0);
      const recent = [...closing].sort((a,b)=>b.time-a.time).slice(0,50);
      set('aster-trades-count', recent.length+' of '+closing.length+' trades');
      const tb = el('aster-trades-body');
      if (!tb) return;
      if (!recent.length) { tb.innerHTML='<div class="hl-placeholder">No closed trades found.</div>'; return; }
      const hdr=`<div class="trades-grid trades-hdr" style="grid-template-columns:1fr 64px 88px 70px 88px"><span>Token</span><span>Side</span><span>Price</span><span>Size</span><span>PnL</span></div>`;
      const rows=recent.map(t=>{
        const pnl=parseFloat(t.realizedPnl??0);
        // Realized-PnL history (income endpoint) carries no price/size/side —
        // show "—" rather than a fabricated $0.00/Short for fields we don't
        // actually know, unlike the old per-fill endpoint this replaced.
        const hasDetail = t.price !== undefined && t.side !== undefined;
        const px2 = hasDetail ? parseFloat(t.price??0) : null;
        const qty = hasDetail ? parseFloat(t.qty??t.quoteQty??0) : null;
        const isLong = hasDetail ? (t.side??'').toUpperCase()==='BUY' : null;
        const sym=(t.symbol??'').replace('USDT','').replace('PERP','');
        const sideCell = isLong===null ? '<span class="trade-dir">—</span>' : `<span class="trade-dir ${isLong?'long':'short'}">${isLong?'Long':'Short'}</span>`;
        const priceCell = px2===null ? '—' : '$'+fmt(px2,px2<1?4:2);
        const sizeCell = qty===null ? '—' : fmt(qty,qty<1?4:2);
        return `<div class="trades-grid trade-row" style="grid-template-columns:1fr 64px 88px 70px 88px"><div class="trade-coin">${sym}</div><div>${sideCell}</div><div class="trade-cell">${priceCell}</div><div class="trade-cell">${sizeCell}</div><div class="trade-pnl ${pCls(pnl)}">${pnl>=0?'+':''}$${fmt(pnl)}</div></div>`;
      }).join('');
      tb.innerHTML=hdr+rows;
    }

    function computeAsterStats(trades: any[]) { asterFills=trades; applyAsterRangeAndRender(); }

    function applyAsterRangeAndRender() {
      const cutoff=rangeStartMs(currentRange);
      const closing=asterFills.filter(t=>parseFloat(t.realizedPnl??0)!==0&&(currentRange==='ALL'||t.time>=cutoff));
      set('as-range-label',currentRange);
      if (!closing.length) {
        ['as-total-pnl','as-win-rate','as-trades','as-hold','as-best','as-worst'].forEach(id=>set(id,'—'));
        renderPnLChart([],0,'as-pnl-chart-svg','as-chart-total');
        renderDistribution([],'as-dist-bars');
        return;
      }
      const totalPnl=closing.reduce((s,t)=>s+parseFloat(t.realizedPnl),0);
      const wins=closing.filter(t=>parseFloat(t.realizedPnl)>0).length;
      const losses=closing.filter(t=>parseFloat(t.realizedPnl)<0).length;
      const pnlVals=closing.map(t=>parseFloat(t.realizedPnl));
      const bestVal=Math.max(...pnlVals); const worstVal=Math.min(...pnlVals);
      const bestT=closing.find(t=>parseFloat(t.realizedPnl)===bestVal);
      const worstT=closing.find(t=>parseFloat(t.realizedPnl)===worstVal);
      const totalEl=el('as-total-pnl');
      if (totalEl) { totalEl.textContent=(totalPnl>=0?'+':'')+'$'+fmt(totalPnl); totalEl.className='stat-val '+pCls(totalPnl); }
      set('as-win-rate',closing.length?((wins/closing.length)*100).toFixed(1)+'%':'—');
      set('as-win-sub',`${wins}W / ${losses}L`);
      set('as-trades',closing.length.toLocaleString()); set('as-hold','—');
      set('as-best',bestVal?'+$'+fmt(bestVal):'—');
      if (bestT) set('as-best-sub',(bestT.symbol??'').replace('USDT','')+' · '+fmtDate(bestT.time));
      set('as-worst',worstVal?'-$'+fmt(Math.abs(worstVal)):'—');
      if (worstT) set('as-worst-sub',(worstT.symbol??'').replace('USDT','')+' · '+fmtDate(worstT.time));
      const sorted=[...closing].sort((a,b)=>a.time-b.time);
      let cum=0;
      const cumPts=sorted.map(t=>{ cum+=parseFloat(t.realizedPnl); return {t:t.time,v:cum}; });
      renderPnLChart(cumPts,totalPnl,'as-pnl-chart-svg','as-chart-total');
      const adapted=closing.map(t=>({closedPnl:t.realizedPnl}));
      renderDistribution(adapted,'as-dist-bars');
    }

    function openAsterDeposit() { window.open('https://www.asterdex.com','_blank','noopener'); }

    // Expose all functions to window
    (window as any).connectWallet = connectWallet;
    (window as any).disconnectWallet = disconnectWallet;
    (window as any).copyFullAddr = copyFullAddr;
    (window as any).loadPortfolio = loadPortfolio;
    (window as any).openDeposit = openDeposit;
    (window as any).openSwap = openSwap;
    (window as any).openConvert = openConvert;
    (window as any).switchPortfolioMode = switchPortfolioMode;
    (window as any).openCalendarModal = openCalendarModal;
    (window as any).closeCalendarModal = closeCalendarModal;
    (window as any).setRange = setRange;
    (window as any).handleHLLoad = handleHLLoad;
    (window as any).connectEVM = connectEVM;
    (window as any).addHyperEVM = addHyperEVM;
    (window as any).openPerpsDeposit = openPerpsDeposit;
    (window as any).handleAsterLoad = handleAsterLoad;
    (window as any).connectAsterEVM = connectAsterEVM;
    (window as any).openAsterDeposit = openAsterDeposit;
    (window as any).calPrev = calPrev;
    (window as any).calNext = calNext;
    (window as any).closeDeposit = closeDeposit;
    (window as any).depBack = depBack;
    (window as any).toggleDepTokenList = toggleDepTokenList;
    (window as any).depSelectIdx = depSelectIdx;
    (window as any).depAmountChanged = depAmountChanged;
    (window as any).depMax = depMax;
    (window as any).depStartTransfer = depStartTransfer;
    (window as any).closeSwap = closeSwap;
    (window as any).closeConvert = closeConvert;
    (window as any).shareCard = shareCard;
    (window as any).downloadCard = downloadCard;

    // Init EVM buttons (dynamic onclick — not React onClick)
    const hlEvmBtn = el('hl-evm-btn');
    if (hlEvmBtn) (hlEvmBtn as any).onclick = connectEVM;
    const asterEvmBtn = el('aster-evm-btn');
    if (asterEvmBtn) (asterEvmBtn as any).onclick = connectAsterEVM;

    // Auto-connect (replaces window.addEventListener('load', ...))
    const urlHL = new URLSearchParams(location.search).get('hl');
    if (urlHL) {
      const inp = el('hl-addr-input') as HTMLInputElement | null;
      if (inp) inp.value = urlHL;
      loadHLData(urlHL);
    }
    const p = phantom();
    if (!p) {
      const hint = el('install-hint'); if (hint) hint.style.display = 'block';
    } else {
      p.on('disconnect', () => { if (pubkey) disconnectWallet(); });
      p.connect({ onlyIfTrusted: true })
        .then((resp: any) => { pubkey = resp.publicKey.toString(); showPortfolio(); })
        .catch(() => {});
    }

    // Keyboard shortcuts
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeDeposit(); closeSwap(); closeConvert(); closeCalendarModal(); }
    };
    document.addEventListener('keydown', onKeyDown);

    // i18n
    import('@/lib/i18n').then(({ applyTranslations, setLang, getLang }: any) => {
      applyTranslations();
      const dd = document.getElementById('langDropdown') as HTMLElement | null;
      const langBtn = document.getElementById('langBtn');
      if (langBtn) langBtn.addEventListener('click', () => {
        if (dd) dd.style.display = dd.style.display === 'none' ? '' : 'none';
      });
      dd?.querySelectorAll('.lang-option').forEach((b: Element) => {
        (b as HTMLElement).addEventListener('click', () => {
          setLang((b as HTMLElement).dataset.lang || 'en');
          if (dd) dd.style.display = 'none';
          updateLangHL();
        });
      });
      document.addEventListener('click', (ev: MouseEvent) => {
        if (!(ev.target as Element)?.closest('.lang-wrap') && dd) dd.style.display = 'none';
      });
      function updateLangHL() {
        document.querySelectorAll('.lang-option').forEach((b: Element) => {
          (b as HTMLElement).style.color = (b as HTMLElement).dataset.lang === getLang() ? 'var(--accent,#50d2c1)' : '';
        });
      }
      updateLangHL();
    }).catch(() => {});

    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: PAGE_CSS}} />
      <nav id="rdo-nav">
        <div className="nav-logo">RDO<span>ONE</span></div>
        <div className="nav-div"></div>
        <a href="/" data-i18n="trade">Trade</a>
        <a href="/markets" data-i18n="markets">Markets</a>
        <a href="/news" data-i18n="news">News</a>
        <a href="/portfolio" className="active" data-i18n="portfolio">Portfolio</a>
        <a href="/transfer" data-i18n="transfer">Transfer</a>
        <div style={{marginLeft:'auto'}}></div>
        <div className="lang-wrap" style={{position:'relative'}}>
          <button className="lang-btn" id="langBtn" aria-label="Language" style={{display:'flex',alignItems:'center',justifyContent:'center',width:'28px',height:'28px',background:'transparent',border:'1px solid var(--border)',borderRadius:'4px',color:'var(--text3)',cursor:'pointer'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></svg>
          </button>
          <div className="lang-dropdown" id="langDropdown" style={{position:'absolute',top:'calc(100% + 6px)',right:'0',zIndex:900,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'4px',padding:'4px 0',minWidth:'110px',boxShadow:'0 8px 24px rgba(0,0,0,.5)',display:'none'}}>
            <button className="lang-option" data-lang="en" style={{display:'block',width:'100%',padding:'7px 14px',border:'none',background:'transparent',color:'var(--text3)',fontSize:'12px',textAlign:'left',cursor:'pointer'}}>English</button>
            <button className="lang-option" data-lang="ru" style={{display:'block',width:'100%',padding:'7px 14px',border:'none',background:'transparent',color:'var(--text3)',fontSize:'12px',textAlign:'left',cursor:'pointer'}}>Русский</button>
            <button className="lang-option" data-lang="zh" style={{display:'block',width:'100%',padding:'7px 14px',border:'none',background:'transparent',color:'var(--text3)',fontSize:'12px',textAlign:'left',cursor:'pointer'}}>中文</button>
          </div>
        </div>
      </nav>

      <main>
        <div id="connect-screen">
          <div className="phantom-logo">
            <svg viewBox="0 0 128 128" fill="none"><path d="M110.584 64.9142H99.142C99.142 41.8864 80.6366 23.0625 57.9584 23.0625C35.5556 23.0625 17.2065 41.508 16.8677 64.0735C16.5221 87.0972 35.3756 106 58.2219 106H63.3743C85.6702 106 116.581 88.3047 116.581 66.8896C116.581 65.6864 115.684 64.9142 110.584 64.9142Z" fill="white"/></svg>
          </div>
          <div className="connect-title" data-i18n="connectPhantom">Connect your Phantom wallet</div>
          <div className="connect-sub" data-i18n="connectPhantomSub">View your Solana holdings, deposit, swap, and convert assets.</div>
          <button className="connect-btn" id="connect-btn" onClick={() => (window as any).connectWallet()}>
            <svg width="16" height="16" viewBox="0 0 128 128" fill="none"><path d="M110.584 64.9142H99.142C99.142 41.8864 80.6366 23.0625 57.9584 23.0625C35.5556 23.0625 17.2065 41.508 16.8677 64.0735C16.5221 87.0972 35.3756 106 58.2219 106H63.3743C85.6702 106 116.581 88.3047 116.581 66.8896C116.581 65.6864 115.684 64.9142 110.584 64.9142Z" fill="white"/></svg>
            Connect Phantom
          </button>
          <div className="install-hint" id="install-hint">Phantom not detected — <a href="https://phantom.app" target="_blank" rel="noopener">install Phantom</a> then refresh.</div>
        </div>

        <div id="portfolio-screen">
          <div className="pf-topbar">
            <div className="addr-row">
              <div className="addr-chip" id="addr-chip" onClick={() => (window as any).copyFullAddr()} title="Click to copy">—</div>
              <button className="disc-btn" onClick={() => (window as any).disconnectWallet()} data-i18n="disconnect">Disconnect</button>
            </div>
            <button className="refresh-btn" onClick={() => (window as any).loadPortfolio()}>↺ Refresh</button>
          </div>
          <div className="total-card">
            <div>
              <div className="total-lbl" data-i18n="totalPortfolio">Total Portfolio Value</div>
              <div className="total-val" id="total-val">$—</div>
              <div className="total-sub" id="total-sub">Loading…</div>
            </div>
            <div className="action-bar">
              <button className="act-btn fill" onClick={() => (window as any).openDeposit()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 11l5 5 5-5"/><path d="M4 19h16"/></svg>
                Deposit
              </button>
              <button className="act-btn outline" onClick={() => (window as any).openSwap()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3l4 4-4 4M20 7H9a4 4 0 000 8h2"/><path d="M8 21l-4-4 4-4M4 17h11a4 4 0 000-8h-2"/></svg>
                Swap
              </button>
              <button className="act-btn outline" onClick={() => (window as any).openConvert()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M11 8h4a2 2 0 012 2v2M9 16H5a2 2 0 01-2-2v-2"/></svg>
                Convert
              </button>
            </div>
          </div>
          <div className="assets-card">
            <div className="assets-hdr"><span>Asset</span><span>Price</span><span>Balance</span><span>Value</span></div>
            <div id="assets-body"><div className="empty-assets">Loading…</div></div>
          </div>
          <div className="evm-bal-card" id="evm-bal-card">
            <div className="evm-bal-hdr">EVM Wallet<span className="evm-bal-chain" id="evm-bal-chain-tag">Arbitrum</span></div>
            <div id="evm-bal-body">
              <div className="evm-bal-row">
                <div className="evm-bal-left"><div className="evm-tok-dot" style={{background:'#1b2429',color:'#627EEA'}}>Ξ</div><div><div className="evm-bal-sym">ETH</div><div className="evm-bal-name">Ethereum</div></div></div>
                <div className="evm-bal-right"><div className="evm-bal-amount" id="evm-eth-bal">—</div><div className="evm-bal-usd" id="evm-eth-usd">—</div></div>
              </div>
              <div className="evm-bal-row">
                <div className="evm-bal-left"><div className="evm-tok-dot" style={{background:'#1b2429',color:'#2775ca'}}>$</div><div><div className="evm-bal-sym">USDC</div><div className="evm-bal-name">USD Coin</div></div></div>
                <div className="evm-bal-right"><div className="evm-bal-amount" id="evm-usdc-bal">—</div><div className="evm-bal-usd" id="evm-usdc-usd">—</div></div>
              </div>
            </div>
          </div>
        </div>

        <div className="section-divider" style={{marginTop:'32px'}}><span>Trader PnL</span></div>
        <div className="pnl-header">
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <div className="pnl-title" id="pf-section-title" data-i18n="traderPnl">TRADER PNL</div>
              <div className="mode-switch" id="pfModeSwitch">
                <button className="mode-btn mode-hl active" id="pfBtnHL" onClick={() => (window as any).switchPortfolioMode('hl')}>BASIC</button>
                <button className="mode-btn mode-aster" id="pfBtnAster" onClick={() => (window as any).switchPortfolioMode('aster')}>EXTRA</button>
              </div>
            </div>
            <div className="pnl-addr-sub" id="pnl-addr-sub"></div>
          </div>
          <div className="pnl-controls" id="pf-hl-controls">
            <button className="pnl-cal-btn" onClick={() => (window as any).openCalendarModal()} data-i18n="pnlCalendar">PNL CALENDAR</button>
            <div className="range-tabs">
              <button className="range-tab" onClick={() => (window as any).setRange('7D')}>7D</button>
              <button className="range-tab" onClick={() => (window as any).setRange('30D')}>30D</button>
              <button className="range-tab" onClick={() => (window as any).setRange('90D')}>90D</button>
              <button className="range-tab active" onClick={() => (window as any).setRange('ALL')}>ALL</button>
            </div>
          </div>
        </div>

        <div id="pnl-section-hl">
          <div className="hl-connect-bar">
            <input className="hl-addr-input" id="hl-addr-input" placeholder="Enter Hyperliquid wallet address (0x…)" />
            <button className="hl-load-btn" onClick={() => (window as any).handleHLLoad()}>Load</button>
            <button className="hl-evm-btn" id="hl-evm-btn" data-i18n="connectEvmWallet">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/></svg>
              Connect EVM Wallet
            </button>
            <button className="hl-evm-btn" id="add-network-btn" onClick={() => (window as any).addHyperEVM()} title="Add HyperEVM network to your wallet">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
              Add HyperEVM
            </button>
          </div>
          <div className="pnl-layout">
            <div className="pnl-main">
              <div className="pnl-stats">
                <div className="stat-card"><div className="stat-lbl" data-i18n="totalRealizedPnl">Total Realized PnL</div><div className="stat-val" id="s-total-pnl">—</div><div className="stat-sub" id="s-total-pnl-sub">All-time</div></div>
                <div className="stat-card"><div className="stat-lbl" data-i18n="winRate">Win Rate</div><div className="stat-val" id="s-win-rate">—</div><div className="stat-sub" id="s-win-sub">wins / losses</div></div>
                <div className="stat-card"><div className="stat-lbl" data-i18n="totalTrades">Total Trades</div><div className="stat-val" id="s-trades">—</div><div className="stat-sub" id="s-trades-sub">closed positions</div></div>
                <div className="stat-card"><div className="stat-lbl" data-i18n="avgHoldTime">Avg Hold Time</div><div className="stat-val" id="s-hold">—</div><div className="stat-sub">per trade</div></div>
                <div className="stat-card"><div className="stat-lbl" data-i18n="bestTrade">Best Trade</div><div className="stat-val pos" id="s-best">—</div><div className="stat-sub" id="s-best-sub"></div></div>
                <div className="stat-card"><div className="stat-lbl" data-i18n="worstTrade">Worst Trade</div><div className="stat-val neg" id="s-worst">—</div><div className="stat-sub" id="s-worst-sub"></div></div>
              </div>
              <div className="charts-row">
                <div className="chart-card cum">
                  <div className="chart-hdr">
                    <div className="chart-title">Cumulative PnL · <span id="range-label">ALL</span></div>
                    <div className="chart-total" id="chart-total"></div>
                  </div>
                  <svg id="pnl-chart-svg" viewBox="0 0 800 200" preserveAspectRatio="none">
                    <text x="400" y="105" textAnchor="middle" fontSize="11" fill="#4a5568">Load a wallet to see PnL chart</text>
                  </svg>
                </div>
                <div className="chart-card dist">
                  <div className="chart-hdr"><div className="chart-title">PnL Distribution</div></div>
                  <div className="dist-bars" id="dist-bars"><div style={{color:'var(--text3)',fontSize:'11px',textAlign:'center',padding:'40px 0'}}>No data</div></div>
                </div>
              </div>
              <div className="trades-card">
                <div className="trades-title">
                  <span>Recent Closed Trades</span>
                  <span id="trades-count" style={{fontSize:'11px',fontWeight:500,color:'var(--text3)'}}></span>
                </div>
                <div id="trades-body"><div className="hl-placeholder">Enter your Hyperliquid address above to view trading history.</div></div>
              </div>
            </div>
            <div className="pnl-sidebar">
              <div className="share-card">
                <div className="share-brand"><div className="share-dot"></div><div className="share-logo">RDO<span>ONE</span></div></div>
                <div id="share-content"><div className="share-placeholder">Load a Hyperliquid wallet to see your PnL card.</div></div>
              </div>
              <div className="perps-val-card" id="perps-val-card">
                <div className="perps-val-hdr">
                  <span className="perps-val-title">Perps Portfolio</span>
                  <span className="perps-val-live"><span className="share-dot" style={{width:'5px',height:'5px'}}></span> LIVE</span>
                </div>
                <div className="perps-val-eq" id="pv-equity">—</div>
                <div className="perps-val-sub" id="pv-upnl-row">Unrealized PnL: <span id="pv-upnl">—</span></div>
                <div className="perps-val-rows">
                  <div className="perps-val-row"><span>Position Value</span><span id="pv-ntl">—</span></div>
                  <div className="perps-val-row"><span>Available Margin</span><span id="pv-avail">—</span></div>
                  <div className="perps-val-row"><span>Margin Used</span><span id="pv-margin-used">—</span></div>
                  <div className="perps-val-row"><span>Account Leverage</span><span id="pv-lev">—</span></div>
                </div>
                <div id="pv-positions-wrap" style={{marginTop:'12px',display:'none'}}>
                  <div className="perps-val-pos-hdr">Open Positions</div>
                  <div id="pv-positions"></div>
                </div>
                <div className="perps-val-placeholder" id="pv-placeholder">Load a Hyperliquid wallet to see perps portfolio.</div>
                <button className="perps-dep-btn" onClick={() => (window as any).openPerpsDeposit()} data-i18n="depositToPerps">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 11l5 5 5-5"/><path d="M4 19h16"/></svg>
                  Deposit to Perps
                </button>
              </div>
            </div>
          </div>
        </div>

        <div id="pnl-section-aster" style={{display:'none'}}>
          <div className="hl-connect-bar">
            <input className="hl-addr-input" id="aster-addr-input" placeholder="Enter Aster / EVM wallet address (0x…)" />
            <button className="aster-load-btn" onClick={() => (window as any).handleAsterLoad()}>Load</button>
            <button className="hl-evm-btn" id="aster-evm-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/></svg>
              Connect EVM Wallet
            </button>
          </div>
          <div className="pnl-layout">
            <div className="pnl-main">
              <div className="pnl-stats">
                <div className="stat-card"><div className="stat-lbl">Total Realized PnL</div><div className="stat-val" id="as-total-pnl">—</div><div className="stat-sub">All-time</div></div>
                <div className="stat-card"><div className="stat-lbl">Win Rate</div><div className="stat-val" id="as-win-rate">—</div><div className="stat-sub" id="as-win-sub">wins / losses</div></div>
                <div className="stat-card"><div className="stat-lbl">Total Trades</div><div className="stat-val" id="as-trades">—</div><div className="stat-sub">closed positions</div></div>
                <div className="stat-card"><div className="stat-lbl">Avg Hold Time</div><div className="stat-val" id="as-hold">—</div><div className="stat-sub">per trade</div></div>
                <div className="stat-card"><div className="stat-lbl">Best Trade</div><div className="stat-val pos" id="as-best">—</div><div className="stat-sub" id="as-best-sub"></div></div>
                <div className="stat-card"><div className="stat-lbl">Worst Trade</div><div className="stat-val neg" id="as-worst">—</div><div className="stat-sub" id="as-worst-sub"></div></div>
              </div>
              <div className="charts-row">
                <div className="chart-card cum">
                  <div className="chart-hdr">
                    <div className="chart-title">Cumulative PnL · <span id="as-range-label">ALL</span></div>
                    <div className="chart-total" id="as-chart-total"></div>
                  </div>
                  <svg id="as-pnl-chart-svg" viewBox="0 0 800 200" preserveAspectRatio="none">
                    <text x="400" y="105" textAnchor="middle" fontSize="11" fill="#4a5568">Load a wallet to see PnL chart</text>
                  </svg>
                </div>
                <div className="chart-card dist">
                  <div className="chart-hdr"><div className="chart-title">PnL Distribution</div></div>
                  <div className="dist-bars" id="as-dist-bars"><div style={{color:'var(--text3)',fontSize:'11px',textAlign:'center',padding:'40px 0'}}>No data</div></div>
                </div>
              </div>
              <div className="trades-card">
                <div className="trades-title">
                  <span>Aster Trade History</span>
                  <span id="aster-trades-count" style={{fontSize:'11px',fontWeight:500,color:'var(--text3)'}}></span>
                </div>
                <div id="aster-trades-body"><div className="hl-placeholder">Enter your Aster address above to view trading history.</div></div>
              </div>
            </div>
            <div className="pnl-sidebar">
              <div className="share-card" style={{borderColor:'rgba(245,158,11,.2)'}}>
                <div className="share-brand"><div className="share-dot" style={{background:'#f59e0b'}}></div><div className="share-logo">RDO<span style={{color:'#f59e0b'}}>ONE</span></div></div>
                <div id="aster-share-content"><div className="share-placeholder">Load an Aster wallet to see your PnL card.</div></div>
              </div>
              <div className="perps-val-card" id="aster-perps-card" style={{marginTop:'14px'}}>
                <div className="perps-val-hdr">
                  <span className="perps-val-title" style={{color:'#f59e0b'}}>Aster Perps</span>
                  <span className="perps-val-live"><span style={{width:'5px',height:'5px',borderRadius:'50%',background:'#f59e0b',display:'inline-block',animation:'pulse 2s ease-in-out infinite'}}></span> LIVE</span>
                </div>
                <div className="perps-val-eq" id="as-pv-equity">—</div>
                <div className="perps-val-sub">Unrealized PnL: <span id="as-pv-upnl" style={{fontWeight:600}}>—</span></div>
                <div className="perps-val-rows">
                  <div className="perps-val-row"><span>Position Value</span><span id="as-pv-ntl">—</span></div>
                  <div className="perps-val-row"><span>Available Margin</span><span id="as-pv-avail">—</span></div>
                  <div className="perps-val-row"><span>Margin Used</span><span id="as-pv-margin">—</span></div>
                  <div className="perps-val-row"><span>Account Leverage</span><span id="as-pv-lev">—</span></div>
                </div>
                <div id="as-pv-positions-wrap" style={{marginTop:'12px',display:'none'}}>
                  <div className="perps-val-pos-hdr">Open Positions</div>
                  <div id="as-pv-positions"></div>
                </div>
                <div className="perps-val-placeholder" id="as-pv-placeholder">
                  Enter your Aster address to see perps portfolio.<br/>
                  <span style={{fontSize:'10px',color:'var(--text3)',marginTop:'4px',display:'block'}}>Collateral: USDT &nbsp;·&nbsp; Max leverage: 200x</span>
                </div>
                <button className="perps-dep-btn" style={{background:'#f59e0b',color:'#1a1044'}} onClick={() => (window as any).openAsterDeposit()}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 11l5 5 5-5"/><path d="M4 19h16"/></svg>
                  Deposit to Aster Perps
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* PnL Calendar Modal */}
      <div className="cal-overlay" id="cal-overlay" onClick={() => (window as any).closeCalendarModal()}>
        <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cal-modal-hdr">
            <div className="cal-modal-title">
              PNL CALENDAR
              <span style={{padding:'3px 8px',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'3px',fontSize:'10px',fontWeight:600,letterSpacing:'.5px',color:'var(--text2)'}}>$ USD</span>
            </div>
            <div className="cal-modal-nav">
              <button className="cal-nav-btn" onClick={() => (window as any).calPrev()}>‹</button>
              <span className="cal-month-lbl" id="cal-month-lbl">—</span>
              <button className="cal-nav-btn" onClick={() => (window as any).calNext()}>›</button>
              <button className="cal-close-btn" onClick={() => (window as any).closeCalendarModal()}>✕</button>
            </div>
          </div>
          <div className="cal-summary">
            <div className="cal-total" id="cal-month-total">—</div>
            <div className="cal-bar-track"><div className="cal-bar-fill" id="cal-bar-fill" style={{width:'0%'}}></div></div>
            <div className="cal-winloss">
              <span style={{color:'var(--green)'}} id="cal-win-label">0 days profitable</span>
              <span style={{color:'var(--red)'}} id="cal-loss-label">0 days losing</span>
            </div>
          </div>
          <div className="cal-grid" id="cal-grid"><div className="hl-placeholder" style={{gridColumn:'1/-1'}}>Load a wallet to see calendar</div></div>
          <div className="cal-footer">
            <span>Current Streak: <strong id="cal-streak">—</strong></span>
            <span id="cal-best-streak">Best Streak: <strong>—</strong></span>
            <span style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'9px',letterSpacing:'.08em'}}>
              <span style={{width:'5px',height:'5px',borderRadius:'50%',background:'var(--accent)',display:'inline-block'}}></span>
              RDO<span style={{color:'var(--accent)'}}>ONE</span>
            </span>
          </div>
        </div>
      </div>

      {/* Deposit Modal */}
      <div className="overlay" id="deposit-modal" onClick={() => (window as any).closeDeposit()}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:'420px'}}>
          <div className="modal-hdr">
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <button id="dep-back-btn" onClick={() => (window as any).depBack()} style={{display:'none',background:'transparent',border:'none',color:'var(--text2)',cursor:'pointer',fontSize:'20px',lineHeight:'1',padding:'0 4px 0 0',fontFamily:'inherit'}}>‹</button>
              <div className="modal-title" id="dep-modal-title">Transfer</div>
            </div>
            <button className="modal-x" onClick={() => (window as any).closeDeposit()}>×</button>
          </div>
          <div id="dep-step-pick" style={{padding:'0 16px 16px'}}>
            <div className="xfer-box">
              <div className="xfer-label">
                From Tokens
                <span className="xfer-bal-hint"><span id="dep-token-bal">—</span> <button className="xfer-max-btn" onClick={() => (window as any).depMax()}>Max</button></span>
              </div>
              <div className="xfer-row">
                <button className="xfer-token-btn" id="dep-token-btn" onClick={() => (window as any).toggleDepTokenList()}>
                  <div id="dep-token-icon-wrap"><div className="xfer-tok-ph">S</div></div>
                  <span id="dep-token-sym">SOL</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                <div className="xfer-amount-wrap">
                  <input type="number" id="dep-amount" className="xfer-amount-input" placeholder="0.00" onInput={() => (window as any).depAmountChanged()} />
                  <div className="xfer-amount-usd" id="dep-amount-usd">$0.00</div>
                </div>
              </div>
            </div>
            <div id="dep-token-list" className="dep-tok-list" style={{display:'none'}}></div>
            <div className="xfer-arrow-row"><div className="xfer-arrow-circle">↓</div></div>
            <div className="xfer-box">
              <div className="xfer-label">To Perps</div>
              <div className="xfer-to-row">
                <img className="xfer-to-icon" src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png" alt="USDC" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                <div><div className="xfer-to-name">USDC</div><div className="xfer-to-sub">Hyperliquid Perps</div></div>
                <div className="xfer-to-right">
                  <div className="xfer-to-val" id="dep-to-val">0.00</div>
                  <div className="xfer-to-usd" id="dep-to-usd">$0.00</div>
                </div>
              </div>
            </div>
            <button className="xfer-go-btn" id="dep-go-btn" onClick={() => (window as any).depStartTransfer()}>Transfer</button>
          </div>
          <div id="dep-step-lifi" style={{display:'none',padding:'0'}}>
            <iframe id="lifi-deposit-frame" className="lifi-frame" title="Bridge via LI.FI" allow="clipboard-write"></iframe>
          </div>
        </div>
      </div>

      {/* Swap Modal */}
      <div className="overlay" id="swap-modal" onClick={() => (window as any).closeSwap()}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:'520px'}}>
          <div className="modal-hdr"><div className="modal-title">Swap</div><button className="modal-x" onClick={() => (window as any).closeSwap()}>×</button></div>
          <div className="modal-body" style={{padding:'0'}}><iframe id="lifi-swap-frame" className="lifi-frame" title="Swap via LI.FI" allow="clipboard-write"></iframe></div>
        </div>
      </div>

      {/* Convert Modal */}
      <div className="overlay" id="convert-modal" onClick={() => (window as any).closeConvert()}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:'520px'}}>
          <div className="modal-hdr"><div className="modal-title">Convert to USDC</div><button className="modal-x" onClick={() => (window as any).closeConvert()}>×</button></div>
          <div className="modal-body" style={{padding:'0'}}><iframe id="lifi-convert-frame" className="lifi-frame" title="Convert via LI.FI" allow="clipboard-write"></iframe></div>
        </div>
      </div>
    </>
  );
}
