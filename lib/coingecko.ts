export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
}

export interface GlobalData {
  total_market_cap?: { usd?: number };
  total_volume?: { usd?: number };
  market_cap_percentage?: { btc?: number };
  market_cap_change_percentage_24h_usd?: number;
}

export interface TrendingCoin {
  item: {
    name: string;
    symbol: string;
    small?: string;
    thumb?: string;
    data?: { price?: number; price_change_percentage_24h?: { usd?: number } };
  };
}

export async function cgGlobal(): Promise<GlobalData | null> {
  try {
    const res = await fetch('/api/coingecko/api/v3/global');
    const json = await res.json();
    return json?.data ?? null;
  } catch {
    return null;
  }
}

export async function cgTrending(): Promise<TrendingCoin[]> {
  try {
    const res = await fetch('/api/coingecko/api/v3/search/trending');
    const json = await res.json();
    return json?.coins ?? [];
  } catch {
    return [];
  }
}

export async function cgCoinsMarkets(): Promise<CoinMarket[]> {
  try {
    const res = await fetch(
      '/api/coingecko/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=7d,24h',
    );
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}
