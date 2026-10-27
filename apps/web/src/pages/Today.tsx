import { useEffect, useMemo, useRef, useState } from "react";
import type { Block, Task } from "@zhiheng/shared";
import { durationMinutes, fromMinutes, rangesOverlap, toMinutes } from "@zhiheng/shared";
import { ApiError, api, type TodayData } from "../api";
import { subscribeCommand, takeCommand } from "../commands";

const HOUR = 48;
const START = 7 * 60;
const END = 24 * 60;

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dayHeading(day: string) {
  const date = new Date(`${day}T12:00:00`);
  return { num: date.getDate(), dow: weekdays[date.getDay()] ?? "", month: date.getMonth() + 1 };
}

function nowMinutes(day: string, tick: number) {
  const now = new Date(tick);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (today !== day) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < START || minutes >= END) return null;
  return minutes;
}

function nextOpenStart(task: Task, blocks: Block[], day: string) {
  const busy = blocks.filter((block) => block.status !== "window" && block.scene !== "睡眠");
  let cursor = Math.ceil((nowMinutes(day, Date.now()) ?? 16 * 60) / 10) * 10;
  if (cursor < START) cursor = START;
  while (cursor + task.minutes <= END) {
    const end = fromMinutes(cursor + task.minutes);
    const start = fromMinutes(cursor);
    const clash = busy.some((block) => rangesOverlap(start, end, block.start, block.end));
    if (!clash) return start;
    cursor += 10;
  }
  return null;
}

function sliceBlock(block: Block) {
  const start = toMinutes(block.start);
  const end = start + (block.status === "window" ? 30 : durationMinutes(block.start, block.end));
  const visibleStart = Math.max(start, START);
  const visibleEnd = Math.min(end, END);
  if (visibleEnd <= visibleStart) return null;
  return {
    top: ((visibleStart - START) / 60) * HOUR,
    height: Math.max(40, ((visibleEnd - visibleStart) / 60) * HOUR),
  };
}

export function TodayPage({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<TodayData | null>(null);
  const [scene, setScene] = useState<"全部" | "学习" | "生活" | "工作">("全部");
  const [selected, setSelected] = useState("t-raft");
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const alive = useRef(true);
  const watch = useRef<(() => void) | null>(null);
  const running = useRef(false);

  const load = () => api.today().then((next) => { if (alive.current) setData(next); }).catch((error: unknown) => { if (alive.current) setBanner(error instanceof ApiError ? error.message : "今天没有加载出来。"); });

  useEffect(() => {
    alive.current = true;
    load();
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    const unsubscribe = subscribeCommand((command) => {
      takeCommand(command);
      void run(command);
    });
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      unsubscribe();
      watch.current?.();
    };
  }, []);

  const day = data?.day ?? "2026-10-27";
  const minuteNow = nowMinutes(day, clock);
  const heading = dayHeading(day);
  const todayTaskIds = new Set((data?.blocks ?? []).map((block) => block.taskId).filter((id): id is string => Boolean(id)));
  const tasks = (data?.tasks ?? []).filter((task) => scene === "全部" || task.scene === scene).filter((task) => {
    if (task.status === "done") return false;
    if (todayTaskIds.has(task.id)) return true;
    if (task.due === day || task.whenLabel.includes("今天")) return true;
    return task.whenLabel.includes("还没") && (task.due === null || task.due <= day);
  });
  const blocks = (data?.blocks ?? []).filter((block) => scene === "全部" || block.scene === scene || (scene === "生活" && block.scene === "睡眠"));
  const hours = useMemo(() => data?.hours ?? [], [data]);
  const study = hours.find((item) => item.scene === "学习");
  const work = hours.find((item) => item.scene === "工作");

  async function run(type: "plan" | "shutdown") {
    if (running.current) return;
    running.current = true;
    if (alive.current) setBusy(true);
    try {
      const created = await api.startRun(type);
      if (!alive.current) return;
      setBanner(type === "plan" ? "正在安排今天…" : "正在写收工记录…");
      watch.current?.();
      watch.current = api.watchRun(created.id, (event) => {
        if (!alive.current || !("done" in event)) return;
        setBanner(event.error ?? (type === "plan" ? "安排已经写进收件箱或日程。" : "收工记录已放进资料。"));
        if (event.error) window.zhiheng?.notify("知衡", event.error);
        else window.zhiheng?.notify("知衡", type === "plan" ? "今天的安排有了结果" : "今天的记录已写好");
        load();
        onChange();
        watch.current?.();
        watch.current = null;
        running.current = false;
        setBusy(false);
      });
    } catch (error) {
      running.current = false;
      if (!alive.current) return;
      setBanner(error instanceof ApiError ? error.message : "这次没有开始。");
      setBusy(false);
    }
  }

  async function keep(block: Block) {
    if (!block.conflictGroup) return;
    await api.keepConflict(block.conflictGroup, block.id);
    setBanner(block.title === "步行" ? "中午留下步行。" : `留下了${block.title}。`);
    await load();
    onChange();
  }

  async function dropTask(task: Task, start: string) {
    try {
      const result = await api.scheduleTask(task.id, day, start);
      setBanner(result.status === "scheduled" ? `${task.title} 放在 ${start}。` : `${task.title} 和已有安排重叠，已放进收件箱。`);
      await load();
      onChange();
    } catch (error) {
      setBanner(error instanceof ApiError ? error.message : "没有排上。");
    }
  }

  const seen = new Set<string>();
  const timeline = blocks
    .filter((block) => {
      const start = toMinutes(block.start);
      return start >= START - 60 && start < END;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .filter((block) => {
      if (!block.conflictGroup) return true;
      if (seen.has(block.conflictGroup)) return false;
      seen.add(block.conflictGroup);
      return true;
    });

  return (
    <section>
      <div className="top">
        <div className="date">
          <h1 className="num">{heading.num}</h1>
          <div>
            <div className="dow">{heading.dow}</div>
            <div className="muted">
              {heading.month}月 · 学习 {study ? `${study.usedHours}/${study.capHours}` : "—"} 小时 · 工作 {work ? `${work.usedHours}/${work.capHours}` : "—"} 小时 · {data?.exercise ?? ""}
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn" type="button" disabled={busy} onClick={() => run("shutdown")}>结束今天</button>
          <button className="btn primary" type="button" disabled={busy} onClick={() => run("plan")}>安排今天</button>
        </div>
      </div>
      {banner ? <p className="banner">{banner}</p> : null}
      <div className="filters" role="group" aria-label="场景">
        {(["全部", "学习", "生活", "工作"] as const).map((item) => (
          <button key={item} className={`pill${scene === item ? " on" : ""}`} type="button" onClick={() => setScene(item)}>{item}</button>
        ))}
      </div>
      <div className="split">
        <div>
          <h2>任务</h2>
          {tasks.map((task) => (
            <button
              key={task.id}
              className={`task${selected === task.id ? " on" : ""}`}
              type="button"
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
              onClick={() => setSelected(task.id)}
            >
              <i className={`mark ${task.scene}`} aria-hidden="true" />
              <span>
                <b>{task.title}</b>
                <small>{task.scene} · {task.ownerName} · {task.whenLabel}</small>
              </span>
              <span className="mins">{task.minutes} 分</span>
            </button>
          ))}
          {(() => {
            const current = tasks.find((item) => item.id === selected);
            const slot = current && current.whenLabel.includes("还没") && !todayTaskIds.has(current.id) ? nextOpenStart(current, data?.blocks ?? [], day) : null;
            return current && slot ? (
              <button className="linkish" type="button" onClick={() => void dropTask(current, slot)}>把{current.title}放到 {slot}</button>
            ) : null;
          })()}
        </div>
        <div>
          <h2>时间</h2>
          <div
            className="cal"
            style={{ height: ((END - START) / 60) * HOUR }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/plain");
              const task = tasks.find((item) => item.id === id);
              if (!task || !data) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const minutes = Math.min(END - 10, START + Math.max(0, Math.round(((event.clientY - rect.top) / HOUR) * 60 / 10) * 10));
              void dropTask(task, fromMinutes(minutes));
            }}
          >
            {Array.from({ length: (END - START) / 60 }, (_, index) => (
              <div className="slot" key={index}><span>{String(7 + index).padStart(2, "0")}</span><i /></div>
            ))}
            <div className="events">
              {timeline.map((block) => {
                if (block.conflictGroup) {
                  const mates = blocks.filter((item) => item.conflictGroup === block.conflictGroup);
                  return mates.map((mate, index) => {
                    const box = sliceBlock(mate);
                    if (!box) return null;
                    return (
                      <button
                        key={mate.id}
                        className={`event ${mate.scene} ${index === 0 ? "clash-a" : "clash-b"}${selected === mate.taskId ? " on" : ""}`}
                        style={{ top: box.top, height: box.height }}
                        type="button"
                        onClick={() => keep(mate)}
                      >
                        <b>留下{mate.title}</b>
                        <small>{mate.start}–{mate.end}</small>
                      </button>
                    );
                  });
                }
                const box = sliceBlock(block);
                if (!box) return null;
                return (
                  <button
                    key={block.id}
                    className={`event ${block.scene}${selected === block.taskId ? " on" : ""}`}
                    style={{ top: box.top, height: box.height }}
                    type="button"
                    onClick={() => {
                      if (block.status === "pending") {
                        void api.acceptBlock(block.id).then(() => { void load(); onChange(); });
                        return;
                      }
                      if (block.taskId) setSelected(block.taskId);
                    }}
                  >
                    <b>{block.title}</b>
                    <small>{block.start}–{block.end}{block.status === "pending" ? " · 待确认" : ""}{block.status === "window" ? " · 睡眠" : ""}</small>
                  </button>
                );
              })}
              {minuteNow != null ? <div className="now" style={{ top: ((minuteNow - START) / 60) * HOUR }}><em>{fromMinutes(minuteNow)}</em></div> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
