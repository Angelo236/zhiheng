import { useEffect, useState } from "react";
import { autonomyLabel, isClock, skillLabel, skills, type Agent, type Autonomy, type Skill } from "@zhiheng/shared";
import { api } from "../api";

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [id, setId] = useState("study");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({ description: "", model: "", cap: "", quietStart: "", quietEnd: "" });
  const [notice, setNotice] = useState("");
  const fixed = new Set(["lead", "study", "calendar", "life", "retro", "notes"]);

  const load = () => api.agents().then((rows) => {
    setAgents(rows);
    if (!rows.some((agent) => agent.id === id) && rows[0]) setId(rows[0].id);
  });
  useEffect(() => { load().catch(() => undefined); }, []);
  const agent = agents.find((item) => item.id === id) ?? agents[0];
  useEffect(() => {
    if (!agent) return;
    setDraft({
      description: agent.description,
      model: agent.model,
      cap: String(agent.weeklyTokenCap),
      quietStart: agent.quietStart,
      quietEnd: agent.quietEnd,
    });
  }, [agent?.id, agent?.description, agent?.model, agent?.weeklyTokenCap, agent?.quietStart, agent?.quietEnd]);

  async function patch(body: Partial<Agent>) {
    if (!agent) return;
    try {
      const next = await api.updateAgent(agent.id, body);
      setAgents((rows) => rows.map((item) => item.id === next.id ? next : item));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "没有保存。");
    }
  }

  return (
    <section>
      <h1 className="page-title">成员</h1>
      <p className="muted">点一个名字，改它负责的场景和能不能自己写入。暂停后，安排今天不会再叫它。</p>
      <form className="row" onSubmit={async (event) => {
        event.preventDefault();
        const created = await api.createAgent({ name, scenes: ["学习"] });
        setName("");
        setId(created.id);
        await load();
      }}>
        <input value={name} placeholder="新成员的名字" onChange={(event) => setName(event.target.value)} required />
        <button className="btn" type="submit">新建</button>
      </form>
      <div className="two">
        <div>
          {agents.map((item) => (
            <button key={item.id} className={`agent${item.id === agent?.id ? " on" : ""}`} type="button" onClick={() => setId(item.id)}>
              <b>{item.name}</b>
              <span className="muted">{item.status === "online" ? "在线" : "已暂停"} · {item.scenes.join(" · ")}</span>
            </button>
          ))}
        </div>
        {agent ? (
          <div>
            <div className="wnum">{agent.name}</div>
            <p className="muted">今天：{agent.doing}</p>
            <label className="field">说明
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} onBlur={() => { if (draft.description !== agent.description) void patch({ description: draft.description }); }} />
            </label>
            <div className="filters">
              {(["学习", "生活", "工作"] as const).map((scene) => (
                <button key={scene} className={`pill${agent.scenes.includes(scene) ? " on" : ""}`} type="button" onClick={() => {
                  const scenes = agent.scenes.includes(scene) ? agent.scenes.filter((item) => item !== scene) : [...agent.scenes, scene];
                  if (scenes.length) void patch({ scenes });
                  else setNotice("至少留一个场景。");
                }}>{scene}</button>
              ))}
            </div>
            <div className="filters">
              {(Object.keys(autonomyLabel) as Autonomy[]).map((level) => (
                <button key={level} className={`pill${agent.autonomy === level ? " on" : ""}`} type="button" onClick={() => patch({ autonomy: level })}>{autonomyLabel[level]}</button>
              ))}
            </div>
            <div className="filters">
              {skills.map((skill) => (
                <button key={skill} className={`pill${agent.skills.includes(skill) ? " on" : ""}`} type="button" onClick={() => {
                  const next = agent.skills.includes(skill) ? agent.skills.filter((item) => item !== skill) : [...agent.skills, skill as Skill];
                  void patch({ skills: next });
                }}>{skillLabel[skill]}</button>
              ))}
            </div>
            <label className="field">模型
              <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} onBlur={() => { if (draft.model !== agent.model) void patch({ model: draft.model }); }} />
            </label>
            <label className="field">每周可用额度
              <input type="number" value={draft.cap} onChange={(event) => setDraft({ ...draft, cap: event.target.value })} onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (!Number.isFinite(value) || value <= 0) {
                  setDraft((current) => ({ ...current, cap: String(agent.weeklyTokenCap) }));
                  setNotice("每周额度要大于 0。");
                  return;
                }
                if (value !== agent.weeklyTokenCap) void patch({ weeklyTokenCap: value });
              }} />
            </label>
            <div className="row">
              <label>安静从 <input value={draft.quietStart} onChange={(event) => setDraft({ ...draft, quietStart: event.target.value })} onBlur={(event) => {
                const value = event.currentTarget.value;
                if (!isClock(value)) {
                  setDraft((current) => ({ ...current, quietStart: agent.quietStart }));
                  setNotice("时间写成 23:30 这样。");
                  return;
                }
                if (value !== agent.quietStart) void patch({ quietStart: value });
              }} /></label>
              <label>到 <input value={draft.quietEnd} onChange={(event) => setDraft({ ...draft, quietEnd: event.target.value })} onBlur={(event) => {
                const value = event.currentTarget.value;
                if (!isClock(value)) {
                  setDraft((current) => ({ ...current, quietEnd: agent.quietEnd }));
                  setNotice("时间写成 07:00 这样。");
                  return;
                }
                if (value !== agent.quietEnd) void patch({ quietEnd: value });
              }} /></label>
            </div>
            {notice ? <p className="err">{notice}</p> : null}
            <div className="actions">
              <button className="btn" type="button" onClick={() => patch({ status: agent.status === "online" ? "paused" : "online", doing: agent.status === "online" ? "暂停中" : agent.doing })}>
                {agent.status === "online" ? "暂停" : "恢复"}
              </button>
              {fixed.has(agent.id) ? null : <button className="btn" type="button" onClick={async () => { await api.deleteAgent(agent.id); await load(); }}>删除</button>}
            </div>
            <form className="row" onSubmit={async (event) => {
              event.preventDefault();
              if (!message.trim()) return;
              const created = await api.startRun("agent", agent.id, message);
              setMessage("");
              window.location.assign(`/activity/${created.id}`);
            }}>
              <input value={message} placeholder="给这位一句指示" onChange={(event) => setMessage(event.target.value)} />
              <button className="btn" type="submit">发送</button>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}
