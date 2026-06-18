/**
 * Best-effort JSON extraction from an LLM completion.
 *
 * Models intermittently wrap their JSON in prose ("Here is the analysis: {…}")
 * or markdown fences even when asked not to. Parsing only the raw string then
 * fails on those (otherwise-valid) responses. This tries, in order:
 *   1. the trimmed string as-is,
 *   2. the contents of a ```json … ``` (or bare ``` … ```) fence,
 *   3. the substring from the first `{` to the last `}`.
 * Returns the parsed value, or null if none of the strategies yield valid JSON.
 */
export function parseJsonLoose(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      /* fall through */
    }
  }

  return null;
}
