"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, Clock, Plus, X } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InviteMemberDialog } from "@/components/admin/invite-member-dialog";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";

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
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      const data = await apiJson.get<{ members?: Member[]; invites?: Invite[] }>(
        "/api/org/members",
      );
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load members");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  async function changeRole(memberId: string, newRole: string) {
    setError(null);
    try {
      await apiJson.patch(`/api/org/members/${memberId}`, { role: newRole });
      void fetchMembers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to change role");
    }
  }

  async function removeMember(memberId: string) {
    setError(null);
    try {
      await apiJson.delete(`/api/org/members/${memberId}`);
      void fetchMembers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to remove member");
    }
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
      <PageHeader
        title="Members"
        description="Manage who has access to this workspace."
        action={
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Invite member
          </Button>
        }
      />

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger">{error}</p>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove member?"
        description={
          removeTarget
            ? `${removeTarget.email} will lose access to this workspace immediately.`
            : ""
        }
        confirmLabel="Remove member"
        danger
        onConfirm={() => {
          if (removeTarget) void removeMember(removeTarget.id);
          setRemoveTarget(null);
        }}
      />

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
                <Select
                  value={member.role}
                  onChange={(e) => {
                    void changeRole(member.id, e.target.value);
                  }}
                  size="sm" className="w-auto"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </Select>
              )}
              {member.role !== "owner" && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(member)}
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
          <h3 className="text-sm font-semibold text-ink">Pending invites</h3>
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
