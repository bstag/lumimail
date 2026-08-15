import { persistAuthSession } from "@/lib/auth/client";
import type { LoginResult } from "./types";

export async function submitLogin(form: FormData): Promise<{ ok: boolean; data: LoginResult }> {
	const res = await fetch("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: form.get("email"),
			password: form.get("password"),
		}),
	});

	return {
		ok: res.ok,
		data: (await persistAuthSession(res)) as LoginResult,
	};
}

export function resolveLoginRedirect(defaultRedirect: string | undefined, search: string): string {
	const requested = new URLSearchParams(search).get("redirect");
	if (requested?.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\")) {
		return requested;
	}
	return defaultRedirect ?? "/inbox";
}
