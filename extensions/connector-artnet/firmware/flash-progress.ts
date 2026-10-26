/**
 * Display helpers of a firmware job (`FlashJob`, bridge contract §4):
 * terminal phases, English phase texts and an overall progress fraction.
 *
 * The bridge reports phases in the order of the update procedure (plan
 * M2.2): entering → writing → verifying → finishing → confirming, ending in
 * done, failed or cancelled.
 */
import type { FlashJob, FlashPhase } from '../bridge/protocol-model';

/** Phases after which the job no longer changes. */
export const TERMINAL_PHASES: ReadonlySet<FlashPhase> = new Set<FlashPhase>(['done', 'failed', 'cancelled']);

/** True when a job in `phase` has ended. */
export function isTerminalPhase(phase: FlashPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

/** Short English names of the phases. */
export const FLASH_PHASE_LABELS: Readonly<Record<FlashPhase, string>> = {
  entering: 'Starting bootloader',
  writing: 'Writing',
  verifying: 'Verifying',
  finishing: 'Finishing',
  confirming: 'Checking new firmware',
  done: 'Updated',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Share of the progress bar reached at the start of each running phase. */
const PHASE_START: Readonly<Record<'entering' | 'writing' | 'verifying' | 'finishing' | 'confirming', number>> = {
  entering: 0,
  writing: 0.05,
  verifying: 0.85,
  finishing: 0.92,
  confirming: 0.96,
};

/** Writing covers this share of the bar (pages written / pages total). */
const WRITING_SHARE = PHASE_START.verifying - PHASE_START.writing;

/** Share of the bar covered by the pages written so far. */
function writtenShare(job: Pick<FlashJob, 'pagesDone' | 'pagesTotal'>): number {
  if (job.pagesTotal <= 0) return 0;
  return WRITING_SHARE * Math.min(1, Math.max(0, job.pagesDone / job.pagesTotal));
}

/**
 * Overall progress 0–1: pages drive the writing phase, the other phases
 * advance in fixed steps. A failed or cancelled job keeps the share it
 * reached while writing.
 */
export function flashProgressFraction(job: Pick<FlashJob, 'phase' | 'pagesDone' | 'pagesTotal'>): number {
  switch (job.phase) {
    case 'done':
      return 1;
    case 'failed':
    case 'cancelled':
      return job.pagesDone > 0 ? PHASE_START.writing + writtenShare(job) : 0;
    case 'writing':
      return PHASE_START.writing + writtenShare(job);
    default:
      return PHASE_START[job.phase];
  }
}

/**
 * One-line status of a job, e.g. `Writing 12 / 94 pages` or `Verifying (8
 * pages rewritten)` — `rewrites` counts pages (contract rev 2: all pages of
 * the chunks whose APP_CRC differed).
 */
export function describeFlashPhase(job: Pick<FlashJob, 'phase' | 'pagesDone' | 'pagesTotal' | 'rewrites'>): string {
  const label = FLASH_PHASE_LABELS[job.phase];
  if (job.phase === 'writing' && job.pagesTotal > 0) return `${label} ${job.pagesDone} / ${job.pagesTotal} pages`;
  if (job.phase === 'verifying' && job.rewrites > 0) return `${label} (${job.rewrites} ${job.rewrites === 1 ? 'page' : 'pages'} rewritten)`;
  return label;
}
