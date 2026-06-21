// Usage: bun run scripts/verify-proof.ts <publicBlobId> [aggregatorUrl]
//
// Independently verifies a Sheka AI-analysis proof: fetches the public blob from
// the Walrus aggregator, recomputes SHA-256 over its canonical contents, and checks
// it matches the embedded `content_sha256`. Self-contained on purpose — it mirrors
// the backend's hashing exactly (see backend/src/domains/analysis/service.ts), so a
// judge can copy just this one file and confirm an analysis was never altered.
//
// Exit code 0 = verified, 2 = mismatch/missing hash, 1 = usage/fetch error.

import { createHash } from 'node:crypto';

// Stable JSON: recursively sorted keys, undefined values dropped. MUST match the
// backend `canonicalize` byte-for-byte.
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

const blobId = process.argv[2];
const aggregator = (process.argv[3] ?? 'https://aggregator.walrus-testnet.walrus.space').replace(
  /\/$/,
  '',
);

if (!blobId) {
  console.error('usage: bun run scripts/verify-proof.ts <publicBlobId> [aggregatorUrl]');
  process.exit(1);
}

const res = await fetch(`${aggregator}/v1/blobs/${blobId}`);
if (!res.ok) {
  console.error(`Walrus fetch failed: HTTP ${res.status}`);
  process.exit(1);
}

const proof = (await res.json()) as Record<string, unknown> & { content_sha256?: string };
const { content_sha256, ...rest } = proof;
const recomputed = sha256Hex(canonicalize(rest));
const verified = Boolean(content_sha256) && recomputed === content_sha256;

console.log(
  JSON.stringify(
    {
      blob_id: blobId,
      stored_sha256: content_sha256 ?? null,
      recomputed_sha256: recomputed,
      verified,
      market: proof.market,
      model: proof.model,
    },
    null,
    2,
  ),
);

process.exit(verified ? 0 : 2);
