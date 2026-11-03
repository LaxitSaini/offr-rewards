"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/admin-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert } from "@/components/ui";

interface Task {
  id: string;
  slug: string;
  title: string;
  description: string;
  instructions: string;
  type: string;
  points: number;
  max_awards: number;
  requires_proof: number;
  auto_verify: string;
  active: number;
  sort_order: number;
}

interface TaskPatch {
  points?: number;
  maxAwards?: number;
  sortOrder?: number;
  active?: boolean;
}

const TASK_TYPES = ["telegram", "x_follow", "x_post", "meme", "content", "referral", "hold", "custom"];
const AUTO_VERIFY = ["none", "telegram", "x_post", "onchain_hold"];

export default function AdminTasksPage() {
  const { csrf } = useAdmin();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState<Record<string, TaskPatch>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    description: "",
    instructions: "",
    type: "custom",
    points: 100,
    maxAwards: 1,
    requiresProof: true,
    autoVerify: "none",
    sortOrder: 100,
  });

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ tasks: Task[] }>("/api/admin/tasks");
      setTasks(data.tasks);
      setDraft({});
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  const patch = (id: string, changes: TaskPatch) =>
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...changes } }));

  const save = async (task: Task) => {
    const changes = draft[task.id];
    if (!changes || Object.keys(changes).length === 0) return;
    setBusy(task.id);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/admin/tasks/${task.id}`, { method: "PATCH", csrf, body: changes });
      setMessage(`Saved “${task.title}”.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (task: Task) => {
    setBusy(task.id);
    setError(null);
    try {
      const res = await apiFetch<{ deactivated?: boolean }>(`/api/admin/tasks/${task.id}`, {
        method: "DELETE",
        csrf,
      });
      setMessage(res.deactivated ? "Task deactivated (submissions preserved)." : "Task deleted.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/admin/tasks", { method: "POST", csrf, body: form });
      setMessage(`Created “${form.title}”.`);
      setCreating(false);
      setForm({ ...form, slug: "", title: "", description: "", instructions: "" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Reward engine</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Tasks & weights</h1>
          <p className="mt-1 text-[12px] text-white/40">
            Points are the task weight. Changes apply to future approvals only — already awarded points never
            change retroactively.
          </p>
        </div>
        <button type="button" className="btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
          {creating ? "Close" : "New task"}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      {creating && (
        <form className="card card-pad grid gap-3 sm:grid-cols-2" onSubmit={create}>
          <div>
            <label className="label">Slug</label>
            <input
              className="input"
              required
              pattern="[a-z0-9-]+"
              placeholder="x-space"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Title</label>
            <input
              className="input"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Instructions</label>
            <textarea
              className="input min-h-[70px]"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {TASK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Auto verification</label>
            <select
              className="input"
              value={form.autoVerify}
              onChange={(e) => setForm({ ...form, autoVerify: e.target.value })}
            >
              {AUTO_VERIFY.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Points (weight)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.points}
              onChange={(e) => setForm({ ...form, points: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Max awards per wallet</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.maxAwards}
              onChange={(e) => setForm({ ...form, maxAwards: Number(e.target.value) })}
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary btn-sm" disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create task"}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2.5">
        {tasks.map((task) => {
          const changes = draft[task.id] ?? {};
          const dirty = Object.keys(changes).length > 0;
          return (
            <article key={task.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[14px] font-semibold">{task.title}</h2>
                    <span className="badge-neutral">{task.type}</span>
                    <span className="badge-neutral">{task.auto_verify}</span>
                    {!task.active && <span className="badge-rejected">Inactive</span>}
                  </div>
                  <p className="mono mt-1 text-[11px] text-white/30">{task.slug}</p>
                  <p className="mt-1 max-w-2xl text-[11.5px] text-white/40">{task.description}</p>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="label">Points</label>
                    <input
                      className="input w-20 py-1.5 text-[12px]"
                      type="number"
                      min={0}
                      defaultValue={task.points}
                      onChange={(e) => patch(task.id, { points: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="label">Max</label>
                    <input
                      className="input w-16 py-1.5 text-[12px]"
                      type="number"
                      min={1}
                      defaultValue={task.max_awards}
                      onChange={(e) => patch(task.id, { maxAwards: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="label">Order</label>
                    <input
                      className="input w-16 py-1.5 text-[12px]"
                      type="number"
                      min={0}
                      defaultValue={task.sort_order}
                      onChange={(e) => patch(task.id, { sortOrder: Number(e.target.value) })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={!dirty || busy === task.id}
                    onClick={() => void save(task)}
                  >
                    {busy === task.id ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className={task.active ? "btn-danger btn-sm" : "btn-secondary btn-sm"}
                    disabled={busy === task.id}
                    onClick={() =>
                      task.active
                        ? void remove(task)
                        : void (async () => {
                            await apiFetch(`/api/admin/tasks/${task.id}`, {
                              method: "PATCH",
                              csrf,
                              body: { active: true },
                            });
                            await load();
                          })()
                    }
                  >
                    {task.active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
