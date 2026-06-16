import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const soccerAthletes = pgTable('soccer_athletes', {
  id: uuid('id').primaryKey().defaultRandom(),
  espnAthleteId: text('espn_athlete_id').notNull(),
  athleteName: text('athlete_name').notNull(),
  teamAbbreviation: text('team_abbreviation'),
  position: text('position'),
  season: text('season').notNull(),
  statSummary: text('stat_summary').notNull(),
  rawJson: text('raw_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SoccerAthlete = typeof soccerAthletes.$inferSelect;
export type NewSoccerAthlete = typeof soccerAthletes.$inferInsert;
