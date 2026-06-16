import { request, unwrap } from '$lib/api';

export interface NewsItem {
	headline: string;
	description: string;
	published: string | null;
	thumbnail: string | null;
	type: string | null;
	league: string | null;
	sport: string | null;
}

/** Recent ESPN news across all leagues (newest-first) for the home-page feed. */
export async function getNews(limit?: number): Promise<{ articles: NewsItem[] }> {
	const query = limit ? `?limit=${limit}` : '';
	const response = await request<{ data: { articles: NewsItem[] } }>(`/api/news${query}`);
	return unwrap(response);
}
