import { useEffect, useState } from "react";
import { TODAY, type ReviewCard } from "@zhiheng/shared";
import { api } from "../api";

export function StudyPage() {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [topic, setTopic] = useState("Raft");

  const [grading, setGrading] = useState<string | null>(null);

  const load = () => api.reviews().then((rows) => {
    setCards(rows);
    setTopic((current) => rows.some((card) => card.topic === current) ? current : rows[0]?.topic ?? current);
  });
  useEffect(() => { load().catch(() => undefined); }, []);

  const topics = [...new Set(cards.map((card) => card.topic))];
  const current = cards.filter((card) => card.topic === topic);
  const due = cards.filter((card) => card.due <= TODAY);
  const topicDue = due.filter((card) => card.topic === topic);

  async function grade(id: string, value: "remember" | "fuzzy" | "forget") {
    if (grading) return;
    setGrading(id);
    try {
      const result = await api.grade(id, value);
      setCards((rows) => rows.map((row) => row.id === id ? { ...row, due: result.due, intervalDays: result.interval } : row));
    } finally {
      setGrading(null);
    }
  }

  return (
    <section>
      <h1 className="page-title">{topic}</h1>
      <p className="muted">这一组到期 {topicDue.length} 张，今天一共 {due.length} 张。记住了会把间隔拉长，忘记则明天再出现。</p>
      <div className="filters">
        {topics.map((item) => (
          <button key={item} className={`pill${topic === item ? " on" : ""}`} type="button" onClick={() => setTopic(item)}>{item}</button>
        ))}
      </div>
      <div className="row">
        <div><span className="muted">卡片</span><b>{current.length} 张</b></div>
        <div><span className="muted">来源</span><b>{current.find((card) => card.noteId)?.noteId ? "有笔记" : "日程和错题"}</b></div>
        <div><span className="muted">下次</span><b>{current[0]?.due ?? "—"}</b></div>
      </div>
      {topicDue.length === 0 ? <p className="muted">这一组今天没有到期的。</p> : topicDue.map((card) => (
        <div className="row" key={card.id}>
          <b>{card.title}</b>
          <span className="muted">{card.topic} · {card.due === TODAY ? "今天到期" : "已逾期"}</span>
          <button className="btn" type="button" disabled={grading === card.id} onClick={() => void grade(card.id, "remember")}>记住了</button>
          <button className="btn" type="button" disabled={grading === card.id} onClick={() => void grade(card.id, "fuzzy")}>模糊</button>
          <button className="btn" type="button" disabled={grading === card.id} onClick={() => void grade(card.id, "forget")}>忘记</button>
        </div>
      ))}
    </section>
  );
}
