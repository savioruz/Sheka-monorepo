import { describe, expect, it } from 'vitest';
import { marketTab } from './market';

const NOW = Date.parse('2026-06-15T12:00:00Z');
const SOON_H = 3;
const WINDOW_D = 7;
const at = (iso: string | null, status = 'open') => ({ scheduled_at: iso, status });
const tab = (m: { scheduled_at: string | null; status: string }) =>
	marketTab(m, NOW, SOON_H, WINDOW_D);

describe('marketTab', () => {
	it('resolved status → resolved (regardless of time)', () => {
		expect(tab(at('2026-06-15T18:00:00Z', 'resolved'))).toBe('resolved');
	});

	it('kickoff in the past & open → live', () => {
		expect(tab(at('2026-06-15T11:00:00Z'))).toBe('live');
	});

	it('kickoff within soon-window → starting_soon', () => {
		expect(tab(at('2026-06-15T14:00:00Z'))).toBe('starting_soon'); // +2h
	});

	it('kickoff beyond soon but within window → upcoming', () => {
		expect(tab(at('2026-06-17T12:00:00Z'))).toBe('upcoming'); // +2d
	});

	it('kickoff beyond window → hidden', () => {
		expect(tab(at('2026-07-05T12:00:00Z'))).toBe('hidden'); // +20d (e.g. fifa.world placeholder)
	});

	it('null kickoff & open → upcoming (shown undated)', () => {
		expect(tab(at(null))).toBe('upcoming');
	});

	it('boundary: exactly at soon edge → starting_soon', () => {
		expect(tab(at('2026-06-15T15:00:00Z'))).toBe('starting_soon'); // +3h exactly
	});
});
