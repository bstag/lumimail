import { selectOutboundProvider } from "@/lib/email/providers";

const RESET_SUBJECT = "Reset your Lumimail password";

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export async function hashPasswordResetToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return bytesToHex(new Uint8Array(digest));
}

export function buildPasswordResetLink(
	publicAppUrl: string,
	token: string,
	email: string,
): string {
	let baseUrl: URL;
	try {
		baseUrl = new URL(publicAppUrl);
	} catch {
		throw new Error("PUBLIC_APP_URL must be a valid HTTPS URL");
	}
	if (baseUrl.protocol !== "https:") {
		throw new Error("PUBLIC_APP_URL must be a valid HTTPS URL");
	}

	const resetUrl = new URL("/reset-password", baseUrl);
	resetUrl.searchParams.set("token", token);
	resetUrl.searchParams.set("email", email);
	return resetUrl.toString();
}

export async function sendPasswordResetEmail(
	env: CloudflareEnv,
	recoveryEmail: string,
	resetLink: string,
): Promise<void> {
	const from = env.PASSWORD_RESET_FROM?.trim();
	if (!from) throw new Error("PASSWORD_RESET_FROM is required");

	const safeLink = escapeHtml(resetLink);
	await selectOutboundProvider(env).send({
		from,
		to: recoveryEmail,
		subject: RESET_SUBJECT,
		text: `We received a request to reset your Lumimail password.\n\nReset your password: ${resetLink}\n\nThis link expires in one hour. If you did not request this, you can ignore this email.`,
		html: `<p>We received a request to reset your Lumimail password.</p><p><a href="${safeLink}">Reset your password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this email.</p>`,
	});
}
