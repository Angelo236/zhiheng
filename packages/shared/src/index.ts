import { z } from "zod";

export const scenes = ["学习", "生活", "工作"] as const;
export type Scene = (typeof scenes)[number];

export const autonomies = ["observe", "draft", "ask", "act"] as const;
export type Autonomy = (typeof autonomies)[number];

export const autonomyLabel: Record<Autonomy, string> = {
  observe: "只观察",
  draft: "只起草",
  ask: "先问你",
  act: "在限额内自己写入",
};

export const skills = [
  "read_ledger",
  "propose_task",
  "propose_block",
  "propose_card",
  "write_note",
  "flag_conflict",
] as const;
export type Skill = (typeof skills)[number];

export const skillLabel: Record<Skill, string> = {
  read_ledger: "读任务和日程",
  propose_task: "提议任务",
  propose_block: "提议日程",
  propose_card: "提议复习卡",
  write_note: "写笔记",
  flag_conflict: "标出时间冲突",
};

export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  scenes: z.array(z.enum(scenes)),
  model: z.string(),
  autonomy: z.enum(autonomies),
  weeklyTokenCap: z.number(),
  quietStart: z.string(),
  quietEnd: z.string(),
  status: z.enum(["online", "paused"]),
  skills: z.array(z.enum(skills)),
  doing: z.string(),
});
export type Agent = z.infer<typeof agentSchema>;

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  scene: z.enum(scenes),
  minutes: z.number(),
  ownerId: z.string(),
  ownerName: z.string(),
  due: z.string().nullable(),
  status: z.enum(["active", "paused", "done"]),
  whenLabel: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const blockSchema = z.object({
  id: z.string(),
  day: z.string(),
  start: z.string(),
  end: z.string(),
  title: z.string(),
  scene: z.enum(["学习", "生活", "工作", "睡眠"]),
  ownerId: z.string(),
  ownerName: z.string(),
  taskId: z.string().nullable(),
  status: z.enum(["scheduled", "pending", "conflict", "window"]),
  conflictGroup: z.string().nullable(),
  reason: z.string(),
  exercise: z.boolean(),
});
export type Block = z.infer<typeof blockSchema>;

export const checksSchema = z.object({
  budget: z.string(),
  overlap: z.string(),
  sleep: z.string(),
});
export type Checks = z.infer<typeof checksSchema>;

export const inboxSchema = z.object({
  id: z.string(),
  kind: z.enum(["task", "block", "card", "note"]),
  title: z.string(),
  detail: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  scene: z.enum(scenes),
  payload: z.record(z.unknown()),
  checks: checksSchema,
  status: z.enum(["pending", "approved", "rejected", "snoozed"]),
  reason: z.string(),
  createdAt: z.string(),
});
export type InboxItem = z.infer<typeof inboxSchema>;

export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  scene: z.enum(scenes),
  body: z.string(),
  sourceRunId: z.string().nullable(),
  createdAt: z.string(),
});
export type Note = z.infer<typeof noteSchema>;

export const reviewSchema = z.object({
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  noteId: z.string().nullable(),
  due: z.string(),
  intervalDays: z.number(),
  ease: z.number(),
  reps: z.number(),
});
export type ReviewCard = z.infer<typeof reviewSchema>;

export const runSchema = z.object({
  id: z.string(),
  type: z.enum(["plan", "shutdown", "agent"]),
  agentId: z.string().nullable(),
  agentName: z.string(),
  status: z.enum(["running", "done", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  tokenCount: z.number(),
  error: z.string().nullable(),
  summary: z.string(),
});
export type Run = z.infer<typeof runSchema>;

export const runStepSchema = z.object({
  id: z.string(),
  runId: z.string(),
  seq: z.number(),
  agentId: z.string().nullable(),
  title: z.string(),
  inputJson: z.string(),
  rawOutput: z.string(),
  parsedJson: z.string(),
  decision: z.string(),
  status: z.enum(["done", "failed"]),
});
export type RunStep = z.infer<typeof runStepSchema>;

export const settingsSchema = z.object({
  studyCap: z.number(),
  lifeCap: z.number(),
  workCap: z.number(),
  sleepStart: z.string(),
  sleepEnd: z.string(),
  defaultAutonomy: z.enum(autonomies),
  modelBaseUrl: z.string(),
  modelName: z.string(),
  hasKey: z.boolean(),
  dataPath: z.string(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const proposalSchema = z.object({
  kind: z.enum(["task", "block", "card", "note", "sentence"]),
  title: z.string(),
  scene: z.enum(scenes).optional(),
  day: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  minutes: z.number().optional(),
  summary: z.string().optional(),
  topic: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
  exercise: z.boolean().optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const agentOutputSchema = z.object({
  proposals: z.array(proposalSchema).default([]),
  brief: z
    .array(z.object({ text: z.string(), evidenceId: z.string().optional() }))
    .default([]),
});

export const TODAY = "2026-10-27";

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function weekRange(day: string): { start: string; end: string } {
  const date = new Date(`${day}T12:00:00`);
  const weekday = date.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return { start: addDays(day, mondayOffset), end: addDays(day, mondayOffset + 6) };
}

export function toMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

export function fromMinutes(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function durationMinutes(start: string, end: string): number {
  let delta = toMinutes(end) - toMinutes(start);
  if (delta <= 0) delta += 24 * 60;
  return delta;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const a0 = toMinutes(aStart);
  const a1 = a0 + durationMinutes(aStart, aEnd);
  const b0 = toMinutes(bStart);
  const b1 = b0 + durationMinutes(bStart, bEnd);
  return a0 < b1 && b0 < a1;
}

export function hitsSleep(start: string, end: string, sleepStart: string, sleepEnd: string): boolean {
  const block0 = toMinutes(start);
  const block1 = block0 + durationMinutes(start, end);
  const sleep0 = toMinutes(sleepStart);
  const sleep1 = toMinutes(sleepEnd) + (toMinutes(sleepEnd) <= sleep0 ? 24 * 60 : 0);
  const blockSpans = [
    [block0, block1],
    [block0 + 24 * 60, block1 + 24 * 60],
  ];
  return blockSpans.some(([b0, b1]) => b0 < sleep1 && sleep0 < b1);
}
