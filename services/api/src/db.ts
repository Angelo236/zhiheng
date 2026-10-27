import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Agent, Autonomy, Block, InboxItem, Note, ReviewCard, Run, RunStep, Scene, Settings, Skill, Task } from "@zhiheng/shared";

export type DB = DatabaseSync;

export function openDatabase(file: string): DB {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("pragma journal_mode = wal");
  db.exec(`
    create table if not exists settings (key text primary key, value text not null);
    create table if not exists agents (
      id text primary key,
      name text not null,
      description text not null,
      scenes text not null,
      model text not null,
      autonomy text not null,
      weekly_token_cap integer not null,
      quiet_start text not null,
      quiet_end text not null,
      status text not null,
      skills text not null,
      doing text not null
    );
    create table if not exists tasks (
      id text primary key,
      title text not null,
      scene text not null,
      minutes integer not null,
      owner_id text not null,
      due text,
      status text not null,
      when_label text not null
    );
    create table if not exists blocks (
      id text primary key,
      day text not null,
      start text not null,
      end text not null,
      title text not null,
      scene text not null,
      owner_id text not null,
      task_id text,
      status text not null,
      conflict_group text,
      reason text not null default '',
      exercise integer not null default 0
    );
    create table if not exists inbox (
      id text primary key,
      kind text not null,
      title text not null,
      detail text not null,
      agent_id text not null,
      scene text not null,
      payload text not null,
      checks text not null,
      status text not null,
      reason text not null default '',
      created_at text not null
    );
    create table if not exists notes (
      id text primary key,
      title text not null,
      scene text not null,
      body text not null,
      source_run_id text,
      created_at text not null
    );
    create table if not exists reviews (
      id text primary key,
      topic text not null,
      title text not null,
      note_id text,
      due text not null,
      interval_days integer not null,
      ease real not null,
      reps integer not null
    );
    create table if not exists runs (
      id text primary key,
      type text not null,
      agent_id text,
      status text not null,
      started_at text not null,
      finished_at text,
      token_count integer not null default 0,
      error text,
      summary text not null default ''
    );
    create table if not exists run_steps (
      id text primary key,
      run_id text not null,
      seq integer not null,
      agent_id text,
      title text not null,
      input_json text not null,
      raw_output text not null,
      parsed_json text not null,
      decision text not null,
      status text not null
    );
  `);
  const runColumns = db.prepare("pragma table_info(runs)").all() as { name: string }[];
  if (!runColumns.some((column) => column.name === "instruction")) {
    db.exec("alter table runs add column instruction text");
  }
  return db;
}

export function resetTables(db: DB) {
  db.exec(`
    delete from run_steps;
    delete from runs;
    delete from reviews;
    delete from notes;
    delete from inbox;
    delete from blocks;
    delete from tasks;
    delete from agents;
    delete from settings;
  `);
}

type Row = Record<string, unknown>;

function ownerName(db: DB, ownerId: string): string {
  if (ownerId === "self") return "自己";
  const row = db.prepare("select name from agents where id = ?").get(ownerId) as { name: string } | undefined;
  return row?.name ?? ownerId;
}

export function mapAgent(row: Row): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    scenes: JSON.parse(String(row.scenes)) as Scene[],
    model: String(row.model),
    autonomy: String(row.autonomy) as Autonomy,
    weeklyTokenCap: Number(row.weekly_token_cap),
    quietStart: String(row.quiet_start),
    quietEnd: String(row.quiet_end),
    status: String(row.status) as Agent["status"],
    skills: JSON.parse(String(row.skills)) as Skill[],
    doing: String(row.doing),
  };
}

export function mapTask(db: DB, row: Row): Task {
  const ownerId = String(row.owner_id);
  return {
    id: String(row.id),
    title: String(row.title),
    scene: String(row.scene) as Scene,
    minutes: Number(row.minutes),
    ownerId,
    ownerName: ownerName(db, ownerId),
    due: row.due ? String(row.due) : null,
    status: String(row.status) as Task["status"],
    whenLabel: String(row.when_label),
  };
}

export function mapBlock(db: DB, row: Row): Block {
  const ownerId = String(row.owner_id);
  return {
    id: String(row.id),
    day: String(row.day),
    start: String(row.start),
    end: String(row.end),
    title: String(row.title),
    scene: String(row.scene) as Block["scene"],
    ownerId,
    ownerName: ownerName(db, ownerId),
    taskId: row.task_id ? String(row.task_id) : null,
    status: String(row.status) as Block["status"],
    conflictGroup: row.conflict_group ? String(row.conflict_group) : null,
    reason: String(row.reason ?? ""),
    exercise: Number(row.exercise) === 1,
  };
}

export function mapInbox(db: DB, row: Row): InboxItem {
  const agentId = String(row.agent_id);
  return {
    id: String(row.id),
    kind: String(row.kind) as InboxItem["kind"],
    title: String(row.title),
    detail: String(row.detail),
    agentId,
    agentName: ownerName(db, agentId),
    scene: String(row.scene) as Scene,
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
    checks: JSON.parse(String(row.checks)),
    status: String(row.status) as InboxItem["status"],
    reason: String(row.reason ?? ""),
    createdAt: String(row.created_at),
  };
}

export function mapNote(row: Row): Note {
  return {
    id: String(row.id),
    title: String(row.title),
    scene: String(row.scene) as Scene,
    body: String(row.body),
    sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    createdAt: String(row.created_at),
  };
}

export function mapReview(row: Row): ReviewCard {
  return {
    id: String(row.id),
    topic: String(row.topic),
    title: String(row.title),
    noteId: row.note_id ? String(row.note_id) : null,
    due: String(row.due),
    intervalDays: Number(row.interval_days),
    ease: Number(row.ease),
    reps: Number(row.reps),
  };
}

export function mapRun(db: DB, row: Row): Run {
  const agentId = row.agent_id ? String(row.agent_id) : null;
  return {
    id: String(row.id),
    type: String(row.type) as Run["type"],
    agentId,
    agentName: agentId ? ownerName(db, agentId) : "统筹",
    status: String(row.status) as Run["status"],
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    tokenCount: Number(row.token_count),
    error: row.error ? String(row.error) : null,
    summary: String(row.summary ?? ""),
  };
}

export function mapStep(row: Row): RunStep {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    seq: Number(row.seq),
    agentId: row.agent_id ? String(row.agent_id) : null,
    title: String(row.title),
    inputJson: String(row.input_json),
    rawOutput: String(row.raw_output),
    parsedJson: String(row.parsed_json),
    decision: String(row.decision),
    status: String(row.status) as RunStep["status"],
  };
}

export function listAgents(db: DB): Agent[] {
  return (db.prepare("select * from agents order by rowid").all() as Row[]).map(mapAgent);
}

export function listTasks(db: DB): Task[] {
  return (db.prepare("select * from tasks order by rowid").all() as Row[]).map((row) => mapTask(db, row));
}

export function listBlocks(db: DB, from?: string, to?: string): Block[] {
  const rows = (from && to
    ? db.prepare("select * from blocks where day >= ? and day <= ? order by day, start").all(from, to)
    : db.prepare("select * from blocks order by day, start").all()) as Row[];
  return rows.map((row) => mapBlock(db, row));
}

export function listInbox(db: DB): InboxItem[] {
  return (db.prepare("select * from inbox order by created_at desc").all() as Row[]).map((row) => mapInbox(db, row));
}

export function listNotes(db: DB): Note[] {
  return (db.prepare("select * from notes order by created_at desc").all() as Row[]).map(mapNote);
}

export function listReviews(db: DB): ReviewCard[] {
  return (db.prepare("select * from reviews order by due, title").all() as Row[]).map(mapReview);
}

export function listRuns(db: DB): Run[] {
  return (db.prepare("select * from runs order by started_at desc").all() as Row[]).map((row) => mapRun(db, row));
}

export function listSteps(db: DB, runId: string): RunStep[] {
  return (db.prepare("select * from run_steps where run_id = ? order by seq").all(runId) as Row[]).map(mapStep);
}

export function getSetting(db: DB, key: string, fallback = ""): string {
  const row = db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(db: DB, key: string, value: string) {
  db.prepare("insert into settings(key, value) values(?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
}

export function readSettings(db: DB, dataPath: string, hasKey: boolean): Settings {
  return {
    studyCap: Number(getSetting(db, "study_cap", "10")),
    lifeCap: Number(getSetting(db, "life_cap", "8")),
    workCap: Number(getSetting(db, "work_cap", "25")),
    sleepStart: getSetting(db, "sleep_start", "23:30"),
    sleepEnd: getSetting(db, "sleep_end", "07:00"),
    defaultAutonomy: getSetting(db, "default_autonomy", "ask") as Settings["defaultAutonomy"],
    modelBaseUrl: getSetting(db, "model_base_url", "https://api.openai.com/v1"),
    modelName: getSetting(db, "model_name", "gpt-4.1-mini"),
    hasKey,
    dataPath,
  };
}
