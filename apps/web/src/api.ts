import type { Agent, Block, InboxItem, Note, ReviewCard, Run, RunStep, Settings, Task } from "@zhiheng/shared";

let runtime = {
  token: "zhiheng-dev",
  apiBase: typeof location !== "undefined" && location.port === "5173" ? "/api" : "",
};

export function setRuntime(next: { token: string; apiBase: string }) {
  runtime = next;
}

const base = () => runtime.apiBase;
const token = () => runtime.token;

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? "请求没有完成。");
  return body as T;
}

export type TodayData = {
  day: string;
  profile: { name: string; subtitle: string };
  tasks: Task[];
  blocks: Block[];
  hours: { scene: "学习" | "生活" | "工作"; usedHours: number; capHours: number }[];
  exercise: string;
  pendingCount: number;
  week: { start: string; end: string };
};

export const api = {
  today: () => request<TodayData>("/today"),
  tasks: () => request<Task[]>("/tasks"),
  createTask: (body: { title: string; scene: Task["scene"]; minutes: number; ownerId?: string; due?: string | null }) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(body) }),
  updateTask: (id: string, body: Partial<Pick<Task, "title" | "scene" | "minutes" | "status" | "ownerId" | "due">>) =>
    request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  scheduleTask: (id: string, day: string, start: string) =>
    request<{ blockId: string; status: string }>(`/tasks/${id}/schedule`, { method: "POST", body: JSON.stringify({ day, start }) }),
  delegateTask: (id: string) => request<{ inboxId: string }>(`/tasks/${id}/delegate`, { method: "POST" }),
  blocks: (from: string, to: string) => request<Block[]>(`/blocks?from=${from}&to=${to}`),
  acceptBlock: (id: string) => request<Block>(`/blocks/${id}/accept`, { method: "POST" }),
  createBlock: (body: { day: string; start: string; end: string; title: string; scene: "学习" | "生活" | "工作"; ownerId?: string }) =>
    request<{ status: string }>("/blocks", { method: "POST", body: JSON.stringify(body) }),
  keepConflict: (group: string, blockId: string) =>
    request(`/conflicts/${group}/keep`, { method: "POST", body: JSON.stringify({ blockId }) }),
  inbox: () => request<InboxItem[]>("/inbox"),
  approve: (id: string) => request(`/inbox/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason: string) => request(`/inbox/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  snooze: (id: string) => request(`/inbox/${id}/snooze`, { method: "POST" }),
  approveReady: () => request<{ count: number }>("/inbox/approve-ready", { method: "POST" }),
  notes: () => request<Note[]>("/notes"),
  createNote: (body: { title: string; scene: Note["scene"]; body: string }) =>
    request<Note>("/notes", { method: "POST", body: JSON.stringify(body) }),
  note: (id: string) => request<{ note: Note; cards: ReviewCard[]; run: Run | null }>(`/notes/${id}`),
  noteToCard: (id: string) => request(`/notes/${id}/to-card`, { method: "POST" }),
  reviews: () => request<ReviewCard[]>("/reviews"),
  grade: (id: string, grade: "remember" | "fuzzy" | "forget") =>
    request<{ due: string; interval: number }>(`/reviews/${id}/grade`, { method: "POST", body: JSON.stringify({ grade }) }),
  agents: () => request<Agent[]>("/agents"),
  createAgent: (body: { name: string; description?: string; scenes: Agent["scenes"] }) =>
    request<Agent>("/agents", { method: "POST", body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Partial<Agent>) => request<Agent>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request(`/agents/${id}`, { method: "DELETE" }),
  runs: () => request<Run[]>("/runs"),
  run: (id: string) => request<{ run: Run; steps: RunStep[] }>(`/runs/${id}`),
  startRun: (type: Run["type"], agentId?: string, instruction?: string) =>
    request<{ id: string }>("/runs", { method: "POST", body: JSON.stringify({ type, agentId, instruction }) }),
  rerun: (id: string) => request<{ id: string }>(`/runs/${id}/rerun`, { method: "POST" }),
  settings: () => request<Settings>("/settings"),
  saveSettings: (body: Partial<Settings>) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(body) }),
  saveKey: async (apiKey: string) => {
    if (window.zhiheng) return window.zhiheng.saveKey(apiKey);
    return request<{ hasKey: boolean }>("/settings/secret", { method: "POST", body: JSON.stringify({ apiKey }) });
  },
  testModel: () => request<{ ok: true }>("/settings/test-model", { method: "POST" }),
  resetDemo: () => request("/settings/reset-demo", { method: "POST" }),
  search: (q: string) => request<{ kind: string; id: string; title: string; href: string }[]>(`/search?q=${encodeURIComponent(q)}`),
  watchRun: (id: string, onEvent: (event: RunStep | { done: true; status: string; error?: string }) => void) => {
    const source = new EventSource(`${base()}/runs/${id}/events?token=${encodeURIComponent(token())}`);
    let settled = false;
    let cancelled = false;
    let timer = 0;
    const closeSource = () => source.close();
    const emitDone = (status: string, error?: string) => {
      if (settled || cancelled) return;
      settled = true;
      closeSource();
      onEvent({ done: true, status, error });
    };
    const poll = () => {
      if (settled || cancelled) return;
      void api.run(id).then((data) => {
        if (settled || cancelled) return;
        if (data.run.status === "running") {
          timer = window.setTimeout(poll, 700);
          return;
        }
        emitDone(data.run.status, data.run.error ?? undefined);
      }).catch(() => {
        if (!settled && !cancelled) timer = window.setTimeout(poll, 700);
      });
    };
    source.onmessage = (message) => {
      if (cancelled) return;
      const event = JSON.parse(message.data) as RunStep | { done: true; status: string; error?: string };
      if ("done" in event) {
        settled = true;
        closeSource();
        onEvent(event);
        return;
      }
      onEvent(event);
    };
    source.onerror = () => {
      closeSource();
      if (!settled) poll();
    };
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      closeSource();
    };
  },
};
