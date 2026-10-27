import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isClock, TODAY, toMinutes, weekRange, type Scene } from "@zhiheng/shared";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import {
  getSetting,
  listAgents,
  listBlocks,
  listInbox,
  listNotes,
  listReviews,
  listRuns,
  listSteps,
  listTasks,
  mapAgent,
  mapBlock,
  mapNote,
  mapTask,
  openDatabase,
  readSettings,
  resetTables,
} from "./db.js";
import {
  acceptPendingBlock,
  approveInbox,
  createInbox,
  endFromStart,
  gradeReview,
  hasSecret,
  keepConflict,
  loadSettings,
  placeBlock,
  readSecret,
  rejectInbox,
  saveSettings,
  snoozeInbox,
  writeSecret,
} from "./ledger.js";
import { completeChat } from "./llm.js";
import { exerciseNote, sceneHours } from "./policy.js";
import { executeRun, subscribe } from "./runtime.js";
import { seed } from "./seed.js";

const port = Number(process.env.ZHIHENG_PORT ?? 8787);
const token = process.env.ZHIHENG_TOKEN ?? "zhiheng-dev";
const dataFile = process.env.ZHIHENG_DATA ?? join(dirname(fileURLToPath(import.meta.url)), "../data/zhiheng.db");
const webDist = process.env.ZHIHENG_WEB ?? "";

const db = openDatabase(dataFile);
if ((db.prepare("select count(*) as n from agents").get() as { n: number }).n === 0) seed(db);

const app = Fastify({
  logger: false,
  rewriteUrl(req) {
    const url = req.url ?? "/";
    const accept = Array.isArray(req.headers.accept) ? req.headers.accept.join(",") : String(req.headers.accept ?? "");
    if ((req.method ?? "GET") !== "GET" || !accept.includes("text/html")) return url;
    const path = url.split("?")[0];
    if (path === "/" || path === "/health" || path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(path)) return url;
    const query = url.includes("?") ? `?${url.slice(url.indexOf("?") + 1)}` : "";
    return `/${query}`;
  },
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "有一项没有填对。" });
  const status = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "这次没有完成。";
  if (status >= 500) {
    console.error(error);
    return reply.code(500).send({ error: "这次没有完成。" });
  }
  return reply.code(status).send({ error: message || "这次没有完成。" });
});

const publicApi = new Set(["health", "today", "tasks", "blocks", "conflicts", "inbox", "notes", "reviews", "agents", "runs", "settings", "search"]);

app.addHook("onRequest", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (request.method === "OPTIONS") {
    reply.code(204).send();
    return;
  }
  const first = request.url.split("?")[0].split("/").filter(Boolean)[0] ?? "";
  if (first === "health" || !publicApi.has(first)) return;
  const header = request.headers.authorization;
  const queryToken = (request.query as { token?: string }).token;
  if (header === `Bearer ${token}` || queryToken === token) return;
  return reply.code(401).send({ error: "未授权" });
});

app.get("/health", async () => ({ ok: true, service: "zhiheng" }));

app.get("/today", async () => {
  const settings = loadSettings(db, dataFile);
  return {
    day: TODAY,
    profile: {
      name: getSetting(db, "profile_name", "在职备考"),
      subtitle: getSetting(db, "profile_subtitle", ""),
    },
    tasks: listTasks(db),
    blocks: listBlocks(db, TODAY, TODAY),
    hours: sceneHours(db, settings, TODAY),
    exercise: exerciseNote(db, TODAY),
    pendingCount: listInbox(db).filter((item) => item.status === "pending").length,
    week: weekRange(TODAY),
  };
});

app.get("/tasks", async () => listTasks(db));

app.post("/tasks", async (request, reply) => {
  const body = z.object({
    title: z.string().min(1),
    scene: z.enum(["学习", "生活", "工作"]),
    minutes: z.number().int().positive(),
    ownerId: z.string().default("self"),
    due: z.string().nullable().optional(),
  }).parse(request.body);
  const id = randomUUID();
  db.prepare("insert into tasks (id, title, scene, minutes, owner_id, due, status, when_label) values (?, ?, ?, ?, ?, ?, 'active', '还没排期')").run(
    id, body.title, body.scene, body.minutes, body.ownerId, body.due ?? null,
  );
  reply.code(201);
  return mapTask(db, db.prepare("select * from tasks where id = ?").get(id) as Record<string, unknown>);
});

app.patch("/tasks/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = db.prepare("select * from tasks where id = ?").get(id) as {
    title: string; scene: string; minutes: number; owner_id: string; due: string | null; status: string;
  } | undefined;
  if (!row) return reply.code(404).send({ error: "找不到任务。" });
  const body = z.object({
    title: z.string().optional(),
    scene: z.enum(["学习", "生活", "工作"]).optional(),
    minutes: z.number().int().positive().optional(),
    ownerId: z.string().optional(),
    due: z.string().nullable().optional(),
    status: z.enum(["active", "paused", "done"]).optional(),
  }).parse(request.body);
  db.prepare("update tasks set title = ?, scene = ?, minutes = ?, owner_id = ?, due = ?, status = ? where id = ?").run(
    body.title ?? row.title,
    body.scene ?? row.scene,
    body.minutes ?? row.minutes,
    body.ownerId ?? row.owner_id,
    body.due === undefined ? row.due : body.due,
    body.status ?? row.status,
    id,
  );
  return mapTask(db, db.prepare("select * from tasks where id = ?").get(id) as Record<string, unknown>);
});

app.post("/tasks/:id/schedule", async (request, reply) => {
  const { id } = request.params as { id: string };
  const task = db.prepare("select * from tasks where id = ?").get(id) as
    | { title: string; scene: Scene; minutes: number; owner_id: string }
    | undefined;
  if (!task) return reply.code(404).send({ error: "找不到任务。" });
  const body = z.object({ day: z.string(), start: z.string() }).parse(request.body);
  if (!isClock(body.start)) return reply.code(400).send({ error: "时间写成 16:00 这样。" });
  if (toMinutes(body.start) + task.minutes >= 24 * 60) return reply.code(400).send({ error: "这段时间会越过今天。" });
  if (db.prepare("select id from blocks where task_id = ? and day = ?").get(id, body.day)) {
    return reply.code(400).send({ error: "这个任务这一天已经有安排。" });
  }
  const placed = placeBlock(db, loadSettings(db, dataFile), {
    day: body.day,
    start: body.start,
    end: endFromStart(body.start, task.minutes),
    title: task.title,
    scene: task.scene,
    ownerId: task.owner_id,
    taskId: id,
  });
  if (!placed.ok) return reply.code(400).send({ error: placed.error });
  if (placed.status !== "scheduled") {
    createInbox(db, {
      kind: "block",
      title: task.title,
      detail: `${body.day} ${body.start} · ${placed.checks.overlap} · ${placed.checks.budget}`,
      agentId: "self",
      scene: task.scene,
      payload: { blockId: placed.blockId, conflictGroup: placed.conflictGroup },
      checks: placed.checks,
    });
  }
  return { blockId: placed.blockId, status: placed.status };
});

app.post("/tasks/:id/delegate", async (request, reply) => {
  const task = listTasks(db).find((item) => item.id === (request.params as { id: string }).id);
  if (!task) return reply.code(404).send({ error: "找不到任务。" });
  const inboxId = createInbox(db, {
    kind: "task",
    title: `${task.title} 的拆分`,
    detail: "交给统筹。下一次安排今天会读到这个任务。",
    agentId: "lead",
    scene: task.scene,
    payload: { taskId: task.id, minutes: Math.max(25, Math.round(task.minutes / 2)) },
    checks: { budget: "通过", overlap: "通过", sleep: "通过" },
  });
  reply.code(201);
  return { inboxId };
});

app.get("/blocks", async (request) => {
  const query = request.query as { from?: string; to?: string };
  return listBlocks(db, query.from, query.to);
});

app.post("/blocks", async (request, reply) => {
  const body = z.object({
    day: z.string(),
    start: z.string(),
    end: z.string(),
    title: z.string(),
    scene: z.enum(["学习", "生活", "工作"]),
    ownerId: z.string().default("self"),
    taskId: z.string().nullable().optional(),
    exercise: z.boolean().optional(),
  }).parse(request.body);
  const placed = placeBlock(db, loadSettings(db, dataFile), body);
  if (!placed.ok) return reply.code(400).send({ error: placed.error });
  if (placed.status !== "scheduled") {
    createInbox(db, {
      kind: "block",
      title: body.title,
      detail: `${body.day} ${body.start}–${body.end} · ${placed.checks.overlap} · ${placed.checks.budget}`,
      agentId: body.ownerId,
      scene: body.scene,
      payload: { blockId: placed.blockId, conflictGroup: placed.conflictGroup },
      checks: placed.checks,
    });
  }
  reply.code(201);
  return placed;
});

app.post("/blocks/:id/accept", async (request, reply) => {
  const result = acceptPendingBlock(db, (request.params as { id: string }).id);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return mapBlock(db, db.prepare("select * from blocks where id = ?").get((request.params as { id: string }).id) as Record<string, unknown>);
});

app.post("/conflicts/:group/keep", async (request, reply) => {
  const { group } = request.params as { group: string };
  const body = z.object({ blockId: z.string() }).parse(request.body);
  const dropped = keepConflict(db, group, body.blockId);
  if (dropped === false) return reply.code(404).send({ error: "找不到这组重叠。" });
  return { kept: body.blockId, dropped };
});

app.get("/inbox", async () => listInbox(db));
app.post("/inbox/:id/approve", async (request, reply) => {
  const result = approveInbox(db, (request.params as { id: string }).id);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { ok: true };
});
app.post("/inbox/:id/reject", async (request, reply) => {
  const body = z.object({ reason: z.string().min(1) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "写下退回理由后再确认。" });
  rejectInbox(db, (request.params as { id: string }).id, body.data.reason);
  return { ok: true };
});
app.post("/inbox/:id/snooze", async (request) => {
  snoozeInbox(db, (request.params as { id: string }).id);
  return { ok: true };
});
app.post("/inbox/approve-ready", async () => {
  const ready = listInbox(db).filter((item) => item.status === "pending" && item.checks.budget === "通过" && item.checks.overlap === "通过" && item.checks.sleep === "通过");
  for (const item of ready) approveInbox(db, item.id);
  return { count: ready.length };
});

app.get("/notes", async () => listNotes(db));
app.post("/notes", async (request, reply) => {
  const body = z.object({ title: z.string().min(1), scene: z.enum(["学习", "生活", "工作"]), body: z.string().min(1) }).parse(request.body);
  const id = randomUUID();
  db.prepare("insert into notes (id, title, scene, body, source_run_id, created_at) values (?, ?, ?, ?, null, ?)").run(id, body.title, body.scene, body.body, new Date().toISOString());
  reply.code(201);
  return mapNote(db.prepare("select * from notes where id = ?").get(id) as Record<string, unknown>);
});
app.get("/notes/:id", async (request, reply) => {
  const note = listNotes(db).find((item) => item.id === (request.params as { id: string }).id);
  if (!note) return reply.code(404).send({ error: "找不到笔记。" });
  return {
    note,
    cards: listReviews(db).filter((card) => card.noteId === note.id),
    run: note.sourceRunId ? listRuns(db).find((item) => item.id === note.sourceRunId) ?? null : null,
  };
});
app.post("/notes/:id/to-card", async (request, reply) => {
  const note = listNotes(db).find((item) => item.id === (request.params as { id: string }).id);
  if (!note) return reply.code(404).send({ error: "找不到笔记。" });
  const inboxId = createInbox(db, {
    kind: "card",
    title: `${note.title} 的复习卡`,
    detail: "复习卡 · 等待确认后进入学习",
    agentId: "notes",
    scene: note.scene,
    payload: { topic: "学习", title: note.title, noteId: note.id },
    checks: { budget: "通过", overlap: "通过", sleep: "通过" },
  });
  reply.code(201);
  return { inboxId };
});

app.get("/reviews", async () => listReviews(db));
app.post("/reviews/:id/grade", async (request, reply) => {
  const body = z.object({ grade: z.enum(["remember", "fuzzy", "forget"]) }).parse(request.body);
  const result = gradeReview(db, (request.params as { id: string }).id, body.grade);
  if (!result) return reply.code(404).send({ error: "找不到复习卡。" });
  return result;
});

app.get("/agents", async () => listAgents(db));
app.post("/agents", async (request, reply) => {
  const settings = loadSettings(db, dataFile);
  const body = z.object({
    name: z.string().min(1),
    description: z.string().default(""),
    scenes: z.array(z.enum(["学习", "生活", "工作"])).min(1),
  }).parse(request.body);
  const id = randomUUID();
  db.prepare(`insert into agents (id, name, description, scenes, model, autonomy, weekly_token_cap, quiet_start, quiet_end, status, skills, doing)
    values (?, ?, ?, ?, ?, ?, 40000, ?, ?, 'online', ?, '空闲')`).run(
    id, body.name, body.description, JSON.stringify(body.scenes), settings.modelName, settings.defaultAutonomy, settings.sleepStart, settings.sleepEnd,
    JSON.stringify(["read_ledger", "propose_task", "propose_block"]),
  );
  reply.code(201);
  return mapAgent(db.prepare("select * from agents where id = ?").get(id) as Record<string, unknown>);
});
app.patch("/agents/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = db.prepare("select * from agents where id = ?").get(id) as {
    name: string; description: string; scenes: string; model: string; autonomy: string; weekly_token_cap: number;
    quiet_start: string; quiet_end: string; status: string; skills: string; doing: string;
  } | undefined;
  if (!row) return reply.code(404).send({ error: "找不到 Agent。" });
  const body = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    scenes: z.array(z.enum(["学习", "生活", "工作"])).optional(),
    model: z.string().optional(),
    autonomy: z.enum(["observe", "draft", "ask", "act"]).optional(),
    weeklyTokenCap: z.number().optional(),
    quietStart: z.string().optional(),
    quietEnd: z.string().optional(),
    status: z.enum(["online", "paused"]).optional(),
    skills: z.array(z.string()).optional(),
    doing: z.string().optional(),
  }).parse(request.body);
  if (body.weeklyTokenCap !== undefined && !(body.weeklyTokenCap > 0)) return reply.code(400).send({ error: "每周额度要大于 0。" });
  if (body.quietStart !== undefined && !isClock(body.quietStart)) return reply.code(400).send({ error: "时间写成 23:30 这样。" });
  if (body.quietEnd !== undefined && !isClock(body.quietEnd)) return reply.code(400).send({ error: "时间写成 07:00 这样。" });
  if (body.scenes && body.scenes.length === 0) return reply.code(400).send({ error: "至少留一个场景。" });
  if (body.model !== undefined && !body.model.trim()) return reply.code(400).send({ error: "模型名不能空着。" });
  db.prepare("update agents set name=?, description=?, scenes=?, model=?, autonomy=?, weekly_token_cap=?, quiet_start=?, quiet_end=?, status=?, skills=?, doing=? where id=?").run(
    body.name ?? row.name,
    body.description ?? row.description,
    JSON.stringify(body.scenes ?? JSON.parse(String(row.scenes))),
    body.model?.trim() ?? row.model,
    body.autonomy ?? row.autonomy,
    body.weeklyTokenCap ?? row.weekly_token_cap,
    body.quietStart ?? row.quiet_start,
    body.quietEnd ?? row.quiet_end,
    body.status ?? row.status,
    JSON.stringify(body.skills ?? JSON.parse(String(row.skills))),
    body.doing ?? row.doing,
    id,
  );
  return mapAgent(db.prepare("select * from agents where id = ?").get(id) as Record<string, unknown>);
});
app.delete("/agents/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  if (["lead", "study", "calendar", "life", "retro", "notes"].includes(id)) {
    return reply.code(400).send({ error: "这六位是固定成员，可以暂停，不能删除。" });
  }
  if (!db.prepare("select id from agents where id = ?").get(id)) return reply.code(404).send({ error: "找不到 Agent。" });
  db.prepare("delete from agents where id = ?").run(id);
  reply.code(204).send();
});

app.get("/runs", async () => listRuns(db));
app.get("/runs/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const run = listRuns(db).find((item) => item.id === id);
  if (!run) return reply.code(404).send({ error: "找不到这次活动。" });
  return { run, steps: listSteps(db, id) };
});
app.post("/runs", async (request, reply) => {
  const body = z.object({ type: z.enum(["plan", "shutdown", "agent"]), agentId: z.string().optional(), instruction: z.string().optional() }).parse(request.body);
  const id = randomUUID();
  db.prepare("insert into runs (id, type, agent_id, status, started_at, finished_at, token_count, error, summary, instruction) values (?, ?, ?, 'running', ?, null, 0, null, '', ?)").run(
    id, body.type, body.agentId ?? null, new Date().toISOString(), body.instruction ?? null,
  );
  void executeRun(db, dataFile, id, body.type, body.agentId, body.instruction);
  reply.code(202);
  return { id };
});
app.post("/runs/:id/rerun", async (request, reply) => {
  const existing = db.prepare("select type, agent_id, instruction from runs where id = ?").get((request.params as { id: string }).id) as
    | { type: "plan" | "shutdown" | "agent"; agent_id: string | null; instruction: string | null }
    | undefined;
  if (!existing) return reply.code(404).send({ error: "找不到这次活动。" });
  const id = randomUUID();
  db.prepare("insert into runs (id, type, agent_id, status, started_at, finished_at, token_count, error, summary, instruction) values (?, ?, ?, 'running', ?, null, 0, null, '', ?)").run(
    id, existing.type, existing.agent_id, new Date().toISOString(), existing.instruction,
  );
  void executeRun(db, dataFile, id, existing.type, existing.agent_id ?? undefined, existing.instruction ?? undefined);
  reply.code(202);
  return { id };
});
app.get("/runs/:id/events", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  for (const step of listSteps(db, id)) send(step);
  const run = listRuns(db).find((item) => item.id === id);
  if (run && run.status !== "running") {
    send({ done: true, status: run.status, error: run.error });
    reply.raw.end();
    return;
  }
  const unsubscribe = subscribe(id, (event) => {
    send(event);
    if ("done" in event) reply.raw.end();
  });
  request.raw.on("close", unsubscribe);
});

app.get("/settings", async () => readSettings(db, dataFile, hasSecret(dataFile)));
app.put("/settings", async (request, reply) => {
  const body = z.object({
    studyCap: z.number().optional(),
    lifeCap: z.number().optional(),
    workCap: z.number().optional(),
    sleepStart: z.string().optional(),
    sleepEnd: z.string().optional(),
    defaultAutonomy: z.enum(["observe", "draft", "ask", "act"]).optional(),
    modelBaseUrl: z.string().optional(),
    modelName: z.string().optional(),
  }).parse(request.body);
  for (const value of [body.studyCap, body.lifeCap, body.workCap]) {
    if (value !== undefined && (!(value > 0) || value > 168)) return reply.code(400).send({ error: "每周小时要大于 0，并且不超过 168。" });
  }
  const current = loadSettings(db, dataFile);
  const sleepStart = body.sleepStart ?? current.sleepStart;
  const sleepEnd = body.sleepEnd ?? current.sleepEnd;
  if (body.sleepStart !== undefined || body.sleepEnd !== undefined) {
    if (!isClock(sleepStart) || !isClock(sleepEnd)) return reply.code(400).send({ error: "时间写成 23:30 这样。" });
    if (sleepStart === sleepEnd) return reply.code(400).send({ error: "睡眠的开始和结束不能相同。" });
  }
  if (body.modelBaseUrl !== undefined) body.modelBaseUrl = body.modelBaseUrl.trim();
  if (body.modelName !== undefined) body.modelName = body.modelName.trim();
  if (body.modelBaseUrl !== undefined && !/^https?:\/\/\S+$/.test(body.modelBaseUrl)) return reply.code(400).send({ error: "模型地址要以 http:// 或 https:// 开头。" });
  if (body.modelName !== undefined && !body.modelName) return reply.code(400).send({ error: "模型名不能空着。" });
  saveSettings(db, body);
  return readSettings(db, dataFile, hasSecret(dataFile));
});
app.post("/settings/secret", async (request) => {
  const body = z.object({ apiKey: z.string() }).parse(request.body);
  writeSecret(dataFile, body.apiKey.trim());
  return { hasKey: hasSecret(dataFile) };
});
app.post("/settings/test-model", async (_request, reply) => {
  const settings = loadSettings(db, dataFile);
  const key = readSecret(dataFile);
  if (!key) return reply.code(400).send({ error: "先保存密钥。" });
  try {
    await completeChat(settings, key, "只回复一个字：好", "ping");
    return { ok: true };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "连接失败" });
  }
});
app.post("/settings/reset-demo", async () => {
  resetTables(db);
  seed(db);
  return { ok: true };
});

app.get("/search", async (request) => {
  const q = String((request.query as { q?: string }).q ?? "").trim().toLowerCase();
  if (!q) return [];
  const hits: { kind: string; id: string; title: string; href: string }[] = [];
  for (const task of listTasks(db)) if (task.title.toLowerCase().includes(q)) hits.push({ kind: "任务", id: task.id, title: task.title, href: "/tasks" });
  for (const block of listBlocks(db)) if (block.title.toLowerCase().includes(q)) hits.push({ kind: "日程", id: block.id, title: `${block.day} ${block.title}`, href: "/schedule" });
  for (const agent of listAgents(db)) if (agent.name.toLowerCase().includes(q)) hits.push({ kind: "Agent", id: agent.id, title: agent.name, href: "/agents" });
  for (const note of listNotes(db)) if (`${note.title} ${note.body}`.toLowerCase().includes(q)) hits.push({ kind: "资料", id: note.id, title: note.title, href: "/notes" });
  for (const card of listReviews(db)) if (`${card.title} ${card.topic}`.toLowerCase().includes(q)) hits.push({ kind: "复习", id: card.id, title: `${card.topic} · ${card.title}`, href: "/study" });
  return hits.slice(0, 8);
});

function staticFile(root: string, url: string): string {
  const base = resolve(root);
  const index = join(base, "index.html");
  let pathname = "/";
  try {
    pathname = decodeURIComponent(url.split("?")[0]);
  } catch {
    return index;
  }
  const target = resolve(base, pathname.replace(/^\/+/, ""));
  if (target !== base && !target.startsWith(base + sep)) return index;
  if (existsSync(target) && statSync(target).isFile()) return target;
  return index;
}

app.setNotFoundHandler((request, reply) => {
  if (!webDist || (request.method !== "GET" && request.method !== "HEAD")) return reply.code(404).send({ error: "找不到" });
  const file = staticFile(webDist, request.url);
  const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html";
  if (!existsSync(file)) return reply.code(404).send({ error: "找不到" });
  return reply.type(type).send(createReadStream(file));
});

app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`zhiheng api http://127.0.0.1:${port}`);
});
