/**
 * Where `auth.setup.ts` saves each role's session.
 *
 * Kept out of both test files because Playwright forbids a test importing another
 * test, and duplicating the paths would let them drift apart silently.
 */
export const OWNER_STATE = "tests/e2e-local/.auth/owner.json";
export const MEMBER_STATE = "tests/e2e-local/.auth/member.json";
export const E2E_PASSWORD = "e2e-local-password";
