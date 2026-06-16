import { request, unwrap } from '$lib/api';
import type { GamesResponse } from '$lib/types';
import type { Market, Model, NewsArticle } from './market';

export async function getGames(sport?: string): Promise<GamesResponse> {
	const query = sport ? `?sport=${encodeURIComponent(sport)}` : '';
	const response = await request<{ data: GamesResponse }>(`/api/games${query}`);
	return unwrap(response);
}

export async function getMarkets(): Promise<{ markets: Market[] }> {
	const response = await request<{ data: { markets: Market[] } }>('/api/markets');
	return unwrap(response);
}

export async function getModels(): Promise<{ models: Model[] }> {
	const response = await request<{ data: { models: Model[] } }>('/api/models');
	return unwrap(response);
}

export async function getMarket(id: string): Promise<{ market: Market }> {
	const response = await request<{ data: { market: Market } }>(
		`/api/markets/${encodeURIComponent(id)}`
	);
	return unwrap(response);
}

export async function getMarketNews(id: string): Promise<{ articles: NewsArticle[] }> {
	const response = await request<{ data: { articles: NewsArticle[] } }>(
		`/api/markets/${encodeURIComponent(id)}/news`
	);
	return unwrap(response);
}
