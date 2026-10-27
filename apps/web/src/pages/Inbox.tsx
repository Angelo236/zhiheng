import { useEffect, useState } from "react";
import type { InboxItem } from "@zhiheng/shared";
import { ApiError, api } from "../api";

export function InboxPage({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");

  const load = () => api.inbox().then(setItems);
  useEffect(() => { load().catch(() => undefined); }, []);

  return (
    <section>
      <h1 className="page-title">收件箱</h1>
      <p className="muted">通过之后才写进今天。可以一次通过已经符合规则的改动。</p>
      {error ? <p className="err">{error}</p> : null}
      <button className="btn" type="button" disabled={acting === "ready"} onClick={async () => {
        setActing("ready");
        try {
          await api.approveReady();
          setError("");
          await load();
          onChange();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "没有通过。");
        } finally {
          setActing("");
        }
      }}>通过符合规则的</button>
      {[...items].sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending")).map((item) => (
        <div className="row inbox-row" key={item.id}>
          <div className="grow">
            <b>{item.title}</b>
            <div className="muted">{item.agentName} · {item.detail}</div>
            <div className="muted">上限 {item.checks.budget} · 重叠 {item.checks.overlap} · 睡眠 {item.checks.sleep}</div>
            {item.reason ? <div className="muted">退回理由：{item.reason}</div> : null}
            {item.status === "pending" ? (
              <div className="inbox-actions">
                <button className="btn" type="button" disabled={acting === item.id} onClick={async () => {
                  setActing(item.id);
                  try {
                    await api.approve(item.id);
                    setError("");
                    await load();
                    onChange();
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : "没有通过。");
                  } finally {
                    setActing("");
                  }
                }}>通过</button>
                <button className="btn" type="button" disabled={acting === item.id} onClick={async () => { await api.snooze(item.id); await load(); onChange(); }}>暂缓</button>
                <input value={reason[item.id] ?? ""} placeholder="退回理由" onChange={(event) => setReason({ ...reason, [item.id]: event.target.value })} />
                <button className="btn" type="button" onClick={async () => {
                  try {
                    await api.reject(item.id, reason[item.id] ?? "");
                    setError("");
                    await load();
                    onChange();
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : "没有退回。");
                  }
                }}>退回</button>
              </div>
            ) : null}
          </div>
          <span className="muted">{item.status === "pending" ? "待确认" : item.status === "approved" ? "已通过" : item.status === "snoozed" ? "已暂缓" : "已退回"}</span>
        </div>
      ))}
    </section>
  );
}
