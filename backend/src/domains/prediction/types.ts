// Sport is an open string (e.g. 'basketball', 'football', 'soccer', ...) so new
// sports/leagues seeded on the ESPN service flow through without code changes.
export type Sport = string;
export type ConfidenceTier = 'low' | 'medium' | 'high';

export interface InjuryEntry {
  athleteEspnId: string;
  athleteName: string;
  status: string;
  position?: string;
  injuryType?: string;
  returnDate?: string;
  description?: string;
}

export interface StatEntry {
  athleteEspnId: string;
  athleteName: string;
  statSummary: string;
}

export interface NewsArticle {
  headline: string;
  description?: string;
  published?: string;
}

export interface TeamSnapshot {
  espnId: string;
  displayName: string;
  abbreviation: string;
  logo?: string;
  score: number | null;
  injuries: InjuryEntry[];
  keyStats: StatEntry[];
}

export interface VenueSnapshot {
  name: string;
  city: string | null;
  isIndoor?: boolean;
}

export interface GameSnapshot {
  eventId: string;
  sport: Sport;
  league: string;
  scheduledAt: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled';
  statusDetail?: string;
  period: number | null;
  clock: string | null;
  venue: VenueSnapshot | null;
  homeTeam: TeamSnapshot;
  awayTeam: TeamSnapshot;
  recentNews: NewsArticle[];
  fetchedAt: string;
}

export interface AnalystResult {
  homeWinProbability: number;
  // 3-way distribution (home/draw/away), normalised to sum 1.
  drawProbability: number;
  awayWinProbability: number;
  confidenceTier: ConfidenceTier;
  reasoning: string;
  skip: boolean;
  rawResponse?: string;
  error?: string;
}

export interface KellyResult {
  p: number;
  b: number;
  q: number;
  fStar: number;
  edge: boolean;
}
