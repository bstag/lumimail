import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { getPrimaryDomain } from "@/lib/user";

// F40 envelope exception (T-33): /api/setup/status deliberately keeps its flat
// success body (`{ hasPrimaryDomain, primaryDomain }`). It is polled by the
// unauthenticated first-run/register flow, which parses it bespokely. Do not
// wrap in `apiSuccess`.
export async function GET() {
	const env = getEnv();
	const domain = await getPrimaryDomain(env);
	return NextResponse.json({
		hasPrimaryDomain: !!domain,
		primaryDomain: domain ? { id: domain.id, hostname: domain.hostname } : null,
	});
}
