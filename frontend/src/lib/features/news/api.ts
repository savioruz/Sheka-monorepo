import { request, unwrap } from '$lib/api';

export interface NewsItem {
	id: number | null;
	headline: string;
	description: string;
	published: string | null;
	thumbnail: string | null;
	type: string | null;
	league: string | null;
	sport: string | null;
}

export interface NewsDetail extends NewsItem {
	image: string | null;
	url: string | null;
}

export interface NewsFilters {
	search?: string;
	sport?: string;
	league?: string;
}

/**
 * Recent ESPN news (newest-first), paginated. `filters` (search/sport/league)
 * are forwarded server-side. `total` is the full filtered count, for paging.
 */
export async function getNews(
	offset = 0,
	limit = 8,
	filters: NewsFilters = {}
): Promise<{ articles: NewsItem[]; hasMore: boolean; total: number }> {
	const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
	if (filters.search) params.set('search', filters.search);
	if (filters.sport) params.set('sport', filters.sport);
	if (filters.league) params.set('league', filters.league);
	const response = await request<{
		data: { articles: NewsItem[]; has_more: boolean; total: number };
	}>(`/api/news?${params.toString()}`);
	const { articles, has_more, total } = unwrap(response);
	return { articles, hasMore: has_more, total };
}

/** Full detail for one article (adds image + outbound ESPN link). */
export async function getNewsDetail(id: string | number): Promise<NewsDetail> {
	const response = await request<{ data: { article: NewsDetail } }>(`/api/news/${id}`);
	return unwrap(response).article;
}
