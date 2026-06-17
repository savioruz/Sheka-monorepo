import { getNews, type NewsItem } from '$lib/features/news';
import type { PageMeta } from '$lib/metadata';
import type { PageLoad } from './$types';

const PER_PAGE = 12;

export const load: PageLoad = async ({ url }) => {
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const q = url.searchParams.get('q')?.trim() ?? '';
	const sport = url.searchParams.get('sport')?.trim() ?? '';
	const league = url.searchParams.get('league')?.trim() ?? '';

	let articles: NewsItem[] = [];
	let total = 0;
	try {
		const res = await getNews((page - 1) * PER_PAGE, PER_PAGE, {
			search: q || undefined,
			sport: sport || undefined,
			league: league || undefined
		});
		articles = res.articles;
		total = res.total;
	} catch {
		// best-effort: render the empty state if ESPN upstream is down
	}

	const meta: PageMeta = {
		title: q ? `News · “${q}”` : 'News',
		description: 'Latest sports news across leagues — search and browse.'
	};

	return { articles, total, page, q, sport, league, perPage: PER_PAGE, meta };
};
