import { parseApiResponse } from "@/lib/api/client-response";

export interface PasswordResetSubmission {
	email: string;
	token: string;
	newPassword: string;
}

export async function submitPasswordReset(
	submission: PasswordResetSubmission,
): Promise<{ ok: true }> {
	const response = await fetch("/api/auth/reset-password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(submission),
	});
	return parseApiResponse<{ ok: true }>(response);
}
