'use client';
import React, { useState, useEffect } from 'react';
import { Info, Users, Zap, Disc, Activity, BarChart3, Fingerprint, ShieldAlert, Globe, AlertTriangle, ExternalLink } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// CoinGecko ID mapping for Hyperliquid assets
const COINGECKO_IDS: Record<string, string> = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'SOL': 'solana',
    'HYPE': 'hyperliquid',
    'ARB': 'arbitrum',
    'TIA': 'celestia',
    'PYTH': 'pyth-network',
    'LINK': 'chainlink',
    'AVAX': 'avalanche-2',
    'DOGE': 'dogecoin',
    'SUI': 'sui',
    'WIF': 'dogwifcoin',
    'JUP': 'jupiter-exchange-solana',
    'ONDO': 'ondo-finance',
    'PENDLE': 'pendle',
    'ENA': 'ethena',
    'W': 'wormhole',
    'JTO': 'jito-governance-token',
    'SEI': 'sei-network',
    'INJ': 'injective-protocol',
    'RENDER': 'render-token',
    'FET': 'fetch-ai',
    'NEAR': 'near',
    'OP': 'optimism',
    'AAVE': 'aave',
    'MKR': 'maker',
    'MATIC': 'matic-network',
    'APT': 'aptos',
    'STX': 'blockstack',
    'ATOM': 'cosmos',
    'DOT': 'polkadot',
    'UNI': 'uniswap',
    'LTC': 'litecoin',
    'BCH': 'bitcoin-cash',
    'FIL': 'filecoin',
    'XRP': 'ripple',
    'ADA': 'cardano',
    'PEPE': 'pepe',
    'BONK': 'bonk',
};

interface TokenData {
    symbol: string;
    name: string;
    description: string;
    marketCap: number;
    fdv: number;
    totalVolume24h: number;
    circulatingSupply: number;
    totalSupply: number;
    maxSupply: number | null;
    priceChange24h: number;
    priceChange7d: number;
    priceChange30d: number;
    ath: number;
    athDate: string;
    athChangePercent: number;
    currentPrice: number;
    categories: string[];
    homepage: string;
    explorer: string;
}

function formatNumber(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '--';
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
}

function formatSupply(n: number | null | undefined, symbol: string): string {
    if (n == null || isNaN(n)) return '--';
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B ${symbol}`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M ${symbol}`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K ${symbol}`;
    return `${n.toFixed(0)} ${symbol}`;
}

export default function InstitutionalDescription({ symbol }: { symbol: string }) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<TokenData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);

            const cgId = COINGECKO_IDS[symbol.toUpperCase()];
            if (!cgId) {
                setError(`No data source mapped for ${symbol}`);
                setLoading(false);
                return;
            }

            try {
                const res = await axios.get(
                    `https://api.coingecko.com/api/v3/coins/${cgId}?localization=false&tickers=false&community_data=false&developer_data=false`,
                    { timeout: 8000 }
                );

                const coin = res.data;
                const md = coin.market_data;

                setData({
                    symbol: symbol.toUpperCase(),
                    name: coin.name,
                    description: coin.description?.en?.split('. ').slice(0, 3).join('. ') + '.' || 'No description available.',
                    marketCap: md.market_cap?.usd || 0,
                    fdv: md.fully_diluted_valuation?.usd || 0,
                    totalVolume24h: md.total_volume?.usd || 0,
                    circulatingSupply: md.circulating_supply || 0,
                    totalSupply: md.total_supply || 0,
                    maxSupply: md.max_supply,
                    priceChange24h: md.price_change_percentage_24h || 0,
                    priceChange7d: md.price_change_percentage_7d || 0,
                    priceChange30d: md.price_change_percentage_30d || 0,
                    ath: md.ath?.usd || 0,
                    athDate: md.ath_date?.usd || '',
                    athChangePercent: md.ath_change_percentage?.usd || 0,
                    currentPrice: md.current_price?.usd || 0,
                    categories: (coin.categories || []).filter((c: string) => c && c !== 'Cryptocurrency'),
                    homepage: coin.links?.homepage?.[0] || '',
                    explorer: coin.links?.blockchain_site?.[0] || ''
                });
            } catch (e: any) {
                if (e.response?.status === 429) {
                    setError('CoinGecko rate limited. Retrying in 30s...');
                    setTimeout(fetchData, 30000);
                } else {
                    setError(`Failed to fetch data for ${symbol}`);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [symbol]);

    if (loading) return (
        <div className="h-full flex flex-col items-center justify-center gap-3 bg-black/40 animate-pulse">
            <Fingerprint className="w-8 h-8 text-blue-500/50" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">Loading {symbol} Profile...</span>
        </div>
    );

    if (error || !data) return (
        <div className="h-full flex flex-col items-center justify-center gap-3 bg-black/40 p-4">
            <AlertTriangle className="w-8 h-8 text-amber-500/50" />
            <span className="text-[10px] font-bold text-amber-500/80 text-center">{error || 'No data available'}</span>
        </div>
    );

    const supplyPercent = data.totalSupply > 0 ? (data.circulatingSupply / data.totalSupply) * 100 : 0;
    const athDrawdown = data.athChangePercent;

    return (
        <div className="h-full flex flex-col p-4 font-mono select-none overflow-y-auto scrollbar-hide">
            {/* Header: Token Identity */}
            <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
                <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-center justify-center">
                    <Disc className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                    <h2 className="text-sm font-black text-white flex items-center gap-1.5 uppercase">
                        {data.name} <span className="text-gray-500 font-mono text-[10px]">({data.symbol})</span>
                        <span className="bg-blue-500 text-black text-[9px] px-1 rounded-sm ml-1">LIVE</span>
                    </h2>
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Terminal Asset Profile (DES)</p>
                </div>
                <div className="text-right">
                    <div className="text-sm font-black text-white">${data.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
                    <div className={`text-[10px] font-bold ${data.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {data.priceChange24h >= 0 ? '+' : ''}{data.priceChange24h.toFixed(2)}% (24h)
                    </div>
                </div>
            </div>

            {/* Description Block */}
            <div className="mb-6">
                <p className="text-[11px] text-gray-400 leading-relaxed italic border-l-2 border-blue-500/50 pl-3 line-clamp-3">
                    &quot;{data.description.replace(/<[^>]*>/g, '').substring(0, 300)}&quot;
                </p>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                        <BarChart3 className="w-3 h-3 text-blue-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Market Cap</span>
                    </div>
                    <span className="text-xs text-white font-bold">{formatNumber(data.marketCap)}</span>
                </div>
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                        <Activity className="w-3 h-3 text-emerald-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">FDV</span>
                    </div>
                    <span className="text-xs text-white font-bold">{formatNumber(data.fdv)}</span>
                </div>
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                        <Zap className="w-3 h-3 text-purple-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">24h Volume</span>
                    </div>
                    <span className="text-xs text-white font-bold">{formatNumber(data.totalVolume24h)}</span>
                </div>
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                        <ShieldAlert className="w-3 h-3 text-amber-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">ATH Drawdown</span>
                    </div>
                    <span className={`text-xs font-bold ${athDrawdown > -20 ? 'text-emerald-400' : athDrawdown > -50 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {athDrawdown.toFixed(1)}%
                    </span>
                </div>
            </div>

            {/* Supply Analytics */}
            <div className="space-y-4 mb-6">
                <div className="flex flex-col">
                    <div className="flex justify-between items-end mb-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Circulating Supply</span>
                        <span className="text-[10px] text-blue-400 font-bold">{formatSupply(data.circulatingSupply, data.symbol)}</span>
                    </div>
                    <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(supplyPercent, 100)}%` }} />
                    </div>
                    <div className="flex justify-between mt-1">
                        <span className="text-[8px] text-gray-600">{supplyPercent.toFixed(1)}% of total</span>
                        <span className="text-[8px] text-gray-600">Total: {formatSupply(data.totalSupply, data.symbol)}</span>
                    </div>
                </div>
            </div>

            {/* Price Performance Grid */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-6">
                <h3 className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-blue-400" />
                    Price Performance
                </h3>
                <div className="space-y-2.5">
                    <div className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">24 Hour</span>
                        <span className={`font-black ${data.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {data.priceChange24h >= 0 ? '+' : ''}{data.priceChange24h.toFixed(2)}%
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">7 Day</span>
                        <span className={`font-black ${data.priceChange7d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {data.priceChange7d >= 0 ? '+' : ''}{data.priceChange7d.toFixed(2)}%
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">30 Day</span>
                        <span className={`font-black ${data.priceChange30d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {data.priceChange30d >= 0 ? '+' : ''}{data.priceChange30d.toFixed(2)}%
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] pt-2 border-t border-white/5">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">All Time High</span>
                        <span className="text-blue-400 font-black">
                            ${data.ath.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                    </div>
                </div>
            </div>

            {/* Tags & Ecosystem */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-white/5">
                {data.categories.slice(0, 5).map((tag) => (
                    <div key={tag} className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-white/5 border border-white/10 px-2 py-1 rounded text-gray-400">
                        <Globe className="w-2.5 h-2.5" />
                        {tag}
                    </div>
                ))}
                {data.homepage && (
                    <a href={data.homepage} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded text-blue-400 hover:bg-blue-500/20 transition-colors">
                        <ExternalLink className="w-2.5 h-2.5" />
                        Website
                    </a>
                )}
            </div>
        </div>
    );
}
