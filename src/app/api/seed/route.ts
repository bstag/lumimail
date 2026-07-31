import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { seedDemoData } from "@/lib/seed";
import { demoCredentials } from "@/lib/seed-fixtures";

export async function POST() {
	if (process.env.NODE_ENV === "production") {
		return NextResponse.json({ error: "Not available in production" }, { status: 403 });
	}
	const env = getEnv();
	// Defense in depth beyond the NODE_ENV build-time check: seeding must be
	// explicitly enabled per environment and fails closed when the binding is
	// unset (T-43). Local dev sets SEED_ENABLED in wrangler.jsonc vars (or
	// .dev.vars); deployed environments leave it out.
	if (env.SEED_ENABLED !== "true") {
		return NextResponse.json(
			{ error: "Seeding is disabled. Set the SEED_ENABLED=\"true\" environment binding to enable it." },
			{ status: 403 },
		);
	}
	const result = await seedDemoData(env);
	return NextResponse.json({
		ok: true,
		credentials: demoCredentials,
		seeded: result,
	});
}
