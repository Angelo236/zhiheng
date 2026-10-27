import { TODAY } from "@zhiheng/shared";
import type { DB } from "./db.js";
import { setSetting } from "./db.js";

const allSkills = JSON.stringify([
  "read_ledger",
  "propose_task",
  "propose_block",
  "propose_card",
  "write_note",
  "flag_conflict",
]);

export function seed(db: DB) {
  const settings: Record<string, string> = {
    study_cap: "10",
    life_cap: "8",
    work_cap: "25",
    sleep_start: "23:30",
    sleep_end: "07:00",
    default_autonomy: "ask",
    model_base_url: "https://api.openai.com/v1",
    model_name: "gpt-4.1-mini",
    profile_name: "在职备考",
    profile_subtitle: "分布式系统 · 第 4 周",
    exercise_target: "3",
  };
  for (const [key, value] of Object.entries(settings)) setSetting(db, key, value);

  const insertAgent = db.prepare(`insert into agents
    (id, name, description, scenes, model, autonomy, weekly_token_cap, quiet_start, quiet_end, status, skills, doing)
    values (?, ?, ?, ?, '默认模型', ?, ?, '23:30', '07:00', ?, ?, ?)`);
  insertAgent.run("lead", "统筹", "把三个场景的改动收成一份，重叠时写出保留建议。", JSON.stringify(["学习", "生活", "工作"]), "act", 200000, "online", allSkills, "在等你定中午");
  insertAgent.run("study", "学习", "排学习块，盯到期复习。", JSON.stringify(["学习"]), "ask", 80000, "online", allSkills, "共识算法复习");
  insertAgent.run("calendar", "日程", "把任务放进空档。", JSON.stringify(["学习", "生活", "工作"]), "ask", 80000, "online", allSkills, "找空档");
  insertAgent.run("life", "生活", "守睡眠时段和每周运动，只安排时间。", JSON.stringify(["生活"]), "act", 40000, "online", allSkills, "午间步行");
  insertAgent.run("retro", "回顾", "结束今天时写一段记录。", JSON.stringify(["学习", "生活", "工作"]), "draft", 40000, "online", allSkills, "今晚写收工");
  insertAgent.run("notes", "资料", "把笔记变成复习卡。", JSON.stringify(["学习"]), "ask", 20000, "paused", allSkills, "暂停中");

  const insertTask = db.prepare(`insert into tasks (id, title, scene, minutes, owner_id, due, status, when_label) values (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertTask.run("t-review", "需求评审", "工作", 180, "self", TODAY, "active", "今天 09:00");
  insertTask.run("t-raft", "共识算法复习", "学习", 90, "study", TODAY, "active", "今天 13:30");
  insertTask.run("t-copy", "复制与一致性", "学习", 90, "study", TODAY, "active", "今天 19:10");
  insertTask.run("t-wrong", "整理错题", "学习", 40, "self", TODAY, "active", "还没排进今天");
  insertTask.run("t-walk", "午间步行", "生活", 40, "life", TODAY, "active", "今天中午");
  insertTask.run("t-grocery", "买菜", "生活", 30, "self", "2026-10-28", "active", "还没排期");
  insertTask.run("t-api", "接口评审", "工作", 210, "self", "2026-10-26", "done", "10月26日 09:00");

  const insertBlock = db.prepare(`insert into blocks
    (id, day, start, end, title, scene, owner_id, task_id, status, conflict_group, reason, exercise)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertBlock.run("b-ride", "2026-10-26", "07:00", "08:00", "骑行", "生活", "self", null, "scheduled", null, "", 1);
  insertBlock.run("b26a", "2026-10-26", "09:00", "12:30", "接口评审", "工作", "self", "t-api", "scheduled", null, "", 0);
  insertBlock.run("b26b", "2026-10-26", "20:00", "21:10", "日志复制", "学习", "study", null, "scheduled", null, "", 0);
  insertBlock.run("b-commute", TODAY, "07:40", "08:20", "通勤", "生活", "self", null, "scheduled", null, "", 0);
  insertBlock.run("b-work", TODAY, "09:00", "12:00", "需求评审", "工作", "self", "t-review", "scheduled", null, "", 0);
  insertBlock.run("b-extra", TODAY, "12:10", "13:10", "加时复习", "学习", "study", null, "conflict", "noon", "与步行重叠", 0);
  insertBlock.run("b-walk", TODAY, "12:30", "13:10", "步行", "生活", "life", "t-walk", "conflict", "noon", "与加时复习重叠", 1);
  insertBlock.run("b-raft", TODAY, "13:30", "15:00", "共识算法复习", "学习", "study", "t-raft", "pending", null, "等你确认", 0);
  insertBlock.run("b-copy", TODAY, "19:10", "20:40", "复制与一致性", "学习", "study", "t-copy", "scheduled", null, "", 0);
  insertBlock.run("b-sleep", TODAY, "23:30", "07:00", "睡眠", "睡眠", "life", null, "window", null, "学习和工作不排进这里", 0);
  insertBlock.run("b28a", "2026-10-28", "09:30", "11:30", "事务隔离", "学习", "study", null, "scheduled", null, "", 0);
  insertBlock.run("b28b", "2026-10-28", "16:00", "16:40", "步行", "生活", "life", null, "pending", null, "等你确认", 1);
  insertBlock.run("b30", "2026-10-30", "09:00", "16:00", "工作", "工作", "self", null, "scheduled", null, "", 0);
  insertBlock.run("b31", "2026-10-31", "10:00", "11:00", "复习", "学习", "study", null, "pending", null, "等你确认", 0);

  const now = "2026-10-27T08:10:00";
  const insertInbox = db.prepare(`insert into inbox
    (id, kind, title, detail, agent_id, scene, payload, checks, status, reason, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?)`);
  insertInbox.run(
    "p-raft",
    "block",
    "共识算法复习",
    "今天 13:30–15:00 · 小时和睡眠都通过",
    "study",
    "学习",
    JSON.stringify({ blockId: "b-raft" }),
    JSON.stringify({ budget: "通过", overlap: "通过", sleep: "通过" }),
    now,
  );
  insertInbox.run(
    "p-walk",
    "block",
    "午间步行",
    "今天 12:30–13:10 · 与加时复习重叠",
    "life",
    "生活",
    JSON.stringify({ blockId: "b-walk", conflictGroup: "noon" }),
    JSON.stringify({ budget: "通过", overlap: "与加时复习重叠", sleep: "通过" }),
    now,
  );
  insertInbox.run(
    "p-card",
    "card",
    "Raft 任期",
    "复习卡 · 来自 10月24日笔记",
    "notes",
    "学习",
    JSON.stringify({ topic: "Raft", title: "Raft 任期", noteId: "n1" }),
    JSON.stringify({ budget: "通过", overlap: "通过", sleep: "通过" }),
    now,
  );

  db.prepare(`insert into notes (id, title, scene, body, source_run_id, created_at) values (?, ?, ?, ?, ?, ?)`).run(
    "n1",
    "10月24日笔记",
    "学习",
    "任期是递增整数。候选人需要得到多数票。",
    null,
    "2026-10-24T21:00:00",
  );
  db.prepare(`insert into notes (id, title, scene, body, source_run_id, created_at) values (?, ?, ?, ?, ?, ?)`).run(
    "n2",
    "本周运动",
    "生活",
    "这周只骑了 1 小时，还差 2 小时。",
    null,
    "2026-10-26T08:05:00",
  );

  const insertReview = db.prepare(`insert into reviews (id, topic, title, note_id, due, interval_days, ease, reps) values (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertReview.run("c1", "Raft", "Raft 任期", "n1", TODAY, 1, 2.5, 2);
  insertReview.run("c2", "Raft", "法定人数", "n1", TODAY, 1, 2.5, 1);
  insertReview.run("c3", "Raft", "领导者选举", "n1", "2026-10-26", 1, 2.3, 1);
  insertReview.run("c4", "复制", "日志匹配", null, TODAY, 3, 2.6, 3);
  insertReview.run("c5", "事务", "隔离级别", null, "2026-10-28", 4, 2.4, 2);

  const insertRun = db.prepare(`insert into runs (id, type, agent_id, status, started_at, finished_at, token_count, error, summary) values (?, ?, ?, 'done', ?, ?, ?, null, ?)`);
  insertRun.run("run-m26", "plan", "lead", "2026-10-26T07:42:00", "2026-10-26T07:44:00", 12400, "排了周一的工作和学习");
  insertRun.run("run-e25", "shutdown", "retro", "2026-10-25T21:16:00", "2026-10-25T21:17:00", 3200, "写下当天记录");

  const insertStep = db.prepare(`insert into run_steps (id, run_id, seq, agent_id, title, input_json, raw_output, parsed_json, decision, status) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'done')`);
  insertStep.run("s1", "run-m26", 1, null, "读取账本", "{}", "", "{}", "读到 1 个目标和当天的空档");
  insertStep.run("s2", "run-m26", 2, "calendar", "日程提出两块", "{}", "接口评审放在 09:00，日志复制放在 20:00", "{}", "两块都写入");
  insertStep.run("s3", "run-m26", 3, "lead", "统筹确认", "{}", "", "{}", "没有重叠");
  insertStep.run("s4", "run-e25", 1, "retro", "回顾", "{}", "复习完成 2 张，1 张记为模糊。运动仍少 2 小时。", "{}", "写入资料");
}
