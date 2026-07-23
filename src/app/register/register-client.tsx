"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, MailPlus } from "lucide-react";
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

export function RegisterClient() {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");
  const [hasPrimaryDomain, setHasPrimaryDomain] = useState<boolean | null>(null);
  const [primaryDomain, setPrimaryDomain] = useState<string | null>(null);
  const [setupDomain, setSetupDomain] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<InviteInfo>(null);
  const [loadingInvite, setLoadingInvite] = useState(!!inviteToken);

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

    const form = new FormData(e.currentTarget);
    const firstRun = !inviteToken && hasPrimaryDomain === false;
    const domain = firstRun ? setupDomain : primaryDomain;
    if (!inviteToken && !domain) {
      setLoading(false);
      setError(t("domainSetupIncomplete"));
      return;
    }

    const { ok, data } = await submitRegistration(form, {
      firstRun,
      domain: domain ?? "",
      inviteToken,
    });
    setLoading(false);
    if (!ok) {
      setError(typeof data.error === "string" ? data.error : t("registrationFailed"));
      return;
    }
    router.push(data.redirect ?? "/inbox");
  }

  const firstRun = !inviteToken && hasPrimaryDomain === false;
  const accountDomain = firstRun ? setupDomain : primaryDomain;
  const showDomainStep = firstRun && step === 1;

  return (
    <AuthShell
      icon={MailPlus}
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
      {loadingInvite ? (
        <p className="text-sm text-neutral-500">{t("loading")}</p>
      ) : invite ? (
        <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <p>{t("invitedBy", { orgName: invite.orgName })}</p>
          <p className="mt-1 font-medium">{invite.email}</p>
        </div>
      ) : null}
      {error && (
        <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {inviteToken && !invite ? null : showDomainStep ? (
        <form onSubmit={onDomainSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="domain">{t("primaryDomain")}</Label>
            <Input id="domain" name="domain" placeholder="example.com" autoComplete="url" required />
            <p className="text-xs leading-5 text-neutral-500">{t("domainHelper")}</p>
          </div>
          <Button type="submit" className="h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading}>
            {loading ? t("addingDomain") : t("continue")}
          </Button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {invite ? (
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("email")}</Label>
              <Input
                id="invite-email"
                value={invite.email}
                readOnly
                autoComplete="username"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="username">{t("username")}</Label>
              <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <Input
                  id="username"
                  name="username"
                  placeholder={t("placeholders.username")}
                  autoComplete="username"
                  required
                  className="pr-34"
                />
                <span className="absolute right-5 top-2.5 max-w-36 truncate text-sm font-medium text-neutral-500">
                  @{accountDomain ?? t("placeholders.domain")}
                </span>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="resetEmail">{t("recoveryEmail")}</Label>
            <Input
              id="resetEmail"
              name="resetEmail"
              type="email"
              placeholder={t("placeholders.email")}
              required
            />
          </div>
          <Button
            type="submit"
            className="mt-8 h-11 w-full rounded-full px-6 active:scale-[0.98]"
            disabled={loading || hasPrimaryDomain === null}
          >
            {loading ? t("creating") : t("createAccountCta")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
