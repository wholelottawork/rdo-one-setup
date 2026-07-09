const T: Record<string, Record<string, string>> = {
  en: {
    trade: 'Trade', markets: 'Markets', news: 'News', portfolio: 'Portfolio', transfer: 'Transfer',
    mark: 'Mark', change24h: '24h Change', volume24h: '24h Volume', fundingCountdown: 'Funding / Countdown',
    connect: 'Connect', deposit: 'DEPOSIT', connected: 'Connected',
    tracker: 'Tracker', connectX: 'Connect X',
    xtEmpty: 'Connect your X account to see real-time news and mentions for',
    searchMarket: 'Search market...',
    cross: 'Cross', isolated: 'Isolated', unified: 'Unified',
    market: 'Market', limit: 'Limit',
    buyLong: 'Buy / Long', sellShort: 'Sell / Short',
    availableTrade: 'Available to Trade', currentPosition: 'Current Position',
    size: 'Size', reduceOnly: 'Reduce Only', tpsl: 'Take Profit / Stop Loss',
    liqPrice: 'Liquidation Price', orderValue: 'Order Value',
    marginRequired: 'Margin Required', slippage: 'Slippage', fee: 'Fee',
    accountEquity: 'Account Equity', spot: 'Spot', perps: 'Perps',
    perpsOverview: 'Perps Overview', balance: 'Balance', unrealizedPnl: 'Unrealized PnL',
    crossMarginRatio: 'Cross Margin Ratio', maintenanceMargin: 'Maintenance Margin',
    crossAccountLev: 'Cross Account Leverage',
    orderBook: 'Order Book', price: 'Price', total: 'Total', spread: 'Spread',
    liveTrades: 'Live Trades', time: 'Time',
    positions: 'Positions', balances: 'Balances', openOrders: 'Open Orders',
    tradeHistory: 'Trade History', fundingHistory: 'Funding History', orderHistory: 'Order History',
    mode: 'Mode', positionValue: 'Position Value', entryPrice: 'Entry Price',
    markPrice: 'Mark Price', pnlRoe: 'PNL (ROE %)', liqPriceShort: 'Liq. Price',
    margin: 'Margin', funding: 'Funding',
    noPositions: 'No open positions yet', connectBalances: 'Connect wallet to view balances',
    noOpenOrders: 'No open orders', noTradeHistory: 'No trade history',
    noFundingHistory: 'No funding history', noOrderHistory: 'No order history',
    connecting: 'CONNECTING...', live: 'LIVE', reconnecting: 'RECONNECTING...',
    indicators: 'Indicators',
    depositFunds: 'DEPOSIT FUNDS', depositSub: 'Swap any token → USDC on Hyperliquid',
    step1: 'Pick source token (SOL, ETH, USDC, BTC...)',
    step2: 'Approve in Phantom — one tap',
    step3: 'USDC arrives in ~2 min, ready to trade',
    yourHlAddr: 'Your Hyperliquid address', connectFirst: 'Connect wallet first',
    directDeposit: 'Direct USDC deposit',
    sendToAddr: 'Send to address above on HyperEVM (chain ID 998)',
    basicTitle: 'RDO ONE x HYPE x LI.FI', extraTitle: 'RDO ONE x ASTER x LI.FI',
    basicLev: 'Up to 40x leverage', extraLev: 'Up to 200x leverage',
    basicDesc: 'Crypto perps only / Non-custodial / Any collateral',
    extraDesc: 'Crypto perps only / Hybrid-custodial / Any collateral',
    basicFee: 'Taker fee 0.045% / Maker 0.015%', extraFee: 'Taker fee 0.04% / Maker 0%',
    basicExtra: 'The best liquidity / Average 0.0015% spreads',
    extraExtra: 'Higher leverage level / Best fee rates',
    lastPrice: 'Last Price', change24hShort: '24h Change', funding8h: '8h Funding',
    volume: 'Volume', openInterest: 'Open Interest',
    marketOverview: 'Market Overview', marketCap: 'Market Cap', tradingVol24h: '24h Trading Volume',
    btcDominance: 'BTC Dominance', fearGreed: 'Fear & Greed', marketStats: 'Market Statistics',
    trending: 'Trending', topGainers: 'Top Gainers (24h)', converter: 'Converter',
    topByMcap: 'Top 20 by Market Cap', search: 'Search', name: 'Name', change7d: '7d %',
    cryptoNews: 'Crypto News', refresh: 'Refresh', loadMore: 'Load More',
    connectPhantom: 'Connect your Phantom wallet',
    connectPhantomSub: 'View your Solana holdings, deposit, swap, and convert assets.',
    totalPortfolio: 'Total Portfolio Value', disconnect: 'Disconnect',
    asset: 'Asset', value: 'Value', swap: 'Swap', convert: 'Convert',
    traderPnl: 'TRADER PNL', pnlCalendar: 'PNL CALENDAR',
    totalRealizedPnl: 'Total Realized PnL', winRate: 'Win Rate', totalTrades: 'Total Trades',
    avgHoldTime: 'Avg Hold Time', bestTrade: 'Best Trade', worstTrade: 'Worst Trade',
    cumulativePnl: 'Cumulative PnL', pnlDistribution: 'PnL Distribution',
    recentClosedTrades: 'Recent Closed Trades', perpsPortfolio: 'Perps Portfolio',
    depositToPerps: 'Deposit to Perps', connectEvmWallet: 'Connect EVM Wallet',
    transferTitle: 'TRANSFER',
    transferSub: 'Withdraw in any currency · Send to any address · Move between accounts',
    withdraw: 'Withdraw', send: 'Send', betweenAccounts: 'Between Accounts',
    sourceAccount: 'SOURCE ACCOUNT', amount: 'AMOUNT',
    receiveAs: 'RECEIVE AS', destAddress: 'DESTINATION ADDRESS',
    direction: 'Direction', autoTransfer: 'Auto Transfer',
    asterApiCreds: 'Aster API credentials',
    langEn: 'English', langRu: 'Русский', langZh: '中文',
  },
  ru: {
    trade: 'Торговля', markets: 'Рынки', news: 'Новости', portfolio: 'Портфель', transfer: 'Перевод',
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
    topByMcap: 'Топ 20 по капитализации', search: 'Поиск', name: 'Название', change7d: '7д %',
    cryptoNews: 'Крипто новости', refresh: 'Обновить', loadMore: 'Показать ещё',
    connectPhantom: 'Подключите кошелёк Phantom',
    connectPhantomSub: 'Просмотр активов Solana, депозит, обмен и конвертация.',
    totalPortfolio: 'Общая стоимость портфеля', disconnect: 'Отключить',
    asset: 'Актив', value: 'Стоимость', swap: 'Обмен', convert: 'Конвертация',
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
    trade: '交易', markets: '市场', news: '资讯', portfolio: '投资组合', transfer: '转账',
    langEn: 'English', langRu: 'Русский', langZh: '中文',
  },
};

let currentLang = 'en';
if (typeof window !== 'undefined') {
  currentLang = localStorage.getItem('rdo-lang') || 'en';
}

export function t(key: string): string {
  return T[currentLang]?.[key] ?? T.en[key] ?? key;
}

export function getLang(): string { return currentLang; }

export function setLang(lang: string): void {
  if (!T[lang]) return;
  currentLang = lang;
  if (typeof window !== 'undefined') localStorage.setItem('rdo-lang', lang);
  applyTranslations();
}

export function applyTranslations(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = (el as HTMLElement).dataset.i18n!;
    if (el.tagName === 'INPUT' && (el as HTMLElement).dataset.i18nAttr === 'placeholder') {
      (el as HTMLInputElement).placeholder = t(key);
    } else {
      el.textContent = t(key);
    }
  });
}
