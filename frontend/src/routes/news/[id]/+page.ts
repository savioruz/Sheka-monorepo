import { error } from '@sveltejs/kit';
import { getNewsDetail, type NewsDetail } from '$lib/features/news';
import type { PageMeta } from '$lib/metadata';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	let article: NewsDetail;
	try {
		article = await getNewsDetail(params.id);
	} catch {
		throw error(404, 'Article not found');
	}

	const meta: PageMeta = {
		title: article.headline,
		description: article.description?.slice(0, 160) || article.headline,
		image: article.image ?? undefined
	};

	return { article, meta };
};
