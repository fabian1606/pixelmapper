import { ref } from 'vue';
import type { AccountIdentity } from '~/utils/account/known-accounts';

/**
 * Process-wide account state shared by the account plugin, the project list
 * and the dialogs (module singletons: the app has one account at a time).
 */

// ── Login review (D14) ───────────────────────────────────────────────────────

/**
 * Account that just signed in and has not seen the "Upload to your
 * account?" dialog yet. Set by the account plugin, cleared by the dialog.
 */
export const pendingLoginReview = ref<AccountIdentity | null>(null);

// ── Local store revision ─────────────────────────────────────────────────────

/** Bumped whenever the account flows change the local store (list refresh). */
export const localProjectsRevision = ref(0);

/** Signals that local project metas changed. */
export function bumpLocalProjects(): void {
  localProjectsRevision.value++;
}

// ── Mirroring hook ───────────────────────────────────────────────────────────

let mirrorTrigger: (() => void) | null = null;

/** Registered by the account plugin while mirroring is active (desktop). */
export function setMirrorTrigger(fn: (() => void) | null): void {
  mirrorTrigger = fn;
}

/** Requests a mirror pass soon (no-op when mirroring is inactive). */
export function requestMirror(): void {
  mirrorTrigger?.();
}
