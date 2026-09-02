import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLockup, PicketMark, RouteMotif } from "@/components/brand";

describe("PicketMark", () => {
	it("renders the normalized sigil as decoration", () => {
		const markup = renderToStaticMarkup(<PicketMark className="h-7 w-7" />);

		expect(markup).toContain('data-brand-mark="true"');
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain("picket-mark-boundary-mask.png");
		expect(markup).toContain("picket-mark-signal-mask.png");
		expect(markup).not.toContain("Picket</title>");
	});
});

describe("BrandLockup", () => {
	it("keeps the wordmark and optional tagline as live text", () => {
		const markup = renderToStaticMarkup(<BrandLockup tagline="Own the route. Control the inbox." />);

		expect(markup).toContain(">Picket<");
		expect(markup).toContain("Own the route. Control the inbox.");
		expect(markup).not.toContain("<img");
	});

	it("omits the tagline in compact application chrome", () => {
		const markup = renderToStaticMarkup(<BrandLockup />);

		expect(markup).toContain(">Picket<");
		expect(markup).not.toContain("Own the route");
	});
});

describe("RouteMotif", () => {
	it("renders code-native route geometry as decoration", () => {
		const markup = renderToStaticMarkup(<RouteMotif className="opacity-10" />);

		expect(markup).toContain('data-brand-route="true"');
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain('viewBox="0 0 320 240"');
		expect(markup).not.toContain("<img");
	});
});
