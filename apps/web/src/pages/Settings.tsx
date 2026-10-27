import { useEffect, useState } from "react";
import { autonomyLabel, isClock, type Autonomy, type Settings } from "@zhiheng/shared";
import { ApiError, api } from "../api";

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [caps, setCaps] = useState({ study: "10", life: "8", work: "25", sleepStart: "23:30", sleepEnd: "07:00", modelBaseUrl: "https://api.openai.com/v1", modelName: "gpt-4.1-mini" });
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");

  const load = () => api.settings().then((next) => {
    setSettings(next);
    setCaps({
      study: String(next.studyCap),
      life: String(next.lifeCap),
      work: String(next.workCap),
      sleepStart: next.sleepStart,
      sleepEnd: next.sleepEnd,
      modelBaseUrl: next.modelBaseUrl,
      modelName: next.modelName,
    });
  });
  useEffect(() => {
    load().catch(() => undefined);
    const reset = () => { api.resetDemo().then(() => window.location.assign("/")); };
    document.addEventListener("zhiheng-reset", reset);
    return () => document.removeEventListener("zhiheng-reset", reset);
  }, []);

  if (!settings) return <p className="muted">正在读取设置。</p>;
  const saved = settings;

  async function save(patch: Partial<Settings>) {
    try {
      const next = await api.saveSettings(patch);
      setSettings(next);
      setMessage("已保存。");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "没有保存。");
      setCaps((current) => ({
        ...current,
        study: patch.studyCap !== undefined ? String(saved.studyCap) : current.study,
        life: patch.lifeCap !== undefined ? String(saved.lifeCap) : current.life,
        work: patch.workCap !== undefined ? String(saved.workCap) : current.work,
        sleepStart: patch.sleepStart !== undefined ? saved.sleepStart : current.sleepStart,
        sleepEnd: patch.sleepEnd !== undefined ? saved.sleepEnd : current.sleepEnd,
        modelBaseUrl: patch.modelBaseUrl !== undefined ? saved.modelBaseUrl : current.modelBaseUrl,
        modelName: patch.modelName !== undefined ? saved.modelName : current.modelName,
      }));
    }
  }

  function commitNumber(field: "studyCap" | "lifeCap" | "workCap", raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 168) {
      setCaps((current) => ({ ...current, study: String(saved.studyCap), life: String(saved.lifeCap), work: String(saved.workCap) }));
      setMessage("每周小时要大于 0，并且不超过 168。");
      return;
    }
    const current = field === "studyCap" ? saved.studyCap : field === "lifeCap" ? saved.lifeCap : saved.workCap;
    if (value !== current) void save({ [field]: value });
  }

  function commitClock(field: "sleepStart" | "sleepEnd", raw: string) {
    if (!isClock(raw)) {
      setCaps((current) => ({ ...current, [field]: saved[field] }));
      setMessage("时间写成 23:30 这样。");
      return;
    }
    const other = field === "sleepStart" ? caps.sleepEnd : caps.sleepStart;
    if (raw === other) {
      setCaps((current) => ({ ...current, [field]: saved[field] }));
      setMessage("睡眠的开始和结束不能相同。");
      return;
    }
    if (raw !== saved[field]) void save({ [field]: raw });
  }

  return (
    <section>
      <h1 className="page-title">设置</h1>
      <p className="muted">改小时上限后，今天页头的那一句会跟着变。数据在 {settings.dataPath}</p>
      <label className="field">学习，每周小时
        <input type="number" value={caps.study} onChange={(event) => setCaps({ ...caps, study: event.target.value })} onBlur={(event) => commitNumber("studyCap", event.currentTarget.value)} />
      </label>
      <label className="field">生活，每周小时
        <input type="number" value={caps.life} onChange={(event) => setCaps({ ...caps, life: event.target.value })} onBlur={(event) => commitNumber("lifeCap", event.currentTarget.value)} />
      </label>
      <label className="field">工作，每周小时
        <input type="number" value={caps.work} onChange={(event) => setCaps({ ...caps, work: event.target.value })} onBlur={(event) => commitNumber("workCap", event.currentTarget.value)} />
      </label>
      <div className="row">
        <label>睡眠从 <input value={caps.sleepStart} onChange={(event) => setCaps({ ...caps, sleepStart: event.target.value })} onBlur={(event) => commitClock("sleepStart", event.currentTarget.value)} /></label>
        <label>到 <input value={caps.sleepEnd} onChange={(event) => setCaps({ ...caps, sleepEnd: event.target.value })} onBlur={(event) => commitClock("sleepEnd", event.currentTarget.value)} /></label>
      </div>
      <label className="field">新成员的默认自主权
        <select value={settings.defaultAutonomy} onChange={(event) => save({ defaultAutonomy: event.target.value as Autonomy })}>
          {(Object.keys(autonomyLabel) as Autonomy[]).map((item) => <option key={item} value={item}>{autonomyLabel[item]}</option>)}
        </select>
      </label>
      <label className="field">模型地址
        <input value={caps.modelBaseUrl} onChange={(event) => setCaps({ ...caps, modelBaseUrl: event.target.value })} onBlur={(event) => { if (event.currentTarget.value !== saved.modelBaseUrl) void save({ modelBaseUrl: event.currentTarget.value }); }} />
      </label>
      <label className="field">模型名
        <input value={caps.modelName} onChange={(event) => setCaps({ ...caps, modelName: event.target.value })} onBlur={(event) => { if (event.currentTarget.value !== saved.modelName) void save({ modelName: event.currentTarget.value }); }} />
      </label>
      <label className="field">密钥 {settings.hasKey ? "已保存" : "还没有"}
        <input type="password" value={key} placeholder="粘贴后保存" onChange={(event) => setKey(event.target.value)} />
      </label>
      <div className="actions">
        <button className="btn" type="button" onClick={async () => { const result = await api.saveKey(key); setSettings({ ...saved, hasKey: result.hasKey }); setKey(""); setMessage("密钥已保存。"); }}>保存密钥</button>
        <button className="btn" type="button" onClick={async () => { await api.saveKey(""); setSettings({ ...saved, hasKey: false }); setMessage("密钥已清除。"); }}>清除</button>
        <button className="btn" type="button" onClick={async () => {
          try {
            await api.testModel();
            setMessage("连接成功。");
          } catch (error) {
            setMessage(error instanceof ApiError ? error.message : "连接失败。");
          }
        }}>测试连接</button>
        <button className="btn" type="button" onClick={() => api.resetDemo().then(() => window.location.assign("/"))}>恢复演示数据</button>
      </div>
      {message ? <p className="banner">{message}</p> : null}
    </section>
  );
}
