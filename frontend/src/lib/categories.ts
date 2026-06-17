import { leagueLabel, sportEmoji, titleCaseSport } from '$lib/utils';

export interface SportLeague {
	slug: string;
	label: string;
}

export interface SportCategory {
	sport: string;
	label: string;
	emoji: string;
	leagues: SportLeague[];
}

// Curated Sport → League tree, shared by the news filter and the markets sidebar.
// Slugs match ESPN's `sport`/`league` params; labels reuse the shared label maps.
const TREE: Record<string, string[]> = {
	soccer: [
		'fifa.world',
		'uefa.champions',
		'uefa.europa',
		'eng.1',
		'esp.1',
		'ger.1',
		'ita.1',
		'fra.1',
		'usa.1'
	],
	football: ['nfl'],
	basketball: ['nba', 'wnba'],
	baseball: ['mlb'],
	hockey: ['nhl']
};

export const SPORT_CATEGORIES: SportCategory[] = Object.entries(TREE).map(([sport, leagues]) => ({
	sport,
	label: titleCaseSport(sport),
	emoji: sportEmoji(sport),
	leagues: leagues.map((slug) => ({ slug, label: leagueLabel(slug) }))
}));
