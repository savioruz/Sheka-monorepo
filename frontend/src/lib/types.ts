export interface TeamSummary {
	espn_id: string;
	display_name: string;
	abbreviation: string;
	score: number | null;
}

export interface GameVenue {
	name: string;
	city: string | null;
}

export interface Game {
	espn_event_id: string;
	sport: string;
	league: string;
	name: string;
	short_name: string;
	status: string;
	scheduled_at: string;
	period: number | null;
	clock: string | null;
	home_team: TeamSummary;
	away_team: TeamSummary;
	venue: GameVenue | null;
}

export interface GamesResponse {
	games: Game[];
	fetched_at: string;
}

export interface AuthNonceResponse {
	nonce: string;
	expires_at: string;
}

export interface AuthVerifyRequest {
	address: string;
	nonce: string;
	signature: string;
	zk_proof?: unknown;
}

export interface AuthVerifyResponse {
	session_token: string;
	wallet_address: string;
	expires_at: string;
}

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public body?: unknown
	) {
		super(message);
		this.name = 'ApiError';
	}
}
