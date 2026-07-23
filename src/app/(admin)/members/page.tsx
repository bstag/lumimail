"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, Clock, Plus, X } from "lucide-react";
import { authFetch } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { InviteMemberDialog } from "@/components/admin/invite-member-dialog";

type Member = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

type Invite = {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt: string;
};

const ROLE_BADGES: Record<string, string> = {
  owner: "bg-warning-muted text-warning",
  admin: "bg-accent-muted text-accent",
  member: "bg-surface-subtle text-ink-muted",
};

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    const res = await authFetch("/api/org/members");
    const json = (await res.json()) as {
      success: boolean;
      data?: { members?: Member[]; invites?: Invite[] };
      error?: { message: string };
    };
    if (json.success) {
      setMembers(json.data?.members ?? []);
      setInvites(json.data?.invites ?? []);
    } else {
      setError(json.error?.message ?? "Failed to load members");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  async function changeRole(memberId: string, newRole: string) {
    const res = await authFetch(`/api/org/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) void fetchMembers();
  }

  async function removeMember(memberId: string) {
    if (!confirm("Remove this member from the workspace?")) return;
    const res = await authFetch(`/api/org/members/${memberId}`, { method: "DELETE" });
    if (res.ok) void fetchMembers();
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-ink">Members</h2>
        <p className="text-sm text-ink-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ink">Members</h2>
          <p className="text-sm text-ink-muted">Manage who has access to this workspace.</p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Invite member
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger">{error}</p>
      )}

      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-subtle text-sm font-medium text-ink-muted">
                {member.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-ink">{member.name}</p>
                <p className="text-xs text-ink-muted">{member.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {member.role === "owner" ? (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGES.owner}`}>
                  Owner
                </span>
              ) : (
                <select
                  value={member.role}
                  onChange={(e) => changeRole(member.id, e.target.value)}
                  className="h-7 rounded-md border border-border bg-surface-subtle px-2 text-xs text-ink-muted"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
              )}
              {member.role !== "owner" && (
                <button
                  type="button"
                  onClick={() => removeMember(member.id)}
                  className="text-ink-faint hover:text-danger"
                  title="Remove member"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-ink-muted">Pending invites</h3>
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-ink-faint" />
                <div>
                  <p className="text-sm text-ink-muted">{invite.email}</p>
                  <p className="text-xs text-ink-faint">
                    <Clock className="mr-1 inline h-3 w-3" />
                    Expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGES[invite.role]}`}>
                  {invite.role}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInviteCreated={() => {
          void fetchMembers();
        }}
      />
    </div>
  );
}
