import { AuthGuard } from "@/components/auth/auth-guard";
import { ForgotPasswordClient } from "./forgot-password-client";

export default function ForgotPasswordPage() {
	return (
		<AuthGuard mode="public">
			<ForgotPasswordClient />
		</AuthGuard>
	);
}
