import type { Config } from '@config/config';
import { parseJsonLoose } from '@infras/llm/parse-json';
import OpenAI from 'openai';
import type { AnalystResult, GameSnapshot } from './types';

export interface AnalystDeps {
  config: Config;
}

const SYSTEM_PROMPT = `You are a sports prediction analyst. For each game, estimate the probability of each of the three outcomes — home win, draw, away win — using the context provided (teams, score, injuries, key player stats, recent news, venue).

Weigh the signals deliberately:
- Key-player availability is high-impact: an "out" or "ir" star hurts a team far more than a depth player or a "questionable"/"day_to_day" tag. Account for injuries on BOTH sides.
- Recent news/form: read the headlines and descriptions for momentum, lineup or managerial changes, and off-field issues; ignore stale or off-topic items.
- Home advantage and matchup context (league, group vs knockout, current score if the game is live).
Only assign "high" confidence when multiple independent signals agree.

Return a JSON object with exactly these fields and no other text:
- "home_win_probability": number between 0 and 1
- "draw_probability": number between 0 and 1 (use 0 for sports/competitions where a draw is impossible, e.g. NBA/NFL or knockout matches)
- "away_win_probability": number between 0 and 1
- "confidence_tier": one of "low", "medium", "high"
- "reasoning": string, max 60 words (~400 characters) — a tight rationale citing the specific signals (injuries, news, form, venue) that drove your estimate. Finish your sentences; do not get cut off.

The three probabilities should sum to approximately 1.

Confidence guidelines:
- "low": insufficient data, very close matchup, or high uncertainty
- "medium": a moderate edge detectable from records/form/availability
- "high": strong signal where records, form, availability, and context align

Return JSON only, no markdown, no preamble.`;

// Streaming variant: prose first (streams like a chat), then a delimiter + the
// compact machine-readable JSON. The prose IS the reasoning shown to the user.
const STREAM_DELIM = '===JSON===';
const SYSTEM_PROMPT_STREAM = `You are a sports prediction analyst estimating the probability of each outcome — home win, draw, away win — from the context provided (teams, score, injuries, key player stats, recent news, venue).

First, write a concise rationale (max ~60 words) citing the specific signals (injuries on both sides, news/form, home advantage, current score) that drive your estimate. Finish your sentences. Only claim "high" confidence when multiple independent signals agree.

Then output a line containing exactly:
${STREAM_DELIM}
followed by a single-line JSON object and nothing after it:
{"home_win_probability": <0..1>, "draw_probability": <0..1, use 0 if a draw is impossible>, "away_win_probability": <0..1>, "confidence_tier": "low"|"medium"|"high"}
The three probabilities should sum to approximately 1.`;

export function createAnalyst(deps: AnalystDeps) {
  const { config } = deps;

  const client = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:3001',
      'X-Title': 'Sheka',
    },
  });

  function buildUserPrompt(game: GameSnapshot): string {
    const fmtInjuries = (injuries: GameSnapshot['homeTeam']['injuries']) =>
      injuries
        .map((i) => {
          const who = i.position ? `${i.athleteName} (${i.position})` : i.athleteName;
          const detail = [i.injuryType, i.returnDate ? `expected back ${i.returnDate}` : '']
            .filter(Boolean)
            .join('; ');
          return `- ${who}: ${i.status}${detail ? ` — ${detail}` : ''}`;
        })
        .join('\n') || '- None';
    const homeInjuries = fmtInjuries(game.homeTeam.injuries);
    const awayInjuries = fmtInjuries(game.awayTeam.injuries);
    const homeStats =
      game.homeTeam.keyStats.map((s) => `- ${s.athleteName}: ${s.statSummary}`).join('\n') ||
      '- None';
    const awayStats =
      game.awayTeam.keyStats.map((s) => `- ${s.athleteName}: ${s.statSummary}`).join('\n') ||
      '- None';

    return `Game: ${game.homeTeam.displayName} (home) vs ${game.awayTeam.displayName} (away)
Sport: ${game.sport}
League: ${game.league}
Status: ${game.status}${game.statusDetail ? ` (${game.statusDetail})` : ''}
Start time: ${game.scheduledAt}
Current score: ${game.homeTeam.score ?? 0}-${game.awayTeam.score ?? 0}
Period: ${game.period ?? 'N/A'}
Clock: ${game.clock ?? 'N/A'}
Venue: ${game.venue ? `${game.venue.name}${game.venue.city ? `, ${game.venue.city}` : ''}` : 'N/A'}
Home injuries:
${homeInjuries}
Away injuries:
${awayInjuries}
Home key stats:
${homeStats}
Away key stats:
${awayStats}
Recent news:
${
  game.recentNews.length > 0
    ? game.recentNews
        .map((n) => (n.description ? `- ${n.headline} — ${n.description}` : `- ${n.headline}`))
        .join('\n')
    : '- None'
}

Estimate the home team's win probability and explain your reasoning.`;
  }

  function skipResult(rawResponse?: string, error?: string): AnalystResult {
    return {
      homeWinProbability: 0,
      drawProbability: 0,
      awayWinProbability: 0,
      confidenceTier: 'low',
      reasoning: '',
      skip: true,
      rawResponse,
      error,
    };
  }

  // Normalize the 3-way probabilities + tier from a parsed object (no reasoning —
  // shared by the JSON path and the streaming path where reasoning is the prose).
  function normalizeProbsTier(obj: unknown): {
    homeWinProbability: number;
    drawProbability: number;
    awayWinProbability: number;
    confidenceTier: 'low' | 'medium' | 'high';
  } | null {
    if (typeof obj !== 'object' || obj === null) return null;
    const o = obj as Record<string, unknown>;

    const home = Number(o.home_win_probability);
    if (Number.isNaN(home) || home < 0 || home > 1) return null;

    // Draw/away are optional; derive sensible defaults when absent.
    let draw = Number(o.draw_probability);
    if (Number.isNaN(draw) || draw < 0) draw = 0;
    let away = Number(o.away_win_probability);
    if (Number.isNaN(away) || away < 0) away = Math.max(0, 1 - home - draw);

    const sum = home + draw + away;
    const [h, d, a] = sum > 0 ? [home / sum, draw / sum, away / sum] : [home, draw, away];

    const tier = o.confidence_tier;
    if (tier !== 'low' && tier !== 'medium' && tier !== 'high') return null;

    return {
      homeWinProbability: h,
      drawProbability: d,
      awayWinProbability: a,
      confidenceTier: tier,
    };
  }

  function validateResult(obj: unknown): AnalystResult | null {
    const probs = normalizeProbsTier(obj);
    if (!probs) return null;
    const reasoning = String((obj as Record<string, unknown>).reasoning ?? '');
    if (!reasoning) return null;
    return { ...probs, reasoning, skip: false };
  }

  async function analyzeGame(game: GameSnapshot, model?: string): Promise<AnalystResult> {
    try {
      const response = await client.chat.completions.create({
        model: model ?? config.openrouter.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(game) },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      });

      const raw = response.choices[0]?.message?.content?.trim() ?? '';
      if (!raw) {
        return skipResult(raw);
      }

      const parsed = parseJsonLoose(raw);
      if (parsed === null) {
        return skipResult(raw);
      }

      const validated = validateResult(parsed);
      if (!validated) {
        return skipResult(raw);
      }

      return { ...validated, rawResponse: raw };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return skipResult(undefined, message);
    }
  }

  /**
   * Streaming analysis: emits the prose reasoning token-by-token via `onReasoning`
   * (ChatGPT-style typewriter), then parses the trailing JSON for the 3-way probs +
   * tier. The prose becomes the result's `reasoning`. Returns null on failure.
   */
  async function analyzeGameStream(
    game: GameSnapshot,
    model: string | undefined,
    onReasoning: (delta: string) => void | Promise<void>,
  ): Promise<AnalystResult | null> {
    try {
      const stream = await client.chat.completions.create({
        model: model ?? config.openrouter.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_STREAM },
          { role: 'user', content: buildUserPrompt(game) },
        ],
        temperature: 0.2,
        max_tokens: 1024,
        stream: true,
      });

      let full = '';
      let emitted = 0;
      let delimFound = false;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (!delta) continue;
        full += delta;
        if (delimFound) continue;
        const at = full.indexOf(STREAM_DELIM);
        if (at !== -1) {
          if (at > emitted) await onReasoning(full.slice(emitted, at));
          emitted = at;
          delimFound = true;
        } else {
          // Hold back the last DELIM-length chars so a partial marker never leaks.
          const safeEnd = Math.max(emitted, full.length - STREAM_DELIM.length);
          if (safeEnd > emitted) {
            await onReasoning(full.slice(emitted, safeEnd));
            emitted = safeEnd;
          }
        }
      }
      if (!delimFound && full.length > emitted) await onReasoning(full.slice(emitted));

      const delimAt = full.indexOf(STREAM_DELIM);
      const prose = (delimAt === -1 ? full : full.slice(0, delimAt)).trim();
      const jsonRaw = delimAt === -1 ? full : full.slice(delimAt + STREAM_DELIM.length);
      const probs = normalizeProbsTier(parseJsonLoose(jsonRaw));
      if (!probs) return null;
      return { ...probs, reasoning: prose || 'No analysis text returned.', skip: false };
    } catch {
      return null;
    }
  }

  return { analyzeGame, analyzeGameStream };
}

export type Analyst = ReturnType<typeof createAnalyst>;
