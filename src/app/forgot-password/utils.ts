import { parseApiResponse } from "@/lib/api/client-response";

export async function requestPasswordReset(email: string): Promise<string> {
	const response = await fetch("/api/auth/forgot-password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email }),
	});
	const data = await parseApiResponse<{ message: string }>(response);
	return data.message;
}
