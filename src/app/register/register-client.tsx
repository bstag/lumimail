"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSetupStatus,
  submitPrimaryDomain,
  submitRegistration,
  getInviteInfo,
} from "./utils";

type InviteInfo = {
  email: string;
  orgName: string;
  role: string;
} | null;

function registrationContext(inviteToken: string | null, hasPrimaryDomain: boolean | null, setupDomain: string | null, primaryDomain: string | null) {
  const firstRun = !inviteToken && hasPrimaryDomain === false;
  return { firstRun, domain: firstRun ? setupDomain : primaryDomain, inviteToken };
}

function registrationResult(ok: boolean, data: { error?: unknown; redirect?: string }, fallback: string) {
  if (!ok) return { ok: false as const, message: typeof data.error === "string" ? data.error : fallback };
  return { ok: true as const, redirect: data.redirect ?? "/inbox" };
}

async function registerAccount(form: FormData, context: ReturnType<typeof registrationContext>, incomplete: string, failed: string) {
  if (!context.inviteToken && !context.domain) return { ok: false as const, message: incomplete };
  const { ok, data } = await submitRegistration(form, {
    firstRun: context.firstRun, domain: context.domain ?? "", inviteToken: context.inviteToken,
  });
  return registrationResult(ok, data, failed);
}

function RegistrationContent({ loadingInvite, invite, error, inviteOnly, inviteToken, showDomainStep, loading, hasPrimaryDomain, accountDomain, onDomainSubmit, onSubmit }: {
  loadingInvite: boolean; invite: InviteInfo; error: string | null; inviteOnly: boolean; inviteToken: string | null;
  showDomainStep: boolean; loading: boolean; hasPrimaryDomain: boolean | null; accountDomain: string | null;
  onDomainSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const t = useTranslations("auth");
  if (loadingInvite) return <p className="text-sm text-ink-muted">{t("loading")}</p>;
  const invitation = invite && <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-muted px-4 py-3 text-sm text-accent"><p>{t("invitedBy", { orgName: invite.orgName })}</p><p className="mt-1 font-medium">{invite.email}</p></div>;
  const errorMessage = error && <p className="rounded-2xl border border-danger/30 bg-danger-muted px-4 py-3 text-sm font-medium text-danger">{error}</p>;
  if (inviteOnly) return <>{invitation}{errorMessage}<div className="rounded-2xl border border-border bg-surface-subtle px-4 py-4 text-sm leading-6 text-ink-muted">Registration is invitation-only. Ask a workspace administrator to send you an invitation.</div></>;
  if (inviteToken && !invite) return <>{errorMessage}</>;
  if (showDomainStep) return <>{errorMessage}<form onSubmit={onDomainSubmit} className="space-y-5"><div className="space-y-2"><Label htmlFor="domain">{t("primaryDomain")}</Label><Input id="domain" name="domain" placeholder="example.com" autoComplete="url" required /><p className="text-xs leading-5 text-ink-muted">{t("domainHelper")}</p></div><Button type="submit" className="h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading}>{loading ? t("addingDomain") : t("continue")}</Button></form></>;
  return <>{invitation}{errorMessage}<form onSubmit={onSubmit} className="space-y-5">{invite ? <div className="space-y-2"><Label htmlFor="invite-email">{t("email")}</Label><Input id="invite-email" value={invite.email} readOnly autoComplete="username" /></div> : <div className="space-y-2"><Label htmlFor="username">{t("username")}</Label><div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><Input id="username" name="username" placeholder={t("placeholders.username")} autoComplete="username" required className="pr-34" /><span className="absolute right-5 top-2.5 max-w-36 truncate text-sm font-medium text-ink-muted">@{accountDomain ?? t("placeholders.domain")}</span></div></div>}<div className="space-y-2"><Label htmlFor="password">{t("password")}</Label><Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /></div><div className="space-y-2"><Label htmlFor="resetEmail">{t("recoveryEmail")}</Label><Input id="resetEmail" name="resetEmail" type="email" placeholder={t("placeholders.email")} required /></div><Button type="submit" className="mt-8 h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading || hasPrimaryDomain === null}>{loading ? t("creating") : t("createAccountCta")}</Button></form></>;
}

export function RegisterClient({ initialHasPrimaryDomain = null, initialPrimaryDomain = null, initialStep = 1, initialInvite = null, initialInviteToken = null }: {
  initialHasPrimaryDomain?: boolean | null; initialPrimaryDomain?: string | null; initialStep?: 1 | 2;
  initialInvite?: InviteInfo; initialInviteToken?: string | null;
} = {}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = initialInviteToken ?? searchParams.get("token");
  const [hasPrimaryDomain, setHasPrimaryDomain] = useState<boolean | null>(initialHasPrimaryDomain);
  const [primaryDomain, setPrimaryDomain] = useState<string | null>(initialPrimaryDomain);
  const [setupDomain, setSetupDomain] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<InviteInfo>(initialInvite);
  const [loadingInvite, setLoadingInvite] = useState(!!inviteToken && !initialInvite);

  useEffect(() => {
    void getSetupStatus()
      .then((data) => {
        setHasPrimaryDomain(data.hasPrimaryDomain);
        setPrimaryDomain(data.primaryDomain?.hostname ?? null);
      })
      .catch((err) => {
        if (process.env.NODE_ENV !== "production") console.error("Failed to get setup status", err);
        setHasPrimaryDomain(true);
      });
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    void getInviteInfo(inviteToken)
      .then(setInvite)
      .catch(() => {
        setError(t("inviteExpired"));
      })
      .finally(() => setLoadingInvite(false));
  }, [inviteToken, t]);

  async function onDomainSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { ok, data } = await submitPrimaryDomain(new FormData(e.currentTarget));
    setLoading(false);
    if (!ok || !data.domain) {
      setError(typeof data.error === "string" ? data.error : t("domainSetupFailed"));
      return;
    }
    setSetupDomain(data.domain.hostname);
    setStep(2);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await registerAccount(new FormData(e.currentTarget),
      registrationContext(inviteToken, hasPrimaryDomain, setupDomain, primaryDomain),
      t("domainSetupIncomplete"), t("registrationFailed"));
    setLoading(false);
    if (!result.ok) return setError(result.message);
    router.push(result.redirect);
  }

  const firstRun = !inviteToken && hasPrimaryDomain === false;
  const inviteOnly = !inviteToken && hasPrimaryDomain === true;
  const accountDomain = firstRun ? setupDomain : primaryDomain;
  const showDomainStep = firstRun && step === 1;

  return (
    <AuthShell
      title={invite ? t("createAccountCta") : showDomainStep ? t("addDomain") : t("createMailbox")}
      steps={
        firstRun
          ? [
              { label: t("domainStepLabel"), active: step === 1 },
              { label: t("accountStepLabel"), active: step === 2 },
            ]
          : undefined
      }
      footer={
        <Link href="/login" className="inline-flex items-center gap-2 hover:underline">
          {t("signInInstead")}
          <ArrowRight className="h-4 w-4" />
        </Link>
      }
    >
      <RegistrationContent loadingInvite={loadingInvite} invite={invite} error={error} inviteOnly={inviteOnly} inviteToken={inviteToken} showDomainStep={showDomainStep} loading={loading} hasPrimaryDomain={hasPrimaryDomain} accountDomain={accountDomain} onDomainSubmit={onDomainSubmit} onSubmit={onSubmit} />
    </AuthShell>
  );
}
