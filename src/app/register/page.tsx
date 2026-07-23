import { Suspense } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { RegisterClient } from "./register-client";

export default function RegisterPage() {
  return (
    <AuthGuard mode="public">
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading...</p>}>
        <RegisterClient />
      </Suspense>
    </AuthGuard>
  );
}
