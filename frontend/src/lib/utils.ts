import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Game } from './types';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

function statusRank(status: string): number {
	if (status === 'in_progress') return 0; // Live
	if (status === 'scheduled') return 1; // Upcoming
	return 2; // Finished / other
}

/** Order games: Live → Upcoming (soonest first) → Finished (most recent first). */
export function compareGames(a: Game, b: Game): number {
	const ra = statusRank(a.status);
	const rb = statusRank(b.status);
	if (ra !== rb) return ra - rb;
	const ta = new Date(a.scheduled_at).getTime();
	const tb = new Date(b.scheduled_at).getTime();
	return ra === 2 ? tb - ta : ta - tb;
}

export function titleCaseSport(sport: string): string {
	return sport.charAt(0).toUpperCase() + sport.slice(1);
}

const SPORT_EMOJI: Record<string, string> = {
	football: '🏈',
	basketball: '🏀',
	soccer: '⚽',
	baseball: '⚾',
	hockey: '🏒',
	golf: '⛳',
	tennis: '🎾',
	racing: '🏎️'
};

export function sportEmoji(sport: string): string {
	return SPORT_EMOJI[sport] ?? '🏅';
}

// League slug → display name (from Public-ESPN-API/README.md "Common League Slugs").
const LEAGUE_LABELS: Record<string, string> = {
	// Football
	nfl: 'NFL',
	'college-football': 'College Football',
	cfl: 'CFL',
	ufl: 'UFL',
	xfl: 'XFL',
	// Basketball
	nba: 'NBA',
	wnba: 'WNBA',
	'nba-development': 'NBA G League',
	'mens-college-basketball': "NCAA Men's Basketball",
	'womens-college-basketball': "NCAA Women's Basketball",
	nbl: 'NBL',
	fiba: 'FIBA World Cup',
	// Baseball
	mlb: 'MLB',
	'college-baseball': 'NCAA Baseball',
	'world-baseball-classic': 'World Baseball Classic',
	'dominican-winter-league': 'Dominican Winter League',
	// Hockey
	nhl: 'NHL',
	'mens-college-hockey': "NCAA Men's Hockey",
	'womens-college-hockey': "NCAA Women's Hockey",
	// Soccer
	'fifa.world': 'FIFA World Cup',
	'uefa.champions': 'UEFA Champions League',
	'eng.1': 'Premier League',
	'esp.1': 'LALIGA',
	'ger.1': 'Bundesliga',
	'ita.1': 'Serie A',
	'fra.1': 'Ligue 1',
	'usa.1': 'MLS',
	'mex.1': 'Liga MX',
	'usa.nwsl': 'NWSL',
	'uefa.europa': 'UEFA Europa League',
	'fifa.wwc': "FIFA Women's World Cup",
	// Golf / Racing / Tennis
	pga: 'PGA TOUR',
	lpga: 'LPGA',
	f1: 'Formula 1',
	atp: 'ATP',
	wta: 'WTA'
};

export function leagueLabel(slug: string): string {
	if (LEAGUE_LABELS[slug]) return LEAGUE_LABELS[slug];
	// Fallback: prettify unknown slugs ("some.league-name" → "Some League Name").
	return slug
		.replace(/[._-]/g, ' ')
		.split(' ')
		.filter(Boolean)
		.map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
		.join(' ');
}

export type GameStatusGroup = 'live' | 'upcoming' | 'finished';

export function gameStatusGroup(status: string): GameStatusGroup {
	if (status === 'in_progress') return 'live';
	if (status === 'scheduled') return 'upcoming';
	return 'finished';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
