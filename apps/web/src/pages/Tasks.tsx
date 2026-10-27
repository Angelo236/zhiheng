import { useEffect, useState } from "react";
import type { Agent, Block, Task } from "@zhiheng/shared";
import { api } from "../api";

export function TasksPage({ onChange }: { onChange: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [scene, setScene] = useState<"全部" | Task["scene"]>("全部");
  const [status, setStatus] = useState<"全部" | Task["status"]>("全部");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", scene: "学习" as Task["scene"], minutes: "40", ownerId: "self" });
  const [notice, setNotice] = useState("");

  const load = () => Promise.all([api.tasks(), api.agents(), api.blocks("2026-10-26", "2026-11-01")]).then(([nextTasks, nextAgents, nextBlocks]) => {
    setTasks(nextTasks);
    setAgents(nextAgents);
    setBlocks(nextBlocks);
  });
  useEffect(() => { load().catch(() => undefined); }, []);

  const visible = tasks.filter((task) => (scene === "全部" || task.scene === scene) && (status === "全部" || task.status === status));
  const current = tasks.find((task) => task.id === selected);

  return (
    <section>
      <h1 className="page-title">任务</h1>
      <p className="muted">同一份清单。场景、负责人和状态可以筛。</p>
      <div className="filters">
        {(["全部", "学习", "生活", "工作"] as const).map((item) => <button key={item} className={`pill${scene === item ? " on" : ""}`} type="button" onClick={() => setScene(item)}>{item}</button>)}
        {(["全部", "active", "paused", "done"] as const).map((item) => <button key={item} className={`pill${status === item ? " on" : ""}`} type="button" onClick={() => setStatus(item)}>{item === "全部" ? "全部状态" : item === "active" ? "进行中" : item === "paused" ? "暂停" : "完成"}</button>)}
      </div>
      <form className="row" onSubmit={async (event) => {
        event.preventDefault();
        const minutes = Number(draft.minutes);
        if (!Number.isInteger(minutes) || minutes < 1) {
          setNotice("分钟要是大于 0 的整数。");
          return;
        }
        try {
          await api.createTask({ ...draft, minutes });
          setDraft({ ...draft, title: "" });
          setNotice("");
          await load();
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "没有记下。");
        }
      }}>
        <input value={draft.title} placeholder="新任务" onChange={(event) => setDraft({ ...draft, title: event.target.value })} required />
        <select value={draft.scene} onChange={(event) => setDraft({ ...draft, scene: event.target.value as Task["scene"] })}>
          <option>学习</option><option>生活</option><option>工作</option>
        </select>
        <input type="number" min={1} value={draft.minutes} onChange={(event) => setDraft({ ...draft, minutes: event.target.value })} aria-label="分钟" />
        <button className="btn" type="submit">新建</button>
      </form>
      {notice ? <p className="banner">{notice}</p> : null}
      {visible.map((task) => (
        <button className="plain" key={task.id} type="button" onClick={() => setSelected(task.id)}>
          <i className={`mark ${task.scene}`} aria-hidden="true" />
          <span><b>{task.title}</b><small className="muted">{task.scene} · {task.ownerName} · {task.whenLabel}</small></span>
          <span className="mins">{task.status === "active" ? "进行中" : task.status === "paused" ? "暂停" : "完成"}</span>
        </button>
      ))}
      {current ? (
        <div className="clash">
          <div className="grow">
            <b>{current.title}</b>
            <div className="muted">相关日程：{blocks.filter((block) => block.taskId === current.id).map((block) => `${block.day} ${block.start}`).join("、") || "还没有"}</div>
          </div>
          <button className="btn" type="button" onClick={async () => { await api.updateTask(current.id, { status: current.status === "paused" ? "active" : "paused" }); await load(); }}>{current.status === "paused" ? "恢复" : "暂停"}</button>
          <button className="btn" type="button" onClick={async () => { await api.updateTask(current.id, { status: "done" }); await load(); }}>完成</button>
          <button className="btn" type="button" onClick={async () => { await api.delegateTask(current.id); setNotice(`「${current.title}」已交给统筹，在收件箱里。`); onChange(); }}>交给统筹</button>
          <select value={current.ownerId} onChange={async (event) => { await api.updateTask(current.id, { ownerId: event.target.value }); await load(); }}>
            <option value="self">自己</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </div>
      ) : null}
    </section>
  );
}
