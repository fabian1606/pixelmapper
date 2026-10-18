/**
 * Account behaviour of the running platform (ADR 0004 D3, D13–D16).
 *
 * The web app requires an account and only caches opened projects; the
 * desktop app works without an account, mirrors every cloud project and
 * asks before removing local copies on logout. Each `#platform` entry
 * exports `getAccountPolicy()` returning this shape, so feature code never
 * branches on "is this Tauri?" itself (ADR 0003 D3).
 */
export interface AccountPolicy {
  /** Routes need a session (web). `false`: the app boots signed out (Tauri, D3). */
  readonly accountRequired: boolean;
  /** Mirror all cloud projects of the account in the background (D13). */
  readonly mirrorCloudProjects: boolean;
  /** Offer local-only projects for upload after sign-in (D14). */
  readonly offerUploadOnLogin: boolean;
  /**
   * Logout: `ask` = ask whether to keep local copies of cloud projects (D15),
   * `clear` = always delete the local cache (D16).
   */
  readonly logoutCache: 'ask' | 'clear';
  /** Where `.pmproject` imports go: a local-only project or straight to the cloud. */
  readonly importTarget: 'local' | 'cloud';
  /** Show projects bound to another account ("Owned by …", D15). */
  readonly showForeignProjects: boolean;
}

/** Web app: account mandatory, cache only (D2, D16). */
export const WEB_ACCOUNT_POLICY: AccountPolicy = Object.freeze({
  accountRequired: true,
  mirrorCloudProjects: false,
  offerUploadOnLogin: false,
  logoutCache: 'clear',
  importTarget: 'cloud',
  showForeignProjects: false,
});

/** Desktop app: account optional, full local copies (D3, D13–D15). */
export const DESKTOP_ACCOUNT_POLICY: AccountPolicy = Object.freeze({
  accountRequired: false,
  mirrorCloudProjects: true,
  offerUploadOnLogin: true,
  logoutCache: 'ask',
  importTarget: 'local',
  showForeignProjects: true,
});
