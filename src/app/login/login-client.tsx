"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitLogin } from "./utils";

export function LoginClient() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { ok, data } = await submitLogin(new FormData(e.currentTarget));
    setLoading(false);
    if (!ok) {
      setError(data.error ?? t("loginFailed"));
      return;
    }
    router.push(data.redirect ?? "/inbox");
  }

  return (
    <AuthShell
      icon={Mail}
      title={t("signIn")}
      description={t("signInDesc")}
      footer={
        <Link
          href="/register"
          className="inline-flex items-center gap-2 hover:underline"
        >
          {t("createAccountCta")}
          <ArrowRight className="h-4 w-4" />
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="password">{t("password")}</Label>
            <Link href="/forgot-password" className="text-sm font-medium text-accent hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <p className="rounded-2xl border border-danger/30 bg-danger-muted px-4 py-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="h-11 w-full rounded-full px-6 active:scale-[0.98]"
          disabled={loading}
        >
          {loading ? t("signingIn") : t("signIn")}
        </Button>
      </form>
    </AuthShell>
  );
}
