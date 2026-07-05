'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type Lang = 'en' | 'ru' | 'zh';

const T = {
  en: {
    // nav
    trade: 'Trade', markets: 'Markets', news: 'News', portfolio: 'Portfolio', transfer: 'Transfer', swap: 'Swap',
    // header stats
    mark: 'Mark', change24h: '24h Change', volume24h: '24h Volume', fundingCountdown: 'Funding / Countdown',
    // wallet
    connect: 'Connect', deposit: 'DEPOSIT', connected: 'Connected',
    // tracker
    tracker: 'Tracker', connectX: 'Connect X',
    xtEmpty: 'Connect your X account to see real-time news and mentions for',
    // search
    searchMarket: 'Search market...',
    // trade panel
    cross: 'Cross', isolated: 'Isolated', unified: 'Unified',
    market: 'Market', limit: 'Limit',
    buyLong: 'Buy / Long', sellShort: 'Sell / Short',
    availableTrade: 'Available to Trade', currentPosition: 'Current Position',
    size: 'Size', reduceOnly: 'Reduce Only', tpsl: 'Take Profit / Stop Loss',
    // order stats
    liqPrice: 'Liquidation Price', orderValue: 'Order Value',
    marginRequired: 'Margin Required', slippage: 'Slippage', fee: 'Fee',
    // account
    accountEquity: 'Account Equity', spot: 'Spot', perps: 'Perps',
    perpsOverview: 'Perps Overview', balance: 'Balance', unrealizedPnl: 'Unrealized PnL',
    crossMarginRatio: 'Cross Margin Ratio', maintenanceMargin: 'Maintenance Margin',
    crossAccountLev: 'Cross Account Leverage',
    // order book
    orderBook: 'Order Book', price: 'Price', total: 'Total', spread: 'Spread',
    // live trades
    liveTrades: 'Live Trades', time: 'Time',
    // bottom tabs
    positions: 'Positions', balances: 'Balances', openOrders: 'Open Orders',
    tradeHistory: 'Trade History', fundingHistory: 'Funding History', orderHistory: 'Order History',
    // bottom headers
    mode: 'Mode', positionValue: 'Position Value', entryPrice: 'Entry Price',
    markPrice: 'Mark Price', pnlRoe: 'PNL (ROE %)', liqPriceShort: 'Liq. Price',
    margin: 'Margin', funding: 'Funding',
    // bottom empty
    noPositions: 'No open positions yet', connectBalances: 'Connect wallet to view balances',
    noOpenOrders: 'No open orders', noTradeHistory: 'No trade history',
    noFundingHistory: 'No funding history', noOrderHistory: 'No order history',
    // status
    connecting: 'CONNECTING...', live: 'LIVE', reconnecting: 'RECONNECTING...',
    // indicators
    indicators: 'Indicators',
    // deposit modal
    depositFunds: 'DEPOSIT FUNDS', depositSub: 'Swap any token → USDC on Hyperliquid',
    step1: 'Pick source token (SOL, ETH, USDC, BTC...)',
    step2: 'Approve in Phantom — one tap',
    step3: 'USDC arrives in ~2 min, ready to trade',
    yourHlAddr: 'Your Hyperliquid address', connectFirst: 'Connect wallet first',
    directDeposit: 'Direct USDC deposit',
    sendToAddr: 'Send to address above on HyperEVM (chain ID 998)',
    // mode popup
    basicTitle: 'RDO ONE x HYPE x LI.FI', extraTitle: 'RDO ONE x ASTER x LI.FI',
    basicLev: 'Up to 40x leverage', extraLev: 'Up to 200x leverage',
    basicDesc: 'Crypto perps only / Non-custodial / Any collateral',
    extraDesc: 'Crypto perps only / Hybrid-custodial / Any collateral',
    basicFee: 'Taker fee 0.045% / Maker 0.015%', extraFee: 'Taker fee 0.04% / Maker 0%',
    basicExtra: 'The best liquidity / Average 0.0015% spreads',
    extraExtra: 'Higher leverage level / Best fee rates',
    // dropdown cols
    lastPrice: 'Last Price', change24hShort: '24h Change', funding8h: '8h Funding',
    volume: 'Volume', openInterest: 'Open Interest',
    // markets page
    marketOverview: 'Market Overview', marketCap: 'Market Cap', tradingVol24h: '24h Trading Volume',
    btcDominance: 'BTC Dominance', fearGreed: 'Fear & Greed', marketStats: 'Market Statistics',
    trending: 'Trending', topGainers: 'Top Gainers (24h)', converter: 'Converter',
    topByMcap: 'Top 20 by Market Cap', search: 'Search',
    name: 'Name', change7d: '7d %',
    // news page
    cryptoNews: 'Crypto News', refresh: 'Refresh', loadMore: 'Load More',
    // portfolio page
    connectPhantom: 'Connect your Phantom wallet',
    connectPhantomSub: 'View your Solana holdings, deposit, swap, and convert assets.',
    totalPortfolio: 'Total Portfolio Value', disconnect: 'Disconnect',
    asset: 'Asset', value: 'Value', convert: 'Convert',
    traderPnl: 'TRADER PNL', pnlCalendar: 'PNL CALENDAR',
    totalRealizedPnl: 'Total Realized PnL', winRate: 'Win Rate', totalTrades: 'Total Trades',
    avgHoldTime: 'Avg Hold Time', bestTrade: 'Best Trade', worstTrade: 'Worst Trade',
    cumulativePnl: 'Cumulative PnL', pnlDistribution: 'PnL Distribution',
    recentClosedTrades: 'Recent Closed Trades', perpsPortfolio: 'Perps Portfolio',
    depositToPerps: 'Deposit to Perps', connectEvmWallet: 'Connect EVM Wallet',
    // transfer page
    transferTitle: 'TRANSFER',
    transferSub: 'Withdraw in any currency · Send to any address · Move between accounts',
    withdraw: 'Withdraw', send: 'Send', betweenAccounts: 'Between Accounts',
    sourceAccount: 'SOURCE ACCOUNT', amount: 'AMOUNT',
    receiveAs: 'RECEIVE AS', destAddress: 'DESTINATION ADDRESS',
    direction: 'Direction', autoTransfer: 'Auto Transfer',
    asterApiCreds: 'Aster API credentials',
    // language
    langEn: 'English', langRu: 'Русский', langZh: '中文',
  },

  ru: {
    trade: 'Торговля', markets: 'Рынки', news: 'Новости', portfolio: 'Портфель', transfer: 'Перевод', swap: 'Обмен',
    mark: 'Цена', change24h: 'Изм. за 24ч', volume24h: 'Объём за 24ч', fundingCountdown: 'Фандинг / Таймер',
    connect: 'Подключить', deposit: 'ДЕПОЗИТ', connected: 'Подключен',
    tracker: 'Трекер', connectX: 'Подключить X',
    xtEmpty: 'Подключите аккаунт X для новостей и упоминаний по',
    searchMarket: 'Поиск рынка...',
    cross: 'Кросс', isolated: 'Изолир.', unified: 'Единый',
    market: 'Маркет', limit: 'Лимит',
    buyLong: 'Купить / Лонг', sellShort: 'Продать / Шорт',
    availableTrade: 'Доступно', currentPosition: 'Текущая позиция',
    size: 'Размер', reduceOnly: 'Только уменьш.', tpsl: 'Тейк Профит / Стоп Лосс',
    liqPrice: 'Цена ликвидации', orderValue: 'Стоимость ордера',
    marginRequired: 'Треб. маржа', slippage: 'Проскальзывание', fee: 'Комиссия',
    accountEquity: 'Баланс аккаунта', spot: 'Спот', perps: 'Деривативы',
    perpsOverview: 'Обзор позиций', balance: 'Баланс', unrealizedPnl: 'Нереализ. PnL',
    crossMarginRatio: 'Кросс маржин. коэф.', maintenanceMargin: 'Поддерж. маржа',
    crossAccountLev: 'Кредитное плечо',
    orderBook: 'Книга ордеров', price: 'Цена', total: 'Итого', spread: 'Спред',
    liveTrades: 'Сделки', time: 'Время',
    positions: 'Позиции', balances: 'Балансы', openOrders: 'Открытые ордера',
    tradeHistory: 'История сделок', fundingHistory: 'История фандинга', orderHistory: 'История ордеров',
    mode: 'Режим', positionValue: 'Стоимость', entryPrice: 'Цена входа',
    markPrice: 'Марк. цена', pnlRoe: 'PnL (ROE %)', liqPriceShort: 'Ликвидация',
    margin: 'Маржа', funding: 'Фандинг',
    noPositions: 'Нет открытых позиций', connectBalances: 'Подключите кошелёк',
    noOpenOrders: 'Нет открытых ордеров', noTradeHistory: 'Нет истории сделок',
    noFundingHistory: 'Нет истории фандинга', noOrderHistory: 'Нет истории ордеров',
    connecting: 'ПОДКЛЮЧЕНИЕ...', live: 'ОНЛАЙН', reconnecting: 'ПЕРЕПОДКЛЮЧЕНИЕ...',
    indicators: 'Индикаторы',
    depositFunds: 'ПОПОЛНЕНИЕ', depositSub: 'Обмен любого токена → USDC на Hyperliquid',
    step1: 'Выберите исходный токен (SOL, ETH, USDC, BTC...)',
    step2: 'Подтвердите в Phantom — одно нажатие',
    step3: 'USDC поступит через ~2 мин, готов к торговле',
    yourHlAddr: 'Ваш адрес Hyperliquid', connectFirst: 'Сначала подключите кошелёк',
    directDeposit: 'Прямой USDC депозит',
    sendToAddr: 'Отправьте на адрес выше через HyperEVM (chain ID 998)',
    basicTitle: 'RDO ONE x HYPE x LI.FI', extraTitle: 'RDO ONE x ASTER x LI.FI',
    basicLev: 'До 40x плечо', extraLev: 'До 200x плечо',
    basicDesc: 'Крипто перпы / Некастодиальный / Любое обеспечение',
    extraDesc: 'Крипто перпы / Гибридный кастоди / Любое обеспечение',
    basicFee: 'Тейкер 0.045% / Мейкер 0.015%', extraFee: 'Тейкер 0.04% / Мейкер 0%',
    basicExtra: 'Лучшая ликвидность / Средний спред 0.0015%',
    extraExtra: 'Максимальное плечо / Лучшие комиссии',
    lastPrice: 'Посл. цена', change24hShort: 'Изм. 24ч', funding8h: 'Фандинг 8ч',
    volume: 'Объём', openInterest: 'Откр. интерес',
    marketOverview: 'Обзор рынка', marketCap: 'Капитализация', tradingVol24h: 'Объём торгов за 24ч',
    btcDominance: 'Доминация BTC', fearGreed: 'Страх и жадность', marketStats: 'Статистика рынка',
    trending: 'Тренды', topGainers: 'Топ роста (24ч)', converter: 'Конвертер',
    topByMcap: 'Топ 20 по капитализации', search: 'Поиск',
    name: 'Название', change7d: '7д %',
    cryptoNews: 'Крипто новости', refresh: 'Обновить', loadMore: 'Показать ещё',
    connectPhantom: 'Подключите кошелёк Phantom',
    connectPhantomSub: 'Просмотр активов Solana, депозит, обмен и конвертация.',
    totalPortfolio: 'Общая стоимость портфеля', disconnect: 'Отключить',
    asset: 'Актив', value: 'Стоимость', convert: 'Конвертация',
    traderPnl: 'PNL ТРЕЙДЕРА', pnlCalendar: 'КАЛЕНДАРЬ PNL',
    totalRealizedPnl: 'Реализованный PnL', winRate: 'Винрейт', totalTrades: 'Всего сделок',
    avgHoldTime: 'Среднее время', bestTrade: 'Лучшая сделка', worstTrade: 'Худшая сделка',
    cumulativePnl: 'Кумулятивный PnL', pnlDistribution: 'Распределение PnL',
    recentClosedTrades: 'Последние закрытые сделки', perpsPortfolio: 'Портфель деривативов',
    depositToPerps: 'Депозит в деривативы', connectEvmWallet: 'Подключить EVM',
    transferTitle: 'ПЕРЕВОД',
    transferSub: 'Вывод в любой валюте · Отправка на любой адрес · Перевод между аккаунтами',
    withdraw: 'Вывод', send: 'Отправить', betweenAccounts: 'Между аккаунтами',
    sourceAccount: 'ИСТОЧНИК', amount: 'СУММА',
    receiveAs: 'ПОЛУЧИТЬ КАК', destAddress: 'АДРЕС НАЗНАЧЕНИЯ',
    direction: 'Направление', autoTransfer: 'Авто перевод',
    asterApiCreds: 'API ключи Aster',
    langEn: 'English', langRu: 'Русский', langZh: '中文',
  },

  zh: {
    trade: '交易', markets: '市场', news: '资讯', portfolio: '投资组合', transfer: '转账', swap: '兑换',
    mark: '标记', change24h: '24小时涨跌', volume24h: '24小时交易量', fundingCountdown: '资金费率 / 倒计时',
    connect: '连接', deposit: '充值', connected: '已连接',
    tracker: '追踪器', connectX: '连接 X',
    xtEmpty: '连接您的 X 帐户以查看实时新闻和相关提及',
    searchMarket: '搜索市场...',
    cross: '全仓', isolated: '逐仓', unified: '统一',
    market: '市价', limit: '限价',
    buyLong: '买入 / 做多', sellShort: '卖出 / 做空',
    availableTrade: '可用余额', currentPosition: '当前持仓',
    size: '数量', reduceOnly: '仅减仓', tpsl: '止盈 / 止损',
    liqPrice: '强平价格', orderValue: '订单价值',
    marginRequired: '所需保证金', slippage: '滑点', fee: '手续费',
    accountEquity: '账户权益', spot: '现货', perps: '合约',
    perpsOverview: '合约概览', balance: '余额', unrealizedPnl: '未实现盈亏',
    crossMarginRatio: '全仓保证金率', maintenanceMargin: '维持保证金',
    crossAccountLev: '全仓杠杆',
    orderBook: '委托挂单', price: '价格', total: '累计', spread: '价差',
    liveTrades: '实时成交', time: '时间',
    positions: '持仓', balances: '资产', openOrders: '当前委托',
    tradeHistory: '成交记录', fundingHistory: '资金费用', orderHistory: '历史委托',
    mode: '模式', positionValue: '持仓价值', entryPrice: '开仓价',
    markPrice: '标记价', pnlRoe: '盈亏 (ROE %)', liqPriceShort: '强平价',
    margin: '保证金', funding: '资金费',
    noPositions: '暂无持仓', connectBalances: '连接钱包查看余额',
    noOpenOrders: '暂无当前委托', noTradeHistory: '暂无成交记录',
    noFundingHistory: '暂无资金费用记录', noOrderHistory: '暂无历史委托',
    connecting: '连接中...', live: '在线', reconnecting: '重新连接...',
    indicators: '指标',
    depositFunds: '充值', depositSub: '任意代币 → USDC 至 Hyperliquid',
    step1: '选择源代币 (SOL, ETH, USDC, BTC...)',
    step2: '在 Phantom 中确认 — 一键操作',
    step3: 'USDC 约2分钟到账，即可交易',
    yourHlAddr: '您的 Hyperliquid 地址', connectFirst: '请先连接钱包',
    directDeposit: '直接充值 USDC',
    sendToAddr: '发送到上方地址 HyperEVM (chain ID 998)',
    basicTitle: 'RDO ONE x HYPE x LI.FI', extraTitle: 'RDO ONE x ASTER x LI.FI',
    basicLev: '最高40倍杠杆', extraLev: '最高200倍杠杆',
    basicDesc: '加密合约 / 非托管 / 任意抵押品',
    extraDesc: '加密合约 / 混合托管 / 任意抵押品',
    basicFee: 'Taker 0.045% / Maker 0.015%', extraFee: 'Taker 0.04% / Maker 0%',
    basicExtra: '最佳流动性 / 平均价差 0.0015%',
    extraExtra: '最高杠杆 / 最低费率',
    lastPrice: '最新价', change24hShort: '24小时涨跌', funding8h: '8小时费率',
    volume: '成交量', openInterest: '未平仓量',
    marketOverview: '市场概览', marketCap: '总市值', tradingVol24h: '24小时交易量',
    btcDominance: 'BTC 占比', fearGreed: '恐惧与贪婪', marketStats: '市场统计',
    trending: '热门', topGainers: '涨幅榜 (24小时)', converter: '换算器',
    topByMcap: '市值前20', search: '搜索',
    name: '名称', change7d: '7日 %',
    cryptoNews: '加密资讯', refresh: '刷新', loadMore: '加载更多',
    connectPhantom: '连接 Phantom 钱包',
    connectPhantomSub: '查看 Solana 资产、充值、兑换和转换。',
    totalPortfolio: '投资组合总值', disconnect: '断开连接',
    asset: '资产', value: '价值', convert: '转换',
    traderPnl: '交易盈亏', pnlCalendar: '盈亏日历',
    totalRealizedPnl: '已实现盈亏', winRate: '胜率', totalTrades: '总交易数',
    avgHoldTime: '平均持仓时间', bestTrade: '最佳交易', worstTrade: '最差交易',
    cumulativePnl: '累计盈亏', pnlDistribution: '盈亏分布',
    recentClosedTrades: '最近平仓记录', perpsPortfolio: '合约资产',
    depositToPerps: '充值到合约', connectEvmWallet: '连接 EVM 钱包',
    transferTitle: '转账',
    transferSub: '提现任意币种 · 发送到任意地址 · 账户间转账',
    withdraw: '提现', send: '发送', betweenAccounts: '账户间转账',
    sourceAccount: '源账户', amount: '金额',
    receiveAs: '接收为', destAddress: '目标地址',
    direction: '方向', autoTransfer: '自动转账',
    asterApiCreds: 'Aster API 密钥',
    langEn: 'English', langRu: 'Русский', langZh: '中文',
  },
} as const;

type Dict = typeof T.en;
export type TranslationKey = keyof Dict;

function readStoredLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem('rdo-lang');
  return stored === 'ru' || stored === 'zh' || stored === 'en' ? stored : 'en';
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const setLang = useCallback((next: Lang) => {
    if (!T[next]) return;
    setLangState(next);
    window.localStorage.setItem('rdo-lang', next);
  }, []);

  const t = useCallback((key: TranslationKey) => T[lang]?.[key] ?? T.en[key] ?? key, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider');
  return ctx;
}
