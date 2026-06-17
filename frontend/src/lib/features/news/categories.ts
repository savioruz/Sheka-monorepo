// The curated Sport → League tree is shared (see $lib/categories). Re-exported
// here under the news-flavoured name so the /news page keeps importing it from
// the news feature.
export {
	SPORT_CATEGORIES as NEWS_CATEGORIES,
	type SportCategory as NewsCategory,
	type SportLeague as NewsLeague
} from '$lib/categories';
