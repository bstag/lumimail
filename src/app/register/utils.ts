import type { DomainSetupResult, SetupStatus } from "./types";

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch("/api/setup/status");
  return (await res.json()) as SetupStatus;
}

export async function submitPrimaryDomain(form: FormData): Promise<{ ok: boolean; data: DomainSetupResult }> {
  const res = await fetch("/api/setup/domain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname: form.get("domain") }),
  });
  const body = (await res.json()) as {
    data?: DomainSetupResult;
    error?: { message?: string };
  };
  return {
    ok: res.ok,
    data: res.ok ? (body.data ?? {}) : { error: body.error?.message },
  };
}

type RegistrationResult = {
  ok: boolean;
  data: { redirect?: string; token?: string; error?: string };
};

export async function submitRegistration(
  form: FormData,
  opts: { firstRun: boolean; domain: string; inviteToken: string | null },
): Promise<RegistrationResult> {
  const body: Record<string, unknown> = opts.inviteToken
    ? {
        inviteToken: opts.inviteToken,
        password: form.get("password"),
        resetEmail: form.get("resetEmail"),
      }
    : opts.firstRun
      ? { domain: opts.domain, username: form.get("username"), password: form.get("password"), resetEmail: form.get("resetEmail") }
      : { username: form.get("username"), password: form.get("password"), resetEmail: form.get("resetEmail") };

  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (res.ok && typeof data.token === "string") {
    try { localStorage.setItem("lumimail-session-token", data.token); } catch { /* noop */ }
  }
  return {
    ok: res.ok,
    data: {
      redirect: typeof data.redirect === "string" ? data.redirect : undefined,
      error: typeof data.error === "string" ? data.error : undefined,
    },
  };
}

type InviteApiResult = {
  success: boolean;
  data?: { email: string; orgName: string; role: string };
  error?: { message: string };
};

export async function getInviteInfo(token: string): Promise<{ email: string; orgName: string; role: string }> {
  const res = await fetch(`/api/org/invites/${token}`);
  const json = (await res.json()) as InviteApiResult;
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? "Invite not found");
  }
  return json.data!;
}
