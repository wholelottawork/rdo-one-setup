// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function BottomPanel() {
  return (
    <>
      {/* ══ BOTTOM PANEL ════════════════════════════════════════ */}
      <section className="flex flex-col bg-black overflow-hidden">
        <div className="flex items-center pt-1 px-4 pb-2 border-b border-[#1f1f1f] overflow-x-auto flex-shrink-0 gap-1">
          <button
            className="btm-tab active"
            data-bt="positions"
            data-i18n="positions"
          >
            Positions
          </button>
          <button className="btm-tab" data-bt="balances" data-i18n="balances">
            Balances
          </button>
          <button
            className="btm-tab"
            data-bt="open-orders"
            data-i18n="openOrders"
          >
            Open Orders
          </button>
          <button
            className="btm-tab"
            data-bt="trade-history"
            data-i18n="tradeHistory"
          >
            Trade History
          </button>
          <button
            className="btm-tab"
            data-bt="funding"
            data-i18n="fundingHistory"
          >
            Funding History
          </button>
          <button
            className="btm-tab"
            data-bt="order-history"
            data-i18n="orderHistory"
          >
            Order History
          </button>
          <button className="btm-tab" data-bt="liq-map">
            Liq Map
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <div id="btPositions" className="h-full overflow-y-auto">
            <div className="flex px-4 py-2 border-b border-[#1f1f1f] sticky top-0 bg-black">
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="market">Market</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="mode">Mode</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="size">Size</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="positionValue">Position Value</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="entryPrice">Entry Price</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="markPrice">Mark Price</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="pnlRoe">PNL (ROE %)</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="liqPriceShort">Liq. Price</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="tpslShort">TP/SL</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="margin">Margin</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="funding">Funding</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="side">Side</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis"></span>
            </div>
            <div id="posRows" className="p-0">
              <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noPositions">
                No open positions yet
              </div>
            </div>
          </div>
          <div id="btBalances" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="connectBalances">
              Connect wallet to view balances
            </div>
          </div>
          <div id="btOpenOrders" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noOpenOrders">
              No open orders
            </div>
          </div>
          <div id="btTradeHistory" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noTradeHistory">
              No trade history
            </div>
          </div>
          <div id="btFunding" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noFundingHistory">
              No funding history
            </div>
          </div>
          <div id="btOrderHistory" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noOrderHistory">
              No order history
            </div>
          </div>
          <div
            id="btLiqMap"
            className="h-full overflow-y-auto hidden"
            style={{ display: "none", padding: 0, flexDirection: "row" }}
          >
            <div
              id="lmpOuter"
              style={{
                display: "flex",
                flexDirection: "row",
                height: "100%",
                width: "70%",
                borderRight: "1px solid var(--hl-border)",
              }}
            >
              <div
                id="lmpLeft"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  minWidth: 120,
                  borderRight: "1px solid var(--hl-border)",
                }}
              >
                <div className="lmp-hdr">
                  <span className="lmp-title">Liquidation Map</span>
                  <div className="lmp-sym-pills" id="lmpSymPills"></div>
                  <div className="lmp-tabs" id="lmpTabs">
                    <button className="lmp-tab active" data-tab="liqmap">
                      Liq Map
                    </button>
                    <button className="lmp-tab" data-tab="oi">
                      OI Flow
                    </button>
                  </div>
                </div>
                <div
                  id="lmpBody"
                  className="lmp-body"
                  style={{ flex: 1, height: "auto" }}
                >
                  <div className="lmp-loading">Loading…</div>
                </div>
                <div
                  id="lmpOiBody"
                  className="lmp-oi-body"
                  style={{ display: "none", flex: 1, height: "auto" }}
                >
                  <div className="lmp-loading">Loading…</div>
                </div>
              </div>
              <div
                id="lmpRight"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: 600,
                  flexShrink: 0,
                }}
              >
                <div className="lmp-hdr">
                  <span className="lmp-title">AI Signals</span>
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--hl-text-muted)",
                      marginLeft: "auto",
                    }}
                    id="lmpAiSym"
                  ></span>
                </div>
                <div className="lmp-ai-body" id="lmpAiBody">
                  <div className="lmp-loading">Loading…</div>
                </div>
                <div
                  className="lmp-verdict"
                  id="lmpVerdict"
                  style={{ display: "none" }}
                >
                  <span className="lmp-verdict-lbl">Signal</span>
                  <span className="lmp-verdict-val" id="lmpVerdictVal">
                    —
                  </span>
                </div>
              </div>
            </div>
            <div
              id="lmpGuide"
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minWidth: 0,
              }}
            >
              <div className="lmp-hdr">
                <span className="lmp-title">How to read</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  overflowY: "scroll",
                  flex: 1,
                  padding: "12px 14px 16px",
                  gap: 12,
                  scrollbarWidth: "thin",
                  scrollbarColor: "var(--hl-border) transparent",
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    Nearest Liquidation Zones
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.55,
                    }}
                  >
                    The 2 closest liquidation clusters to the current price —
                    what happens if price reaches them.
                  </div>
                  <div
                    id="lmpClosestBars"
                    style={{ display: "flex", flexDirection: "column", gap: 7 }}
                  >
                    <div
                      style={{ fontSize: 10, color: "var(--hl-text-muted)" }}
                    >
                      Waiting for data…
                    </div>
                  </div>
                </div>
                <div
                  style={{ height: 1, background: "var(--hl-border)" }}
                ></div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    Liquidation Map
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    Each bar is a{" "}
                    <b style={{ color: "var(--hl-text-primary)" }}>
                      price level
                    </b>{" "}
                    with leveraged positions stacked on it. The wider the bar,
                    the more USD is at risk of forced liquidation at that price.
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      marginTop: 2,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "10.5px",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 11,
                            height: 11,
                            background: "#ff7caa",
                            borderRadius: 2,
                            flexShrink: 0,
                          }}
                        ></span>
                        <b style={{ color: "var(--hl-text-primary)" }}>
                          Pink bars (above price)
                        </b>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--hl-text-secondary)",
                          lineHeight: 1.55,
                        }}
                      >
                        Short positions. Price rising into these triggers their
                        liquidation, injecting cascading buy orders into the
                        market.
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "10.5px",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 11,
                            height: 11,
                            background: "#7cffc0",
                            borderRadius: 2,
                            flexShrink: 0,
                          }}
                        ></span>
                        <b style={{ color: "var(--hl-text-primary)" }}>
                          Green bars (below price)
                        </b>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--hl-text-secondary)",
                          lineHeight: 1.55,
                        }}
                      >
                        Long positions. Price falling into these forces
                        liquidation, injecting cascading sell orders into the
                        market.
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--hl-text-muted)",
                      marginTop: 2,
                      lineHeight: 1.6,
                    }}
                  >
                    Large clusters act like{" "}
                    <b style={{ color: "var(--hl-text-primary)" }}>magnets</b> —
                    price tends to move toward them because market makers hunt
                    that liquidity.
                  </div>
                </div>
                <div
                  style={{ height: 1, background: "var(--hl-border)" }}
                ></div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    OI Flow
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    Open Interest = total $ value of all open contracts. OI Flow
                    shows how it changed every 5 minutes.
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                      marginTop: 2,
                      fontSize: "10.5px",
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    <div>
                      <b style={{ color: "#7cffc0" }}>
                        OI rising + price rising
                      </b>{" "}
                      — new longs opening, bullish
                    </div>
                    <div>
                      <b style={{ color: "#ff7caa" }}>
                        OI rising + price falling
                      </b>{" "}
                      — new shorts opening, bearish
                    </div>
                    <div>
                      <b>OI falling + price rising</b> — shorts squeezed/closed,
                      momentum could fade
                    </div>
                    <div>
                      <b>OI falling + price falling</b> — longs closing in
                      panic, potential capitulation
                    </div>
                  </div>
                </div>
                <div
                  style={{ height: 1, background: "var(--hl-border)" }}
                ></div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    AI Signals
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      marginTop: 2,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        L/S Ratio
                      </b>{" "}
                      — what % of traders are long vs short.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        Taker Flow
                      </b>{" "}
                      — who is being aggressive: buyers or sellers.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>Funding</b>{" "}
                      — positive = longs paying shorts. Negative = shorts paying
                      longs.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        OI Trend
                      </b>{" "}
                      — short-term direction of open interest.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        24h Price
                      </b>{" "}
                      — session context for signals.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
