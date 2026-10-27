import { randomUUID } from "node:crypto";
import { TODAY, agentOutputSchema, type Agent } from "@zhiheng/shared";
import type { DB } from "./db.js";
import { listAgents, listBlocks, listReviews, listTasks } from "./db.js";
import { applyProposal, knownEvidenceIds, loadSettings, readSecret } from "./ledger.js";
import { completeChat, extractJson } from "./llm.js";
import { exerciseNote, sceneHours } from "./policy.js";

export type StepEvent = {
  id: string;
  seq: number;
  title: string;
  decision: string;
  status: "done" | "failed";
};

const listeners = new Map<string, Set<(event: StepEvent | { done: true; status: string; error?: string }) => void>>();

export function subscribe(runId: string, listener: (event: StepEvent | { done: true; status: string; error?: string }) => void) {
  const set = listeners.get(runId) ?? new Set();
  set.add(listener);
  listeners.set(runId, set);
  return () => set.delete(listener);
}

function emit(runId: string, event: StepEvent | { done: true; status: string; error?: string }) {
  for (const listener of listeners.get(runId) ?? []) listener(event);
}

function snapshot(db: DB) {
  return {
    today: TODAY,
    tasks: listTasks(db).map((task) => ({ id: task.id, title: task.title, scene: task.scene, minutes: task.minutes, when: task.whenLabel, status: task.status })),
    blocks: listBlocks(db, TODAY, TODAY).map((block) => ({
      id: block.id,
      title: block.title,
      scene: block.scene,
      start: block.start,
      end: block.end,
      status: block.status,
    })),
    reviews: listReviews(db)
      .filter((card) => card.due <= TODAY)
      .map((card) => ({ id: card.id, title: card.title, topic: card.topic, due: card.due })),
  };
}

function systemPrompt(sleepStart: string, sleepEnd: string) {
  return `你是知衡里的一个个人助理。只返回 JSON，不要写解释。
格式：{"proposals":[{"kind":"task|block|card|note|sentence","title":"","scene":"学习|生活|工作","day":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","minutes":30,"summary":"","topic":"","evidenceIds":["已有编号"],"exercise":false}],"brief":[{"text":"","evidenceId":""}]}
规则：学习和工作不能排进 ${sleepStart} 到 ${sleepEnd}。输入里的 quiet 是这位成员的安静时段，安静时段里不要排日程。时间重叠要在 summary 里写明。evidenceIds 只能使用输入里出现过的 id。没有把握的句子把 evidenceId 留空。`;
}

export async function executeRun(db: DB, dataFile: string, runId: string, type: "plan" | "shutdown" | "agent", agentId?: string, instruction?: string) {
  const settings = loadSettings(db, dataFile);
  const key = readSecret(dataFile);
  const finish = (status: "done" | "failed", error: string | null, summary: string, tokens = 0) => {
    db.prepare("update runs set status = ?, finished_at = ?, error = ?, summary = ?, token_count = ? where id = ?").run(
      status,
      new Date().toISOString(),
      error,
      summary,
      tokens,
      runId,
    );
    emit(runId, { done: true, status, error: error ?? undefined });
  };
  if (!key) {
    finish("failed", "还没有模型密钥。接通后这次才会执行。", "");
    return;
  }

  const all = listAgents(db);
  const selected: Agent[] =
    type === "shutdown"
      ? all.filter((agent) => agent.id === "retro" && agent.status === "online")
      : type === "agent"
        ? all.filter((agent) => agent.id === agentId && agent.status === "online")
        : all.filter((agent) => agent.status === "online" && agent.id !== "lead" && agent.id !== "retro");
  if (selected.length === 0) {
    finish("failed", "没有可调用的 Agent。暂停中的成员不会参加。", "");
    return;
  }

  const facts = snapshot(db);
  const hours = sceneHours(db, settings, TODAY);
  const known = knownEvidenceIds(db);
  let tokens = 0;
  let seq = 1;
  const collected: { agent: Agent; output: ReturnType<typeof agentOutputSchema.parse> }[] = [];

  const pushStep = (title: string, agent: string | null, input: unknown, raw: string, parsed: unknown, decision: string, status: "done" | "failed") => {
    const id = randomUUID();
    db.prepare(`insert into run_steps (id, run_id, seq, agent_id, title, input_json, raw_output, parsed_json, decision, status)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, runId, seq, agent, title, JSON.stringify(input), raw, JSON.stringify(parsed), decision, status);
    const event = { id, seq, title, decision, status };
    seq += 1;
    emit(runId, event);
  };

  pushStep("读取账本", null, facts, "", { hours, exercise: exerciseNote(db, TODAY) }, "已装入今天的任务、日程和到期复习", "done");

  for (const agent of selected) {
    const user = JSON.stringify({
      role: agent.name,
      description: agent.description,
      scenes: agent.scenes,
      autonomy: agent.autonomy,
      quiet: [agent.quietStart, agent.quietEnd],
      facts,
      hours,
      exercise: exerciseNote(db, TODAY),
      ask: instruction || (type === "shutdown" ? "写一段今天的收工记录，放进 note 提案。" : "按职责提出今天需要的改动。"),
    });
    try {
      let raw = "";
      let parsed: ReturnType<typeof agentOutputSchema.parse> | null = null;
      let lastError = "";
      for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
        const reply = await completeChat(settings, key, systemPrompt(settings.sleepStart, settings.sleepEnd), attempt === 0 ? user : `${user}\n上次输出无法解析：${lastError}。请只返回 JSON。`);
        tokens += reply.tokens;
        raw = reply.content;
        try {
          parsed = agentOutputSchema.parse(extractJson(raw));
        } catch (error) {
          lastError = error instanceof Error ? error.message : "无法解析";
        }
      }
      if (!parsed) {
        pushStep(agent.name, agent.id, user, raw, {}, lastError, "failed");
        continue;
      }
      collected.push({ agent, output: parsed });
      const decision = parsed.proposals.map((item) => item.title).join("、") || "没有提案";
      pushStep(agent.name, agent.id, { scenes: agent.scenes }, raw, parsed, decision, "done");
    } catch (error) {
      const message = error instanceof Error ? error.message : "调用失败";
      pushStep(agent.name, agent.id, {}, "", {}, message, "failed");
    }
  }

  if (type === "plan") {
    const lead = all.find((agent) => agent.id === "lead");
    if (lead && collected.length > 1) {
      const merged = collected.flatMap((item) => item.output.proposals.map((proposal) => ({ agent: item.agent.name, ...proposal })));
      pushStep("统筹", "lead", merged, "", merged, merged.length ? "按各成员的提案继续落账" : "没有需要合并的提案", "done");
    }
  }

  const lines: string[] = [];
  for (const item of collected) {
    for (const proposal of item.output.proposals) {
      lines.push(applyProposal(db, settings, item.agent.id, item.agent.autonomy, proposal, known));
    }
    for (const sentence of item.output.brief) {
      const verified = sentence.evidenceId ? known.has(sentence.evidenceId) : false;
      lines.push(verified ? `已核实：${sentence.text}` : `未核实：${sentence.text}`);
    }
  }
  if (type === "shutdown") {
    const body = lines.filter(Boolean).join("\n") || "今天没有新的记录。";
    db.prepare(`insert into notes (id, title, scene, body, source_run_id, created_at) values (?, ?, '生活', ?, ?, ?)`).run(
      randomUUID(),
      `${TODAY} 收工`,
      body,
      runId,
      new Date().toISOString(),
    );
  }
  const failed = db.prepare("select count(*) as n from run_steps where run_id = ? and status = 'failed'").get(runId) as { n: number };
  finish(failed.n && collected.length === 0 ? "failed" : "done", failed.n && collected.length === 0 ? "模型步骤失败" : null, lines.join("\n"), tokens);
}
