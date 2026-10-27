import { useEffect, useState } from "react";
import type { Note, ReviewCard, Run } from "@zhiheng/shared";
import { api } from "../api";

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ note: Note; cards: ReviewCard[]; run: Run | null } | null>(null);
  const [draft, setDraft] = useState({ title: "", scene: "学习" as Note["scene"], body: "" });
  const [notice, setNotice] = useState("");

  const load = () => api.notes().then((rows) => {
    setNotes(rows);
    setId((current) => current ?? rows[0]?.id ?? null);
  });
  useEffect(() => { load().catch(() => undefined); }, []);
  useEffect(() => { if (id) api.note(id).then(setDetail).catch(() => undefined); }, [id]);

  return (
    <section>
      <h1 className="page-title">资料</h1>
      <form className="row" onSubmit={async (event) => {
        event.preventDefault();
        const created = await api.createNote(draft);
        setDraft({ title: "", scene: draft.scene, body: "" });
        setId(created.id);
        await load();
      }}>
        <input value={draft.title} placeholder="标题" onChange={(event) => setDraft({ ...draft, title: event.target.value })} required />
        <select value={draft.scene} onChange={(event) => setDraft({ ...draft, scene: event.target.value as Note["scene"] })}>
          <option>学习</option><option>生活</option><option>工作</option>
        </select>
        <input value={draft.body} placeholder="写一句" onChange={(event) => setDraft({ ...draft, body: event.target.value })} required />
        <button className="btn" type="submit">记下</button>
      </form>
      <div className="two">
        <div>
          {notes.map((note) => (
            <button key={note.id} className={`note-btn${note.id === id ? " on" : ""}`} type="button" onClick={() => setId(note.id)}>
              <b>{note.title}</b>
              <span className="muted">{note.scene}</span>
            </button>
          ))}
        </div>
        {detail ? (
          <div>
            <h2>{detail.note.title}</h2>
            <p>{detail.note.body}</p>
            {detail.run ? <p className="muted">来自活动 {detail.run.startedAt.slice(0, 16).replace("T", " ")}</p> : null}
            {detail.cards.length > 0 ? <p className="muted">复习卡：{detail.cards.map((card) => card.title).join("、")}</p> : null}
            <button className="btn" type="button" onClick={async () => {
              try {
                await api.noteToCard(detail.note.id);
                setNotice("复习卡已放进收件箱。");
              } catch (error) {
                setNotice(error instanceof Error ? error.message : "没有送出。");
              }
            }}>交给资料</button>
            {notice ? <p className="banner">{notice}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
