"use client";
import React, { useEffect, useState } from "react";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  onLeaveFrom?: string | null;
  onLeaveUntil?: string | null;
  customersOwned: number;
};

type BalancePlanRow = { agentId: string; agentName: string; current: number; target: number; delta: number };

export default function TeamManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Add agent
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Reassign modal
  const [showReassign, setShowReassign] = useState(false);
  const [reassignFrom, setReassignFrom] = useState<string | null>(null);
  const [reassignDestination, setReassignDestination] = useState<string | "roundrobin" | null>(null);

  // On-leave modal
  const [showLeave, setShowLeave] = useState(false);
  const [leaveFrom, setLeaveFrom] = useState<string | null>(null);
  const [leaveUntil, setLeaveUntil] = useState<string | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);

  // Remove modal (warm/cold split)
  const [showRemove, setShowRemove] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<UserRow | null>(null);
  const [warmDest, setWarmDest] = useState<string>("roundrobin");
  const [coldDest, setColdDest] = useState<string>("roundrobin");

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");

  // Balance modal (preview + options)
  const [showBalance, setShowBalance] = useState(false);
  const [balancePlan, setBalancePlan] = useState<BalancePlanRow[] | null>(null);
  const [balanceTotal, setBalanceTotal] = useState(0);
  const [untouchedFirst, setUntouchedFirst] = useState(false);
  const [balancing, setBalancing] = useState(false);

  // Neglected reassignment modal
  const [showNeglected, setShowNeglected] = useState(false);
  const [neglectedDays, setNeglectedDays] = useState(30);
  const [neglectedCount, setNeglectedCount] = useState<number | null>(null);
  const [neglectedDest, setNeglectedDest] = useState<string>("roundrobin");
  const [neglectedLoading, setNeglectedLoading] = useState(false);

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    const res = await fetch("/api/admin/team");
    const data = await res.json();
    if (data?.success) setUsers(data.users);
    setLoading(false);
  }

  // ── Add Agent ──────────────────────────────────────────────────────────────
  async function createAgent() {
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, email: newEmail, password: newPassword }),
    });
    const data = await res.json();
    if (data?.success) {
      setShowAdd(false);
      setNewName(""); setNewEmail(""); setNewPassword("");
      await fetchUsers();
      if (data.pendingAssigned > 0) {
        alert(`Agent created. ${data.pendingAssigned} customer${data.pendingAssigned !== 1 ? "s" : ""} from previous imports were automatically assigned to them.`);
      } else {
        const adminUser = users.find((u) => u.role === "ADMIN");
        if (adminUser && adminUser.customersOwned > 0) {
          const yes = confirm(`Agent created.\n\nAdmin currently owns ${adminUser.customersOwned} customers. Open Balance Team to distribute them?`);
          if (yes) setShowBalance(true);
        }
      }
    } else {
      alert(data?.error || "Failed to create agent");
    }
  }

  // ── Balance ────────────────────────────────────────────────────────────────
  async function previewBalance() {
    setBalancing(true);
    setBalancePlan(null);
    const res = await fetch("/api/admin/team/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preview: true }),
    });
    const data = await res.json();
    setBalancing(false);
    if (data?.success) {
      setBalancePlan(data.plan);
      setBalanceTotal(data.total || 0);
    } else {
      alert(data?.error || "Preview failed");
    }
  }

  async function confirmBalance() {
    setBalancing(true);
    const res = await fetch("/api/admin/team/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ untouchedFirst }),
    });
    const data = await res.json();
    setBalancing(false);
    if (data?.success) {
      setShowBalance(false);
      setBalancePlan(null);
      setUntouchedFirst(false);
      fetchUsers();
    } else {
      alert(data?.error || "Balance failed");
    }
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  async function submitMarkOnLeave() {
    if (!leaveTarget) return;
    const res = await fetch(`/api/admin/team/${leaveTarget}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markOnLeave", from: leaveFrom, until: leaveUntil }),
    });
    const data = await res.json();
    if (data?.success) { setShowLeave(false); setLeaveTarget(null); fetchUsers(); }
    else alert(data?.error || "Failed");
  }

  async function bringBack(id: string) {
    await fetch(`/api/admin/team/${id}`, { method: "PATCH", body: JSON.stringify({ action: "bringBack" }), headers: { "Content-Type": "application/json" } });
    fetchUsers();
  }

  // ── Reassign all ───────────────────────────────────────────────────────────
  async function doReassign() {
    if (!reassignFrom) return;
    const payload: Record<string, unknown> = { action: "reassignCustomers" };
    if (reassignDestination === "roundrobin") payload.roundRobin = true;
    else if (reassignDestination) payload.destinationId = reassignDestination;
    const res = await fetch(`/api/admin/team/${reassignFrom}`, { method: "PATCH", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
    const data = await res.json();
    if (data?.success) { setShowReassign(false); setReassignFrom(null); fetchUsers(); }
    else alert(data?.error || "Failed");
  }

  // ── Remove (warm/cold) ─────────────────────────────────────────────────────
  async function submitRemove() {
    if (!removeTarget) return;
    const hasCustomers = removeTarget.customersOwned > 0;

    if (hasCustomers) {
      // Use warm/cold split
      const payload: Record<string, unknown> = { action: "reassignWarmCold" };
      if (warmDest === "roundrobin") payload.warmRoundRobin = true;
      else if (warmDest) payload.warmDestId = warmDest;
      if (coldDest === "roundrobin") payload.coldRoundRobin = true;
      else if (coldDest) payload.coldDestId = coldDest;

      const res = await fetch(`/api/admin/team/${removeTarget.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data?.success) { alert(data?.error || "Reassign failed"); return; }
    }

    const res = await fetch(`/api/admin/team/${removeTarget.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data?.success) { setShowRemove(false); setRemoveTarget(null); fetchUsers(); }
    else alert(data?.error || "Failed to remove");
  }

  // ── Neglected ──────────────────────────────────────────────────────────────
  async function previewNeglected() {
    setNeglectedLoading(true);
    setNeglectedCount(null);
    const res = await fetch("/api/admin/team/neglected", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayThreshold: neglectedDays, preview: true }),
    });
    const data = await res.json();
    setNeglectedLoading(false);
    if (data?.count !== undefined) setNeglectedCount(data.count);
    else alert(data?.error || "Preview failed");
  }

  async function submitNeglected() {
    setNeglectedLoading(true);
    const body: Record<string, unknown> = { dayThreshold: neglectedDays };
    if (neglectedDest === "roundrobin") body.roundRobin = true;
    else body.destinationId = neglectedDest;
    const res = await fetch("/api/admin/team/neglected", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    setNeglectedLoading(false);
    if (data?.success) {
      alert(`Reassigned ${data.reassigned} neglected customer${data.reassigned !== 1 ? "s" : ""}.`);
      setShowNeglected(false);
      setNeglectedCount(null);
      fetchUsers();
    } else {
      alert(data?.error || "Failed");
    }
  }

  const agents = users.filter((u) => u.role === "AGENT");

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Agents</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center px-3 h-9 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">Add Agent</button>
          <button onClick={() => { setShowBalance(true); previewBalance(); }} className="inline-flex items-center px-3 h-9 bg-white text-slate-700 rounded-lg text-sm font-medium border border-gray-200 hover:bg-slate-50 transition-colors shadow-sm">Balance Team</button>
          <button onClick={() => { setShowNeglected(true); setNeglectedCount(null); }} className="inline-flex items-center px-3 h-9 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium border border-amber-200 hover:bg-amber-100 transition-colors shadow-sm">Reassign Neglected</button>
        </div>
      </div>

      {/* Mobile: agent cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-slate-400 text-sm">Loading…</div>
        ) : users.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-slate-400 text-sm">No agents yet.</div>
        ) : users.map((u) => (
          <div key={u.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold text-gray-900">{u.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{u.email}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={"text-xs font-semibold px-2 py-0.5 rounded-full border " + (u.onLeaveFrom ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200")}>
                  {u.onLeaveFrom ? "On Leave" : "Active"}
                </span>
                <span className="text-xs text-slate-500">{u.customersOwned} customers</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {u.role !== "ADMIN" && (
                u.onLeaveFrom
                  ? <button onClick={() => bringBack(u.id)} className="text-xs px-2.5 h-7 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-medium">Bring Back</button>
                  : <button onClick={() => { setLeaveTarget(u.id); setLeaveFrom(null); setLeaveUntil(null); setShowLeave(true); }} className="text-xs px-2.5 h-7 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 font-medium">On Leave</button>
              )}
              <button onClick={() => { setReassignFrom(u.id); setReassignDestination(null); setShowReassign(true); }} className="text-xs px-2.5 h-7 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 font-medium">Reassign</button>
              <button onClick={() => { setEditTarget(u.id); setEditName(u.name); setEditEmail(u.email); setEditPassword(""); setShowEdit(true); }} className="text-xs px-2.5 h-7 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 font-medium">Edit</button>
              {u.role !== "ADMIN" && (
                <button onClick={() => { setRemoveTarget(u); setWarmDest("roundrobin"); setColdDest("roundrobin"); setShowRemove(true); }} className="text-xs px-2.5 h-7 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 font-medium">Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-gray-200">
            <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Customers</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-slate-400 text-sm">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-slate-400 text-sm">No agents yet.</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-semibold text-gray-900">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-700">{u.customersOwned.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={"text-xs font-semibold px-2 py-0.5 rounded-full border " + (u.onLeaveFrom ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200")}>
                    {u.onLeaveFrom ? "On Leave" : "Active"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {u.role !== "ADMIN" && (
                      u.onLeaveFrom
                        ? <button onClick={() => bringBack(u.id)} className="text-sm text-emerald-600 hover:text-emerald-800 font-medium">Bring Back</button>
                        : <button onClick={() => { setLeaveTarget(u.id); setLeaveFrom(null); setLeaveUntil(null); setShowLeave(true); }} className="text-sm text-amber-600 hover:text-amber-800 font-medium">On Leave</button>
                    )}
                    <button onClick={() => { setReassignFrom(u.id); setReassignDestination(null); setShowReassign(true); }} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Reassign</button>
                    <button onClick={() => { setEditTarget(u.id); setEditName(u.name); setEditEmail(u.email); setEditPassword(""); setShowEdit(true); }} className="text-sm text-slate-600 hover:text-slate-900 font-medium">Edit</button>
                    {u.role !== "ADMIN" && (
                      <button onClick={() => { setRemoveTarget(u); setWarmDest("roundrobin"); setColdDest("roundrobin"); setShowRemove(true); }} className="text-sm text-red-600 hover:text-red-800 font-medium">Remove</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Add Agent Modal ── */}
      {showAdd && (
        <Modal title="Add Agent" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Initial password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">The agent name must match exactly how it appears in the Owner column of your CSV files for auto-assignment to work.</p>
          </div>
          <ModalFooter onClose={() => setShowAdd(false)} onConfirm={createAgent} confirmLabel="Create" />
        </Modal>
      )}

      {/* ── Balance Modal ── */}
      {showBalance && (
        <Modal title="Balance Team" onClose={() => { setShowBalance(false); setBalancePlan(null); setUntouchedFirst(false); }}>
          {balancing && !balancePlan && <p className="text-sm text-gray-500 py-4 text-center">Computing preview…</p>}
          {balancePlan && (
            <>
              <p className="text-sm text-gray-600 mb-3">
                {balancePlan.every((r) => r.delta === 0)
                  ? "Team is already balanced — no changes needed."
                  : (() => {
                      const moving = balancePlan.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
                      return `${moving} customer${moving !== 1 ? "s" : ""} will be moved to balance the team (${balanceTotal} total).`;
                    })()}
              </p>
              <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Agent</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Now</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">After</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Change</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {balancePlan.map((r) => (
                      <tr key={r.agentId}>
                        <td className="px-3 py-2 font-medium">{r.agentName}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{r.current}</td>
                        <td className="px-3 py-2 text-right">{r.target}</td>
                        <td className={"px-3 py-2 text-right font-medium " + (r.delta > 0 ? "text-green-600" : r.delta < 0 ? "text-red-600" : "text-gray-400")}>
                          {r.delta > 0 ? `+${r.delta}` : r.delta === 0 ? "—" : r.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 mb-1 cursor-pointer">
                <input type="checkbox" checked={untouchedFirst} onChange={(e) => setUntouchedFirst(e.target.checked)} className="rounded" />
                Untouched-first — prefer moving customers that have never been contacted
              </label>
            </>
          )}
          <ModalFooter
            onClose={() => { setShowBalance(false); setBalancePlan(null); setUntouchedFirst(false); }}
            onConfirm={confirmBalance}
            confirmLabel={balancing ? "Balancing…" : "Confirm Balance"}
            disabled={balancing || !balancePlan || balancePlan.every((r) => r.delta === 0)}
          />
        </Modal>
      )}

      {/* ── Reassign Modal ── */}
      {showReassign && (
        <Modal title="Reassign All Customers" onClose={() => setShowReassign(false)}>
          <div className="space-y-2">
            <label className="block text-sm text-gray-600">Move all customers to:</label>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={(reassignDestination as string) || ""} onChange={(e) => setReassignDestination(e.target.value || null)}>
              <option value="">— select —</option>
              <option value="roundrobin">Round-robin across team</option>
              {users.filter((u) => u.id !== reassignFrom && u.role === "AGENT").map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <ModalFooter onClose={() => setShowReassign(false)} onConfirm={doReassign} confirmLabel="Reassign" disabled={!reassignDestination} />
        </Modal>
      )}

      {/* ── Remove Modal (warm/cold split) ── */}
      {showRemove && removeTarget && (
        <Modal title={`Remove ${removeTarget.name}`} onClose={() => setShowRemove(false)}>
          {removeTarget.customersOwned > 0 ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                This agent owns <strong>{removeTarget.customersOwned} customers</strong>. Choose where to send them:
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Warm customers <span className="font-normal text-gray-400">(previously contacted)</span>
                  </label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={warmDest} onChange={(e) => setWarmDest(e.target.value)}>
                    <option value="roundrobin">Round-robin across team</option>
                    {agents.filter((u) => u.id !== removeTarget.id).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cold customers <span className="font-normal text-gray-400">(never contacted)</span>
                  </label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={coldDest} onChange={(e) => setColdDest(e.target.value)}>
                    <option value="roundrobin">Round-robin across team</option>
                    {agents.filter((u) => u.id !== removeTarget.id).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-600">This agent has no customers. They will be removed immediately.</p>
          )}
          <ModalFooter onClose={() => setShowRemove(false)} onConfirm={submitRemove} confirmLabel="Remove Agent" danger />
        </Modal>
      )}

      {/* ── Mark On Leave Modal ── */}
      {showLeave && (
        <Modal title="Mark On Leave" onClose={() => setShowLeave(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">From</label>
              <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" onChange={(e) => setLeaveFrom(e.target.value ? new Date(e.target.value).toISOString() : null)} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Until</label>
              <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" onChange={(e) => setLeaveUntil(e.target.value ? new Date(e.target.value).toISOString() : null)} />
            </div>
          </div>
          <ModalFooter onClose={() => setShowLeave(false)} onConfirm={submitMarkOnLeave} confirmLabel="Save" />
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {showEdit && (
        <Modal title="Edit Agent" onClose={() => setShowEdit(false)}>
          <div className="space-y-3">
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            <input type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="New password (leave blank to keep)" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
          </div>
          <ModalFooter onClose={() => setShowEdit(false)} onConfirm={async () => {
            if (!editTarget) return;
            const payload: Record<string, unknown> = { action: "updateDetails" };
            if (editName) payload.name = editName;
            if (editEmail) payload.email = editEmail;
            if (editPassword) payload.password = editPassword;
            const res = await fetch(`/api/admin/team/${editTarget}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const data = await res.json();
            if (data?.success) { setShowEdit(false); setEditTarget(null); fetchUsers(); }
            else alert(data?.error || "Failed to update");
          }} confirmLabel="Save" />
        </Modal>
      )}

      {/* ── Neglected Reassignment Modal ── */}
      {showNeglected && (
        <Modal title="Reassign Neglected Customers" onClose={() => { setShowNeglected(false); setNeglectedCount(null); }}>
          <p className="text-sm text-gray-600 mb-4">
            Find customers whose follow-up date is overdue by at least this many days AND who have not been contacted recently.
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Overdue by at least</label>
              <input
                type="number" min="1" max="365" value={neglectedDays}
                onChange={(e) => { setNeglectedDays(Number(e.target.value)); setNeglectedCount(null); }}
                className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <span className="text-sm text-gray-600">days</span>
              <button onClick={previewNeglected} disabled={neglectedLoading} className="text-sm text-blue-600 hover:underline disabled:opacity-50">
                {neglectedLoading ? "Checking…" : "Check count"}
              </button>
            </div>

            {neglectedCount !== null && (
              <div className={"rounded-lg p-3 text-sm font-medium " + (neglectedCount > 0 ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800")}>
                {neglectedCount > 0
                  ? `${neglectedCount} customer${neglectedCount !== 1 ? "s" : ""} qualify for reassignment.`
                  : "No neglected customers found with this threshold."}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reassign to</label>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={neglectedDest} onChange={(e) => setNeglectedDest(e.target.value)}>
                <option value="roundrobin">Round-robin across team</option>
                {agents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <ModalFooter
            onClose={() => { setShowNeglected(false); setNeglectedCount(null); }}
            onConfirm={submitNeglected}
            confirmLabel={neglectedLoading ? "Reassigning…" : "Reassign"}
            disabled={neglectedLoading || neglectedCount === 0}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h3 className="font-semibold text-gray-900 text-lg mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ onClose, onConfirm, confirmLabel, disabled, danger }: {
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="mt-5 flex justify-end gap-3">
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className={"px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 " + (danger ? "bg-red-600 text-white hover:bg-red-700" : "bg-blue-600 text-white hover:bg-blue-700")}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
