import createDOMPurify from "dompurify";
import { parseHTML } from "linkedom";

/**
 * Server-side HTML sanitizer.
 *
 * `dompurify` needs a DOM. On the Cloudflare Workers runtime there is no global
 * `window`/`document`, so the previous `isomorphic-dompurify` dependency threw
 * at import (its jsdom/browser builds assume a DOM). `linkedom` provides a
 * pure-JS DOM that runs on Workers, which we hand to DOMPurify once at module
 * load. Browser code uses the native `window` via `dompurify` directly and does
 * not import this module.
 */
// ⚠️ SECURITY TODO (confirmed bug): DOMPurify + linkedom 0.18.x does NOT
// sanitize in the Workers/Node runtime — DOMPurify marks itself unsupported and
// `sanitize()` returns the input UNCHANGED. Verified by unit test: hostile HTML
// (`<script>`, `onerror=`, `javascript:`) passes through untouched. This is the
// server-side XSS boundary for stored mail (see inbox render path), so it is a
// stored-XSS exposure. A real fix needs a Workers-compatible sanitizer verified
// on the actual runtime (e.g. a different DOMPurify/linkedom version pairing or
// an allowlist sanitizer). Until then this file is excluded from the coverage
// gate (vitest.config.ts) because it cannot be honestly tested as correct.
const { window } = parseHTML("<!DOCTYPE html><html><body></body></html>");
const DOMPurify = createDOMPurify(window as unknown as Window & typeof globalThis);

export function sanitizeHtml(html: string | null | undefined): string | null {
	if (!html) return null;
	return DOMPurify.sanitize(html);
}
