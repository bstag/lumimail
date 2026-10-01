/** Consecutive crashes or failures on one message before it is skipped instead of retried again. */
export const POISON_STRIKES = 3;

/** Consecutive failed attempts with no successful page before the account is put in `error`. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Delays before each automatic retry of an `error` or `resync_required` account. Once every delay
 * has been used the account stays put and waits for a person.
 */
export const AUTO_RETRY_DELAYS_SECONDS = [300, 1_800, 7_200, 43_200] as const;
