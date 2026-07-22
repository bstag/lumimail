import { Suspense } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ResetPasswordClient } from "./reset-password-client";

export default function ResetPasswordPage() {
	return (
		<AuthGuard mode="public">
			<Suspense fallback={null}>
				<ResetPasswordClient />
			</Suspense>
		</AuthGuard>
	);
}
