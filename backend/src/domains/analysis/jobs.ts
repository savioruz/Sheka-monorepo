/**
 * In-memory registry for background analysis jobs (keyed by the on-chain receipt
 * id, which is the anti-replay unit). The analyze endpoint returns immediately and
 * runs the LLM + Walrus proof in the background; the frontend polls job state.
 *
 * Single-instance only (the testnet deploy). A restart mid-job loses the entry —
 * that one poll 404s and the client retries. The FINAL result is persisted to
 * `analysis_payments`, so owned proofs still survive via GET /api/analysis/mine.
 */

export type JobStatus = 'running' | 'ready' | 'done' | 'error';

export interface AnalysisJob {
  walletAddress: string;
  status: JobStatus;
  recommendation?: unknown;
  blobId?: string | null;
  publicBlobId?: string | null;
  contentSha256?: string | null;
  message?: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;

export function createAnalysisJobs(now: () => number = Date.now) {
  const jobs = new Map<string, AnalysisJob>();

  function sweep(): void {
    const cutoff = now() - TTL_MS;
    for (const [id, job] of jobs) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  }

  return {
    /**
     * Reserve a receipt for a new job. Returns false if a job for this receipt is
     * already running/ready/done (in use → reject duplicate). An `error` entry is
     * reclaimable so the user can retry the same paid receipt.
     */
    claim(receiptId: string, walletAddress: string): boolean {
      sweep();
      const existing = jobs.get(receiptId);
      if (existing && existing.status !== 'error') return false;
      jobs.set(receiptId, { walletAddress, status: 'running', createdAt: now() });
      return true;
    },

    setRecommendation(receiptId: string, recommendation: unknown): void {
      const job = jobs.get(receiptId);
      if (job) {
        job.recommendation = recommendation;
        job.status = 'ready';
      }
    },

    setProof(
      receiptId: string,
      proof: { blobId: string | null; publicBlobId: string | null; contentSha256: string | null },
    ): void {
      const job = jobs.get(receiptId);
      if (job) {
        job.blobId = proof.blobId;
        job.publicBlobId = proof.publicBlobId;
        job.contentSha256 = proof.contentSha256;
        job.status = 'done';
      }
    },

    // Mark failed (keeps the entry so the poller can read the message); the receipt
    // stays reclaimable for a retry. Final success persists to the DB instead.
    fail(receiptId: string, message: string): void {
      const job = jobs.get(receiptId);
      if (job) {
        job.status = 'error';
        job.message = message;
      }
    },

    get(receiptId: string): AnalysisJob | undefined {
      return jobs.get(receiptId);
    },
  };
}

export type AnalysisJobs = ReturnType<typeof createAnalysisJobs>;
