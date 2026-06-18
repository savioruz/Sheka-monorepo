import type { Config } from '@config/config';
import { parseJsonLoose } from '@infras/llm/parse-json';
import type { Logger } from '@infras/logger/logger';
import OpenAI from 'openai';

const CG = 'https://api.coingecko.com/api/v3';
const COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  SUI: 'sui',
  DEEP: 'deep',
};

const SYSTEM_PROMPT = `You are a calibrated quantitative crypto analyst. Estimate the probability that an asset's spot price will be AT OR ABOVE a given strike at a given expiry.

Respond ONLY with strict JSON: {"up_probability": <number 0..1>, "confidence_tier": "low"|"medium"|"high", "reasoning": "<2-3 sentences>"}.

Be humble: short-horizon crypto direction is close to a random walk. Anchor near 0.5 unless the strike is far from spot relative to the time remaining, or there is strong, persistent momentum. Never claim certainty.`;

export interface CryptoMarketData {
  price: number | null;
  change24h: number | null;
  change7d: number | null;
}

export interface CryptoAnalystResult {
  upProbability: number;
  confidenceTier: 'low' | 'medium' | 'high';
  reasoning: string;
  marketData: CryptoMarketData;
}

export function createCryptoAnalyst(deps: { config: Config; logger: Logger }) {
  const { config, logger } = deps;
  const client = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
    defaultHeaders: { 'HTTP-Referer': 'http://localhost:3001', 'X-Title': 'Sheka' },
  });
  const cgCache: Record<string, { data: CryptoMarketData; expiresAt: number }> = {};

  async function marketData(asset: string): Promise<CryptoMarketData> {
    const key = asset.toUpperCase();
    const cached = cgCache[key];
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const id = COINGECKO_ID[key] ?? asset.toLowerCase();
    try {
      const res = await fetch(
        `${CG}/coins/markets?vs_currency=usd&ids=${id}&price_change_percentage=24h,7d`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const arr = (await res.json()) as Array<{
        current_price?: number;
        price_change_percentage_24h?: number;
        price_change_percentage_7d_in_currency?: number;
      }>;
      const d = arr[0];
      const data: CryptoMarketData = {
        price: d?.current_price ?? null,
        change24h: d?.price_change_percentage_24h ?? null,
        change7d: d?.price_change_percentage_7d_in_currency ?? null,
      };
      cgCache[key] = { data, expiresAt: Date.now() + 90_000 };
      return data;
    } catch (err) {
      logger.warn(
        { asset, error: err instanceof Error ? err.message : String(err) },
        'coingecko fetch failed',
      );
      return { price: null, change24h: null, change7d: null };
    }
  }

  function validate(obj: unknown): {
    upProbability: number;
    confidenceTier: 'low' | 'medium' | 'high';
    reasoning: string;
  } | null {
    if (typeof obj !== 'object' || obj === null) return null;
    const o = obj as Record<string, unknown>;
    let p = Number(o.up_probability);
    if (Number.isNaN(p)) return null;
    p = Math.min(1, Math.max(0, p));
    const tier = o.confidence_tier;
    if (tier !== 'low' && tier !== 'medium' && tier !== 'high') return null;
    const reasoning = String(o.reasoning ?? '');
    if (!reasoning) return null;
    return { upProbability: p, confidenceTier: tier, reasoning };
  }

  // Estimate P(asset ≥ strike at expiry) from spot + recent momentum.
  async function analyze(
    input: { asset: string; spot: number | null; strike: number; expiryMs: number },
    model?: string,
  ): Promise<CryptoAnalystResult | null> {
    const md = await marketData(input.asset);
    const spot = input.spot ?? md.price;
    const hours = (input.expiryMs - Date.now()) / 3_600_000;
    const prompt = `Asset: ${input.asset}
Current spot: ${spot != null ? `$${spot}` : 'unknown'}
Strike: $${input.strike}
Time to expiry: ${hours.toFixed(1)} hours
24h change: ${md.change24h != null ? `${md.change24h.toFixed(2)}%` : 'n/a'}
7d change: ${md.change7d != null ? `${md.change7d.toFixed(2)}%` : 'n/a'}

Estimate the probability that ${input.asset} will be AT OR ABOVE $${input.strike} at expiry. Return JSON only.`;

    try {
      const response = await client.chat.completions.create({
        model: model ?? config.openrouter.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 700,
      });
      const raw = response.choices[0]?.message?.content?.trim() ?? '';
      if (!raw) return null;
      const parsed = parseJsonLoose(raw);
      if (parsed === null) return null;
      const v = validate(parsed);
      return v ? { ...v, marketData: md } : null;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'crypto analyze failed',
      );
      return null;
    }
  }

  return { analyze };
}

export type CryptoAnalyst = ReturnType<typeof createCryptoAnalyst>;
