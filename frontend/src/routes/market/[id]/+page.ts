import { error } from '@sveltejs/kit';
import { getMarket, getMarketNews, type NewsArticle } from '$lib/features/markets';
import type { PageMeta } from '$lib/metadata';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	let market;
	try {
		market = (await getMarket(params.id)).market;
	} catch {
		throw error(404, 'Market not found');
	}

	// News is best-effort — the page still renders if the ESPN upstream is down.
	let articles: NewsArticle[] = [];
	try {
		articles = (await getMarketNews(params.id)).articles;
	} catch {
		// news is best-effort; leave the empty list
	}

	const meta: PageMeta = {
		title: `${market.home} vs ${market.away}`,
		description: `Latest news and the prediction market for ${market.home} vs ${market.away} — ${market.league}.`
	};

	return { market, articles, meta };
};
