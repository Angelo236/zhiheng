import { useEffect, useState } from "react";
import type { Block } from "@zhiheng/shared";
import { addDays, weekRange } from "@zhiheng/shared";
import { api } from "../api";

const labels = ["一", "二", "三", "四", "五", "六", "日"];

export function SchedulePage({ onChange }: { onChange: () => void }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [day, setDay] = useState("2026-10-27");
  const [scene, setScene] = useState<"全部" | "学习" | "生活" | "工作">("全部");
  const [hours, setHours] = useState("");
  const [error, setError] = useState("");
  const week = weekRange("2026-10-27");
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.start, index));

  const load = () => {
    api.blocks(week.start, week.end).then(setBlocks).catch(() => undefined);
    api.today().then((data) => {
      const line = data.hours.map((item) => `${item.scene} ${item.usedHours} / ${item.capHours} 小时`).join(" · ");
      setHours(line);
    }).catch(() => undefined);
  };
  useEffect(() => { load(); }, []);

  const visible = blocks.filter((block) => {
    if (block.day !== day) return false;
    if (scene === "全部") return true;
    if (block.scene === scene) return true;
    return scene === "生活" && block.scene === "睡眠";
  });

  return (
    <section>
      <h1 className="page-title">这一周</h1>
      <p className="muted">{hours}</p>
      {error ? <p className={error.startsWith("还没") ? "banner" : "err"}>{error}</p> : null}
      <div className="filters">
        {(["全部", "学习", "生活", "工作"] as const).map((item) => (
          <button key={item} className={`pill${scene === item ? " on" : ""}`} type="button" onClick={() => setScene(item)}>{item}</button>
        ))}
      </div>
      <div className="week">
        {days.map((date, index) => {
          const count = blocks.filter((block) => block.day === date && block.status !== "window").length;
          return (
            <button key={date} className={`wday${day === date ? " on" : ""}`} type="button" onClick={() => setDay(date)}>
              <span className="muted">周{labels[index]}</span>
              <span className="wnum">{Number(date.slice(8))}</span>
              <span className="chip">{count === 0 ? "空" : `${count} 件事`}</span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? <p className="muted">这一天还没有安排。</p> : visible.map((block) => (
        <div className="row" key={block.id}>
          <span className="mins">{block.start}</span>
          <b>{block.title}</b>
          <span className="muted">{block.scene} · {block.ownerName}</span>
          <span className="muted">{block.status === "scheduled" ? "已安排" : block.status === "pending" ? "待确认" : block.status === "conflict" ? "重叠" : "睡眠"}</span>
          {block.status === "pending" ? <button className="btn" type="button" onClick={async () => { try { await api.acceptBlock(block.id); setError(""); load(); onChange(); } catch (err) { setError(err instanceof Error ? err.message : "没有接受。"); } }}>接受</button> : null}
          {block.status === "conflict" && block.conflictGroup ? <button className="btn" type="button" onClick={async () => { try { await api.keepConflict(block.conflictGroup!, block.id); setError(""); load(); onChange(); } catch (err) { setError(err instanceof Error ? err.message : "没有留下。"); } }}>留下这份</button> : null}
        </div>
      ))}
      <form className="row" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
          const placed = await api.createBlock({
            day,
            start: String(form.get("start")),
            end: String(form.get("end")),
            title: String(form.get("title")),
            scene: String(form.get("scene")) as "学习" | "生活" | "工作",
            ownerId: "self",
          });
          event.currentTarget.reset();
          setError(placed.status === "scheduled" ? "" : "还没直接写上，已放进收件箱。");
          load();
          onChange();
        } catch (err) {
          setError(err instanceof Error ? err.message : "没有写进日程。");
        }
      }}>
        <input name="title" placeholder="新的日程" required />
        <input name="start" placeholder="16:00" required />
        <input name="end" placeholder="16:40" required />
        <select name="scene" defaultValue="学习"><option>学习</option><option>生活</option><option>工作</option></select>
        <button className="btn" type="submit">放进这一天</button>
      </form>
    </section>
  );
}
