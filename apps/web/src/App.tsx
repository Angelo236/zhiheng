import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./api";
import { requestCommand } from "./commands";
import { ActivityPage } from "./pages/Activity";
import { AgentsPage } from "./pages/Agents";
import { InboxPage } from "./pages/Inbox";
import { NotesPage } from "./pages/Notes";
import { SchedulePage } from "./pages/Schedule";
import { SettingsPage } from "./pages/Settings";
import { StudyPage } from "./pages/Study";
import { TasksPage } from "./pages/Tasks";
import { TodayPage } from "./pages/Today";

const links = [
  ["/", "今天"],
  ["/inbox", "收件箱"],
  ["/tasks", "任务"],
  ["/schedule", "日程"],
  ["/study", "学习"],
  ["/agents", "Agent"],
  ["/activity", "活动"],
  ["/notes", "资料"],
  ["/settings", "设置"],
] as const;

export function App() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(0);
  const [profile, setProfile] = useState({ name: "在职备考", subtitle: "" });
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ kind: string; id: string; title: string; href: string }[]>([]);

  const refreshCount = () => {
    api.today().then((data) => {
      setPending(data.pendingCount);
      setProfile(data.profile);
    }).catch(() => undefined);
  };

  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, 8000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      api.search(query).then(setHits).catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  return (
    <div className="app">
      <nav className="side" aria-label="页面">
        <div className="brand">知衡</div>
        {links.map(([href, label]) => (
          <NavLink key={href} to={href} end={href === "/"} className={({ isActive }) => `nav${isActive ? " active" : ""}`}>
            <span>{label}</span>
            {href === "/inbox" && pending > 0 ? <span className="count">{pending}</span> : null}
          </NavLink>
        ))}
        <div className="who">
          <b>{profile?.name ?? "在职备考"}</b>
          <span className="muted">{profile?.subtitle}</span>
        </div>
      </nav>
      <main className="main">
        <div className="toolbar">
          <div className="search-wrap">
            <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="任务、日程、复习、笔记" aria-label="搜索" />
            {hits.length > 0 ? (
              <div className="hits">
                {hits.map((hit) => (
                  <button key={`${hit.kind}-${hit.id}`} type="button" onClick={() => { navigate(hit.href); setQuery(""); }}>
                    <span className="muted">{hit.kind}</span> {hit.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="btn" type="button" onClick={() => setPalette(true)}>命令</button>
        </div>
        <Routes>
          <Route path="/" element={<TodayPage onChange={refreshCount} />} />
          <Route path="/inbox" element={<InboxPage onChange={refreshCount} />} />
          <Route path="/tasks" element={<TasksPage onChange={refreshCount} />} />
          <Route path="/schedule" element={<SchedulePage onChange={refreshCount} />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/activity/:id" element={<ActivityPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      {palette ? (
        <div className="palette" onClick={() => setPalette(false)}>
          <form onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => { setPalette(false); requestCommand("plan"); navigate("/"); }}>安排今天</button>
            <button type="button" onClick={() => { setPalette(false); requestCommand("shutdown"); navigate("/"); }}>结束今天</button>
            <button type="button" onClick={() => { setPalette(false); navigate("/inbox"); }}>打开收件箱</button>
            <button type="button" onClick={() => { setPalette(false); navigate("/agents"); }}>打开 Agent</button>
            <button type="button" onClick={() => { setPalette(false); void api.resetDemo().then(() => window.location.assign("/")); }}>恢复演示数据</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
