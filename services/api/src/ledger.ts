import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  addDays,
  durationMinutes,
  fromMinutes,
  hitsSleep,
  isClock,
  rangesOverlap,
  TODAY,
  toMinutes,
  type Proposal,
  type Settings,
} from "@zhiheng/shared";
import type { DB } from "./db.js";
import { getSetting, listBlocks, listNotes, listTasks, setSetting } from "./db.js";
import { checksPass, evaluateBlock } from "./policy.js";

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function secretPath(dataFile: string): string {
  return `${dataFile}.secret`;
}

export function hasSecret(dataFile: string): boolean {
  return existsSync(secretPath(dataFile));
}

export function readSecret(dataFile: string): string {
  const file = secretPath(dataFile);
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trim();
}

export function writeSecret(dataFile: string, value: string) {
  const file = secretPath(dataFile);
  if (!value) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  writeFileSync(file, value, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function loadSettings(db: DB, dataFile: string): Settings {
  return {
    studyCap: Number(getSetting(db, "study_cap", "10")),
    lifeCap: Number(getSetting(db, "life_cap", "8")),
    workCap: Number(getSetting(db, "work_cap", "25")),
    sleepStart: getSetting(db, "sleep_start", "23:30"),
    sleepEnd: getSetting(db, "sleep_end", "07:00"),
    defaultAutonomy: getSetting(db, "default_autonomy", "ask") as Settings["defaultAutonomy"],
    modelBaseUrl: getSetting(db, "model_base_url", "https://api.openai.com/v1"),
    modelName: getSetting(db, "model_name", "gpt-4.1-mini"),
    hasKey: hasSecret(dataFile),
    dataPath: dataFile,
  };
}

export function saveSettings(db: DB, patch: Partial<Settings>) {
  const map: Record<string, string | number | undefined> = {
    study_cap: patch.studyCap,
    life_cap: patch.lifeCap,
    work_cap: patch.workCap,
    sleep_start: patch.sleepStart,
    sleep_end: patch.sleepEnd,
    default_autonomy: patch.defaultAutonomy,
    model_base_url: patch.modelBaseUrl,
    model_name: patch.modelName,
  };
  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined) setSetting(db, key, String(value));
  }
}

export function createInbox(
  db: DB,
  item: {
    kind: "task" | "block" | "card" | "note";
    title: string;
    detail: string;
    agentId: string;
    scene: "学习" | "生活" | "工作";
    payload: Record<string, unknown>;
    checks: { budget: string; overlap: string; sleep: string };
  },
) {
  const id = randomUUID();
  db.prepare(`insert into inbox (id, kind, title, detail, agent_id, scene, payload, checks, status, reason, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?)`).run(
    id,
    item.kind,
    item.title,
    item.detail,
    item.agentId,
    item.scene,
    JSON.stringify(item.payload),
    JSON.stringify(item.checks),
    new Date().toISOString(),
  );
  return id;
}

function syncTaskLabel(db: DB, taskId: string) {
  const rows = db.prepare(`select day, start, status from blocks where task_id = ?
    order by case status when 'scheduled' then 0 when 'pending' then 1 else 2 end, day, start`).all(taskId) as { day: string; start: string; status: string }[];
  const current = rows[0];
  const when = current ? (current.day === TODAY ? `今天 ${current.start}` : `${current.day.slice(5)} ${current.start}`) : "";
  const label = !current ? "还没排期" : current.status === "scheduled" ? when : `待确认 ${when}`;
  db.prepare("update tasks set when_label = ? where id = ?").run(label, taskId);
}

export function placeBlock(
  db: DB,
  settings: Settings,
  input: {
    day: string;
    start: string;
    end: string;
    title: string;
    scene: "学习" | "生活" | "工作" | "睡眠";
    ownerId: string;
    taskId?: string | null;
    exercise?: boolean;
    agentId?: string;
  },
): { ok: true; blockId: string; checks: { budget: string; overlap: string; sleep: string }; conflictGroup: string | null; status: string } | { ok: false; error: string } {
  if (!isClock(input.start) || !isClock(input.end)) return { ok: false, error: "时间写成 16:00 这样。" };
  if (toMinutes(input.end) <= toMinutes(input.start)) return { ok: false, error: "结束时间要晚于开始时间。" };
  if (input.scene !== "睡眠" && input.scene !== "生活" && hitsSleep(input.start, input.end, settings.sleepStart, settings.sleepEnd)) {
    return { ok: false, error: "学习和工作不能排进睡眠时段。" };
  }
  const draft = { id: "new", day: input.day, start: input.start, end: input.end, scene: input.scene };
  const checks = evaluateBlock(db, settings, draft);
  const clashes = listBlocks(db).filter(
    (block) =>
      block.day === input.day &&
      block.scene !== "睡眠" &&
      block.status !== "window" &&
      rangesOverlap(input.start, input.end, block.start, block.end),
  );
  const id = randomUUID();
  const conflict = clashes.length > 0;
  const overBudget = checks.budget !== "通过";
  const existingGroups = clashes.map((block) => block.conflictGroup).filter((group): group is string => Boolean(group));
  const group = conflict ? existingGroups[0] ?? randomUUID() : null;
  const touched = new Set<string>();
  if (group) {
    const involved = listBlocks(db).filter((block) => existingGroups.includes(block.conflictGroup ?? "") || clashes.some((item) => item.id === block.id));
    for (const block of involved) {
      db.prepare("update blocks set status = 'conflict', conflict_group = ?, reason = ? where id = ?").run(
        group,
        clashes.some((item) => item.id === block.id) ? `与${input.title}重叠` : "同一组重叠",
        block.id,
      );
      if (block.taskId) touched.add(block.taskId);
    }
  }
  const status = conflict ? "conflict" : overBudget ? "pending" : "scheduled";
  db.prepare(`insert into blocks (id, day, start, end, title, scene, owner_id, task_id, status, conflict_group, reason, exercise)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    input.day,
    input.start,
    input.end,
    input.title,
    input.scene,
    input.ownerId,
    input.taskId ?? null,
    status,
    group,
    conflict ? checks.overlap : overBudget ? checks.budget : "",
    input.exercise ? 1 : 0,
  );
  if (input.taskId) touched.add(input.taskId);
  for (const taskId of touched) syncTaskLabel(db, taskId);
  return { ok: true, blockId: id, checks, conflictGroup: group, status };
}

export function keepConflict(db: DB, group: string, blockId: string) {
  const rows = db.prepare("select id, title, task_id from blocks where conflict_group = ?").all(group) as { id: string; title: string; task_id: string | null }[];
  if (!rows.some((row) => row.id === blockId)) return false;
  const dropped = rows.filter((row) => row.id !== blockId).map((row) => row.title);
  const taskIds = rows.map((row) => row.task_id).filter((id): id is string => Boolean(id));
  db.prepare("delete from blocks where conflict_group = ? and id != ?").run(group, blockId);
  db.prepare("update blocks set status = 'scheduled', conflict_group = null, reason = '' where id = ?").run(blockId);
  db.prepare("update inbox set status = 'approved' where status = 'pending' and payload like ?").run(`%${blockId}%`);
  db.prepare("update inbox set status = 'rejected', reason = ? where status = 'pending' and payload like ?").run(
    "已留下另一份安排",
    `%${group}%`,
  );
  for (const taskId of taskIds) syncTaskLabel(db, taskId);
  return dropped;
}

export function acceptPendingBlock(db: DB, id: string): { ok: true } | { ok: false; error: string } {
  const block = db.prepare("select status, conflict_group, task_id from blocks where id = ?").get(id) as
    | { status: string; conflict_group: string | null; task_id: string | null }
    | undefined;
  if (!block) return { ok: false, error: "找不到日程。" };
  if (block.status === "window") return { ok: false, error: "睡眠时段不用确认。" };
  if (block.status === "conflict" || block.conflict_group) return { ok: false, error: "这两份重叠，要先留下一份。" };
  db.prepare("update blocks set status = 'scheduled', conflict_group = null, reason = '' where id = ?").run(id);
  db.prepare("update inbox set status = 'approved' where status = 'pending' and payload like ?").run(`%${id}%`);
  if (block.task_id) syncTaskLabel(db, block.task_id);
  return { ok: true };
}

export function approveInbox(db: DB, id: string): { ok: true } | { ok: false; error: string } {
  const row = db.prepare("select * from inbox where id = ?").get(id) as
    | { status: string; kind: string; title: string; scene: string; agent_id: string; payload: string; checks: string }
    | undefined;
  if (!row) return { ok: false, error: "找不到这条改动。" };
  if (row.status !== "pending") return { ok: false, error: "这条已经处理过。" };
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const checks = JSON.parse(row.checks) as { sleep: string };
  if (checks.sleep !== "通过") return { ok: false, error: "学习和工作不能排进睡眠时段。" };
  if (row.kind === "block" && typeof payload.blockId === "string") {
    const block = db.prepare("select conflict_group, task_id from blocks where id = ?").get(payload.blockId) as { conflict_group: string | null; task_id: string | null } | undefined;
    if (!block) return { ok: false, error: "这份日程已经不在了。" };
    if (block.conflict_group) {
      if (keepConflict(db, block.conflict_group, payload.blockId) === false) return { ok: false, error: "找不到这组重叠。" };
    } else {
      db.prepare("update blocks set status = 'scheduled', conflict_group = null, reason = '' where id = ?").run(payload.blockId);
      if (block.task_id) syncTaskLabel(db, block.task_id);
    }
  }
  if (row.kind === "card") {
    db.prepare(`insert into reviews (id, topic, title, note_id, due, interval_days, ease, reps) values (?, ?, ?, ?, ?, 1, 2.5, 0)`).run(
      randomUUID(),
      String(payload.topic ?? "学习"),
      String(payload.title ?? row.title),
      payload.noteId ? String(payload.noteId) : null,
      localDay(),
    );
  }
  if (row.kind === "task") {
    const minutes = Number(payload.minutes ?? 30);
    const scene = row.scene;
    db.prepare(`insert into tasks (id, title, scene, minutes, owner_id, due, status, when_label) values (?, ?, ?, ?, ?, ?, 'active', '还没排期')`).run(
      randomUUID(),
      row.title,
      scene,
      minutes,
      row.agent_id,
      payload.due ? String(payload.due) : null,
    );
  }
  if (row.kind === "note") {
    db.prepare(`insert into notes (id, title, scene, body, source_run_id, created_at) values (?, ?, ?, ?, ?, ?)`).run(
      randomUUID(),
      row.title,
      row.scene,
      String(payload.body ?? ""),
      payload.runId ? String(payload.runId) : null,
      new Date().toISOString(),
    );
  }
  db.prepare("update inbox set status = 'approved' where id = ?").run(id);
  return { ok: true };
}

export function rejectInbox(db: DB, id: string, reason: string) {
  const row = db.prepare("select kind, payload from inbox where id = ? and status = 'pending'").get(id) as
    | { kind: string; payload: string }
    | undefined;
  db.prepare("update inbox set status = 'rejected', reason = ? where id = ? and status = 'pending'").run(reason, id);
  if (row?.kind !== "block") return;
  const payload = JSON.parse(row.payload) as { blockId?: string };
  if (!payload.blockId) return;
  const block = db.prepare("select conflict_group, status, task_id from blocks where id = ?").get(payload.blockId) as
    | { conflict_group: string | null; status: string; task_id: string | null }
    | undefined;
  if (!block || block.status === "scheduled") return;
  db.prepare("delete from blocks where id = ?").run(payload.blockId);
  if (block.task_id) syncTaskLabel(db, block.task_id);
  if (!block.conflict_group) return;
  const left = db.prepare("select id, task_id from blocks where conflict_group = ?").all(block.conflict_group) as { id: string; task_id: string | null }[];
  if (left.length === 1) {
    db.prepare("update blocks set status = 'scheduled', conflict_group = null, reason = '' where id = ?").run(left[0].id);
    if (left[0].task_id) syncTaskLabel(db, left[0].task_id);
  }
}

export function snoozeInbox(db: DB, id: string) {
  db.prepare("update inbox set status = 'snoozed' where id = ? and status = 'pending'").run(id);
}

export function gradeReview(db: DB, id: string, grade: "remember" | "fuzzy" | "forget") {
  const row = db.prepare("select interval_days, ease, reps from reviews where id = ?").get(id) as
    | { interval_days: number; ease: number; reps: number }
    | undefined;
  if (!row) return null;
  let interval = row.interval_days;
  let ease = row.ease;
  let reps = row.reps;
  if (grade === "remember") {
    interval = Math.max(4, Math.round(interval * ease));
    ease = Math.min(3, ease + 0.1);
    reps += 1;
  } else if (grade === "fuzzy") {
    interval = Math.max(2, Math.round(interval * 1.2));
    reps += 1;
  } else {
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
    reps = 0;
  }
  const due = addDays(localDay(), interval);
  db.prepare("update reviews set interval_days = ?, ease = ?, reps = ?, due = ? where id = ?").run(interval, ease, reps, due, id);
  return { due, interval };
}

export function applyProposal(
  db: DB,
  settings: Settings,
  agentId: string,
  autonomy: "observe" | "draft" | "ask" | "act",
  proposal: Proposal,
  knownIds: Set<string>,
): string {
  if (proposal.kind === "sentence") {
    const evidence = proposal.evidenceIds[0];
    const verified = evidence ? knownIds.has(evidence) : false;
    return verified ? `简报：${proposal.title}` : `简报未核实：${proposal.title}`;
  }
  if (autonomy === "observe") return `只观察，未写入：${proposal.title}`;
  const scene = proposal.scene ?? "学习";
  if (proposal.kind === "block" && proposal.start && proposal.end) {
    const day = proposal.day ?? TODAY;
    if (!isClock(proposal.start) || !isClock(proposal.end) || toMinutes(proposal.end) <= toMinutes(proposal.start)) {
      return `未写入：${proposal.title} 的时间不完整`;
    }
    if (scene !== "生活" && hitsSleep(proposal.start, proposal.end, settings.sleepStart, settings.sleepEnd)) {
      return `未写入：${proposal.title} 进入了睡眠时段`;
    }
    const agent = db.prepare("select name, quiet_start, quiet_end from agents where id = ?").get(agentId) as
      | { name: string; quiet_start: string; quiet_end: string }
      | undefined;
    if (
      agent &&
      agent.quiet_start !== agent.quiet_end &&
      isClock(agent.quiet_start) &&
      isClock(agent.quiet_end) &&
      hitsSleep(proposal.start, proposal.end, agent.quiet_start, agent.quiet_end)
    ) {
      return `未写入：${proposal.title} 落在${agent.name}的安静时段`;
    }
    const placed = placeBlock(db, settings, {
      day,
      start: proposal.start,
      end: proposal.end,
      title: proposal.title,
      scene,
      ownerId: agentId,
      exercise: proposal.exercise,
      agentId,
    });
    if (!placed.ok) return placed.error;
    const committed = autonomy === "act" && placed.status === "scheduled";
    if (!committed && placed.status === "scheduled") {
      db.prepare("update blocks set status = 'pending', reason = '等你确认' where id = ?").run(placed.blockId);
    }
    if (!committed) {
      createInbox(db, {
        kind: "block",
        title: proposal.title,
        detail: `${day} ${proposal.start}–${proposal.end} · ${placed.checks.budget} · ${placed.checks.overlap} · ${placed.checks.sleep}`,
        agentId,
        scene,
        payload: { blockId: placed.blockId, conflictGroup: placed.conflictGroup },
        checks: placed.checks,
      });
      return `已送进收件箱：${proposal.title}`;
    }
    return `已写入日程：${proposal.title}`;
  }
  if (proposal.kind === "task") {
    createInbox(db, {
      kind: "task",
      title: proposal.title,
      detail: proposal.summary ?? "新任务",
      agentId,
      scene,
      payload: { minutes: proposal.minutes ?? 30, due: proposal.day ?? null },
      checks: { budget: "通过", overlap: "通过", sleep: "通过" },
    });
    return `任务提案已送进收件箱：${proposal.title}`;
  }
  if (proposal.kind === "card") {
    createInbox(db, {
      kind: "card",
      title: proposal.title,
      detail: proposal.summary ?? "复习卡",
      agentId,
      scene,
      payload: { topic: proposal.topic ?? "学习", title: proposal.title },
      checks: { budget: "通过", overlap: "通过", sleep: "通过" },
    });
    return `复习卡已送进收件箱：${proposal.title}`;
  }
  if (proposal.kind === "note") {
    if (autonomy === "act") {
      db.prepare(`insert into notes (id, title, scene, body, source_run_id, created_at) values (?, ?, ?, ?, null, ?)`).run(
        randomUUID(),
        proposal.title,
        scene,
        proposal.summary ?? "",
        new Date().toISOString(),
      );
      return `已写入资料：${proposal.title}`;
    }
    createInbox(db, {
      kind: "note",
      title: proposal.title,
      detail: "笔记",
      agentId,
      scene,
      payload: { body: proposal.summary ?? "" },
      checks: { budget: "通过", overlap: "通过", sleep: "通过" },
    });
    return `笔记已送进收件箱：${proposal.title}`;
  }
  return `未处理：${proposal.title}`;
}

export function knownEvidenceIds(db: DB): Set<string> {
  const ids = new Set<string>();
  for (const task of listTasks(db)) ids.add(task.id);
  for (const block of listBlocks(db)) ids.add(block.id);
  for (const note of listNotes(db)) ids.add(note.id);
  return ids;
}

export function endFromStart(start: string, minutes: number): string {
  return fromMinutes(toMinutes(start) + minutes);
}

export function blockDetail(title: string, start: string, end: string): string {
  return `${title} ${start}–${end}（${durationMinutes(start, end)} 分钟）`;
}
