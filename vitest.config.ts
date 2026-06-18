import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit/integration test runner config.
 *
 * Coverage is enforced at 100% (lines, functions, statements, branches) on the
 * files listed in `coverage.include`. The protocol target is 100% across all of
 * `src/`; we grow the include list as modules gain tests rather than lowering the
 * threshold. See docs/tests/README.md for the expansion process.
 *
 * E2E tests live in tests/e2e and run under Playwright, not Vitest — they are
 * excluded here.
 */
export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "node",
		globals: true,
		// Some unit tests exercise bcrypt hashing in tight loops (see
		// tests/unit/lib/api-keys.test.ts). bcrypt.hashSync at cost 10 is ~100ms
		// per call, so batches can exceed the 5s default on slower CI runners.
		testTimeout: 30000,
		include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
		exclude: ["tests/e2e/**", "node_modules/**"],
		setupFiles: [],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			reportsDirectory: "./coverage",
			include: [
				"src/lib/validators.ts",
				"src/lib/ids.ts",
				"src/app/utils.ts",
				"src/lib/utils.ts",
				"src/lib/api-keys.ts",
				"src/lib/dns-status.ts",
				"src/lib/email/address.ts",
				"src/lib/email/reply-content-utils.ts",
				"src/lib/email/alias-targets.ts",
				"src/lib/email/providers/index.ts",
				"src/lib/email/providers/cloudflare.ts",
				"src/lib/email/providers/resend.ts",
				"src/lib/api/response.ts",
				"src/lib/cloudflare-api-utils.ts",
				"src/lib/contacts/utils.ts",
				"src/lib/domains/utils.ts",
				"src/lib/auth/password.ts",
				"src/lib/rate-limit.ts",
				"src/lib/cloudflare.ts",
				"src/lib/email/parse.ts",
				"src/lib/user.ts",
				"src/lib/contacts/service.ts",
				"src/lib/migration/backfill-orgs.ts",
				"src/lib/seed.ts",
				"src/lib/domains/service.ts",
				"src/lib/domains/provision.ts",
				"src/lib/domains/cloudflare-cleanup.ts",
				"src/lib/auth/session.ts",
				"src/lib/auth/cookies.ts",
				"src/lib/auth/org-guard.ts",
				"src/lib/auth/client.ts",
				"src/lib/api/auth.ts",
				"src/lib/email/send.ts",
				"src/lib/email/webhooks.ts",
				"src/lib/email/routing.ts",
				"src/lib/email/inbound.ts",
				"src/app/api/api-keys/route.ts",
				"src/app/api/auth/change-password/route.ts",
				"src/app/api/auth/forgot-password/route.ts",
				"src/app/api/auth/login/route.ts",
				"src/app/api/auth/logout/route.ts",
				"src/app/api/auth/me/route.ts",
				"src/app/api/auth/reset-password/route.ts",
				"src/lib/cloudflare-api.ts",
				"src/app/api/domains/route.ts",
				"src/app/api/domains/[id]/route.ts",
				"src/app/api/domains/[id]/dns/route.ts",
				"src/app/api/mailboxes/route.ts",
				"src/app/api/mailboxes/[id]/route.ts",
				"src/app/api/aliases/route.ts",
				"src/app/api/aliases/[id]/route.ts",
				"src/app/api/contacts/route.ts",
				"src/app/api/org/route.ts",
				"src/app/api/org/members/route.ts",
				"src/app/api/org/members/[id]/route.ts",
				"src/app/api/org/invites/[token]/route.ts",
				"src/app/api/settings/profile/route.ts",
				"src/app/api/setup/domain/route.ts",
				"src/app/api/setup/status/route.ts",
				"src/app/api/vacation/route.ts",
				"src/app/api/send/route.ts",
				"src/app/api/seed/route.ts",
				"src/app/api/attachments/route.ts",
				"src/app/api/attachments/[id]/route.ts",
				"src/app/api/v1/messages/route.ts",
				"src/app/api/v1/send/route.ts",
				"src/app/api/messages/route.ts",
				"src/app/api/messages/[messageId]/route.ts",
				"src/app/api/messages/[messageId]/read/route.ts",
				"src/app/api/messages/[messageId]/status/route.ts",
				"src/app/api/messages/[messageId]/starred/route.ts",
				"src/app/api/messages/[messageId]/labels/route.ts",
				"src/app/api/messages/[messageId]/attachments/route.ts",
				"src/app/api/messages/bulk/route.ts",
				"src/app/api/messages/counts/route.ts",
				"src/app/api/messages/search/route.ts",
				"src/app/api/messages/thread/[threadId]/route.ts",
			],
			thresholds: {
				lines: 100,
				functions: 100,
				statements: 100,
				branches: 100,
			},
		},
	},
});
