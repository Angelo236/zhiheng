import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Run, RunStep } from "@zhiheng/shared";
import { api } from "../api";

export function ActivityPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [filter, setFilter] = useState<"全部" | Run["status"]>("全部");

  useEffect(() => { api.runs().then(setRuns).catch(() => undefined); }, [id]);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = () => {
      api.run(id).then((data) => {
        if (stop) return;
        setSteps(data.steps);
        setRuns((rows) => rows.some((run) => run.id === data.run.id) ? rows.map((run) => run.id === data.run.id ? data.run : run) : [data.run, ...rows]);
        if (data.run.status === "running") window.setTimeout(tick, 700);
      }).catch(() => { if (!stop) setSteps([]); });
    };
    tick();
    return () => { stop = true; };
  }, [id]);

  const visible = runs.filter((run) => filter === "全部" || run.status === filter);
  const current = runs.find((run) => run.id === id);

  return (
    <section>
      <h1 className="page-title">活动</h1>
      <p className="muted">谁在什么时候做了什么。点开一条看步骤，失败可以重新跑，原来的记录还在。</p>
      <div className="filters">
        {(["全部", "running", "done", "failed"] as const).map((item) => (
          <button key={item} className={`pill${filter === item ? " on" : ""}`} type="button" onClick={() => setFilter(item)}>
            {item === "全部" ? "全部" : item === "running" ? "进行中" : item === "done" ? "完成" : "失败"}
          </button>
        ))}
      </div>
      {visible.map((run) => (
        <Link key={run.id} to={`/activity/${run.id}`} className="row">
          <b>{run.summary || (run.type === "plan" ? "安排今天" : run.type === "shutdown" ? "结束今天" : run.agentName)}</b>
          <span className="muted">{run.startedAt.replace("T", " ").slice(0, 16)} · {run.agentName} · {run.tokenCount} token</span>
          <span className="muted">{run.status === "done" ? "完成" : run.status === "failed" ? "失败" : "进行中"}</span>
        </Link>
      ))}
      {current ? (
        <div>
          <h2 style={{ marginTop: 24 }}>{current.summary || "这次执行"}</h2>
          {current.error ? <p className="err">{current.error}</p> : null}
          {steps.map((step) => (
            <div className="step" key={step.id}>
              <b>{step.title}</b>
              <div className="muted">{step.decision}</div>
              {step.rawOutput ? <pre>{step.rawOutput}</pre> : null}
            </div>
          ))}
          <button className="btn" type="button" onClick={async () => {
            const next = await api.rerun(current.id);
            navigate(`/activity/${next.id}`);
          }}>重新跑一次</button>
        </div>
      ) : null}
    </section>
  );
}
