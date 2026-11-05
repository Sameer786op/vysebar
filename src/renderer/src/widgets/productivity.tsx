// Focus timers, a stopwatch, to-dos, notes, screen time and your day on one line.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, Check, Flag, Pause, Play, Plus, RotateCcw, SkipForward, StickyNote, Trash2, Watch } from "lucide-react";
import type { Note, Todo } from "@shared/types";
import { countdown, duration, stopwatch, clock } from "../lib/format";
import { setData, uid, useData, useNow, useStore, useTopic } from "../lib/state";
import { Bars, CardHeader, Chip, Empty, IconButton, Ring } from "../components/ui";
import type { CardProps, WidgetDef } from "./types";
import { useAllEvents } from "./calendar";

const stop = (e: React.MouseEvent) => e.stopPropagation();

function PlayButton({ playing, color, onClick, size = 30 }: { playing: boolean; color: string; onClick: () => void; size?: number }) {
  return (
    <button
      onClick={(e) => {
        stop(e);
        onClick();
      }}
      className="grid shrink-0 place-items-center rounded-full text-white transition-transform active:scale-90"
      style={{ width: size, height: size, background: color }}
    >
      {playing ? <Pause size={size * 0.45} fill="white" /> : <Play size={size * 0.45} fill="white" className="ml-[2px]" />}
    </button>
  );
}

// ---------- pomodoro ----------

function usePomodoro() {
  const p = useData().pomodoro;
  const now = useNow(p.endsAt ? 250 : 5000);
  const left = p.endsAt ? p.endsAt - now : p.remaining;
  const total = (p.phase === "focus" ? p.focusMin : p.phase === "short" ? p.shortMin : p.longMin) * 60_000;
  const today = new Date().toDateString();
  return {
    p,
    left,
    total,
    done: p.day === today ? p.completedToday : 0,
    toggle: () =>
      setData({ pomodoro: p.endsAt ? { ...p, endsAt: null, remaining: Math.max(0, p.endsAt - Date.now()) } : { ...p, endsAt: Date.now() + p.remaining } }),
    reset: () => setData({ pomodoro: { ...p, endsAt: null, phase: "focus", round: 1, remaining: p.focusMin * 60_000 } }),
    skip: () => {
      const next = p.phase === "focus" ? (p.round >= p.rounds ? "long" : "short") : "focus";
      const mins = next === "focus" ? p.focusMin : next === "short" ? p.shortMin : p.longMin;
      setData({ pomodoro: { ...p, phase: next, endsAt: null, remaining: mins * 60_000, round: p.phase === "focus" ? p.round : p.phase === "long" ? 1 : p.round + 1 } });
    },
  };
}

const phaseColor = { focus: "#ff453a", short: "#30d158", long: "#0a84ff" };
const phaseName = { focus: "Focus", short: "Break", long: "Long break" };

function PomodoroTile() {
  const { p, left, toggle } = usePomodoro();
  const c = phaseColor[p.phase];
  return (
    <div className="flex h-full items-center gap-3 rounded-[15px] pl-3.5 pr-2" style={{ boxShadow: p.endsAt ? `inset 0 0 0 1.5px ${c}` : undefined }}>
      <div className="flex flex-col leading-none">
        <span className="text-[10.5px] font-semibold" style={{ color: c }}>
          {phaseName[p.phase]} {p.phase === "focus" && <span style={{ color: "var(--fg3)" }}>{p.round}/{p.rounds}</span>}
        </span>
        <span className="tabular mt-1 text-[19px] font-semibold">{countdown(left)}</span>
      </div>
      <PlayButton playing={!!p.endsAt} color={c} onClick={toggle} />
    </div>
  );
}

function PomodoroCard(_: CardProps) {
  const { p, left, total, done, toggle, reset, skip } = usePomodoro();
  const c = phaseColor[p.phase];
  const setMins = (k: "focusMin" | "shortMin" | "longMin", v: number) => {
    const next = { ...p, [k]: v };
    if (!p.endsAt && ((k === "focusMin" && p.phase === "focus") || (k === "shortMin" && p.phase === "short") || (k === "longMin" && p.phase === "long"))) next.remaining = v * 60_000;
    setData({ pomodoro: next });
  };
  return (
    <div>
      <CardHeader title="Pomodoro" sub={`${done} focus ${done === 1 ? "round" : "rounds"} today`} />
      <div className="flex flex-col items-center py-2">
        <Ring value={1 - left / total} size={170} stroke={10} color={c}>
          <div className="text-center">
            <div className="text-[12px] font-semibold" style={{ color: c }}>{phaseName[p.phase]}</div>
            <div className="tabular text-[38px] font-semibold leading-tight">{countdown(left)}</div>
            <div className="text-[11px]" style={{ color: "var(--fg2)" }}>Round {p.round} of {p.rounds}</div>
          </div>
        </Ring>
        <div className="mt-4 flex items-center gap-3">
          <IconButton onClick={reset} title="Reset" size={38}><RotateCcw size={16} /></IconButton>
          <PlayButton playing={!!p.endsAt} color={c} onClick={toggle} size={52} />
          <IconButton onClick={skip} title="Skip" size={38}><SkipForward size={16} /></IconButton>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {([["focusMin", "Focus", [15, 25, 50]], ["shortMin", "Break", [5, 10]], ["longMin", "Long", [15, 20, 30]]] as const).map(([k, label, opts]) => (
          <div key={k} className="rounded-[12px] p-2" style={{ background: "var(--chip)" }}>
            <div className="mb-1 text-[10.5px]" style={{ color: "var(--fg2)" }}>{label}</div>
            <div className="flex flex-wrap gap-1">
              {opts.map((m) => (
                <button key={m} onClick={() => setMins(k, m)} className="rounded-full px-1.5 py-[1px] text-[11px] font-semibold" style={{ background: p[k] === m ? c : "transparent", color: p[k] === m ? "white" : "var(--fg)" }}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- timer ----------

function useTimer() {
  const t = useData().timer;
  const now = useNow(t.endsAt ? 250 : 5000);
  const left = t.endsAt ? t.endsAt - now : t.remaining;
  return {
    t,
    left,
    toggle: () => setData({ timer: t.endsAt ? { ...t, endsAt: null, remaining: Math.max(0, t.endsAt - Date.now()) } : { ...t, endsAt: Date.now() + (t.remaining || t.duration) } }),
    set: (ms: number) => setData({ timer: { ...t, duration: ms, remaining: ms, endsAt: null } }),
    reset: () => setData({ timer: { ...t, endsAt: null, remaining: t.duration } }),
  };
}

function TimerTile() {
  const { t, left, toggle } = useTimer();
  return (
    <div className="flex h-full items-center gap-3 rounded-[15px] pl-3.5 pr-2" style={{ boxShadow: t.endsAt ? "inset 0 0 0 1.5px #0a84ff" : undefined }}>
      <div className="flex flex-col leading-none">
        <span className="text-[10.5px] font-semibold text-[#0a84ff]">Timer</span>
        <span className="tabular mt-1 text-[19px] font-semibold">{countdown(left)}</span>
      </div>
      <PlayButton playing={!!t.endsAt} color="#0a84ff" onClick={toggle} />
    </div>
  );
}

function TimerCard(_: CardProps) {
  const { t, left, toggle, set, reset } = useTimer();
  const [h, setH] = useState(0);
  const [m, setM] = useState(5);
  const [s, setS] = useState(0);
  const custom = (h * 3600 + m * 60 + s) * 1000;
  const field = (v: number, setV: (n: number) => void, max: number, label: string) => (
    <label className="flex flex-col items-center">
      <input type="number" min={0} max={max} value={v} onChange={(e) => setV(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} className="tabular w-[56px] rounded-[10px] bg-[var(--chip)] py-1.5 text-center text-[18px] font-semibold outline-none" />
      <span className="mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>{label}</span>
    </label>
  );
  return (
    <div>
      <CardHeader title="Timer" sub={t.endsAt ? `Ends at ${clock(t.endsAt, false)}` : "Ready"} />
      <div className="flex flex-col items-center">
        <Ring value={t.duration ? 1 - left / t.duration : 0} size={150} stroke={9} color="#0a84ff">
          <div className="tabular text-[34px] font-semibold">{countdown(left)}</div>
        </Ring>
        <div className="mt-3 flex items-center gap-3">
          <IconButton onClick={reset} size={38} title="Reset"><RotateCcw size={16} /></IconButton>
          <PlayButton playing={!!t.endsAt} color="#0a84ff" onClick={toggle} size={50} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {t.presets.map((p) => (
          <Chip key={p} active={t.duration === p && !t.endsAt} onClick={() => set(p)}>{p >= 3600_000 ? `${p / 3600_000} h` : `${p / 60_000} min`}</Chip>
        ))}
      </div>
      <div className="mt-4 flex items-start justify-center gap-2">
        {field(h, setH, 23, "hours")}
        {field(m, setM, 59, "min")}
        {field(s, setS, 59, "sec")}
        <button
          onClick={() => {
            if (!custom) return;
            set(custom);
            if (!t.presets.includes(custom)) setData({ timer: { ...t, duration: custom, remaining: custom, endsAt: null, presets: [...t.presets, custom].sort((a, b) => a - b).slice(-6) } });
          }}
          className="h-[38px] rounded-[10px] px-3 text-[12px] font-semibold text-white"
          style={{ background: "#0a84ff" }}
        >
          Set
        </button>
      </div>
    </div>
  );
}

// ---------- stopwatch ----------

function useStopwatch() {
  const w = useData().stopwatch;
  const now = useNow(w.startedAt ? 50 : 5000);
  const elapsed = w.elapsed + (w.startedAt ? now - w.startedAt : 0);
  return {
    w,
    elapsed,
    toggle: () => setData({ stopwatch: w.startedAt ? { ...w, startedAt: null, elapsed: w.elapsed + Date.now() - w.startedAt } : { ...w, startedAt: Date.now() } }),
    lap: () => setData({ stopwatch: { ...w, laps: [w.elapsed + (w.startedAt ? Date.now() - w.startedAt : 0), ...w.laps].slice(0, 50) } }),
    reset: () => setData({ stopwatch: { startedAt: null, elapsed: 0, laps: [] } }),
  };
}

function StopwatchTile() {
  const { w, elapsed, toggle } = useStopwatch();
  return (
    <div className="flex h-full items-center gap-3 pl-3.5 pr-2">
      <div className="flex flex-col leading-none">
        <span className="text-[10.5px] font-semibold text-[#ff9f0a]">Stopwatch</span>
        <span className="tabular mt-1 text-[19px] font-semibold">{stopwatch(elapsed).slice(0, -3)}</span>
      </div>
      <PlayButton playing={!!w.startedAt} color="#ff9f0a" onClick={toggle} />
    </div>
  );
}

function StopwatchCard(_: CardProps) {
  const { w, elapsed, toggle, lap, reset } = useStopwatch();
  return (
    <div>
      <CardHeader title="Stopwatch" />
      <div className="tabular py-3 text-center text-[44px] font-semibold tracking-tight">{stopwatch(elapsed)}</div>
      <div className="flex items-center justify-center gap-3">
        <IconButton onClick={w.startedAt ? lap : reset} size={42} title={w.startedAt ? "Lap" : "Reset"}>
          {w.startedAt ? <Flag size={16} /> : <RotateCcw size={16} />}
        </IconButton>
        <PlayButton playing={!!w.startedAt} color="#ff9f0a" onClick={toggle} size={52} />
      </div>
      <div className="thin-scroll mt-4 max-h-[180px] overflow-y-auto">
        {w.laps.map((l, i) => (
          <div key={i} className="flex justify-between border-t py-1.5 text-[12.5px]" style={{ borderColor: "var(--line)" }}>
            <span style={{ color: "var(--fg2)" }}>Lap {w.laps.length - i}</span>
            <span className="tabular font-medium">{stopwatch(l - (w.laps[i + 1] ?? 0))}</span>
            <span className="tabular" style={{ color: "var(--fg2)" }}>{stopwatch(l)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- to-dos ----------

function TodosTile() {
  const todos = useData().todos;
  const open = todos.filter((t) => !t.done);
  const done = todos.length - open.length;
  const next = open[0];
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5" style={{ maxWidth: 240 }}>
      <Ring value={todos.length ? done / todos.length : 0} size={32} stroke={3.5} color="#0a84ff">
        <span className="text-[11px] font-bold">{open.length}</span>
      </Ring>
      {next ? (
        <button
          className="group flex min-w-0 items-center gap-2"
          onClick={(e) => {
            stop(e);
            setData({ todos: todos.map((t) => (t.id === next.id ? { ...t, done: true } : t)) });
          }}
        >
          <span className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors group-hover:bg-[#30d158]" style={{ borderColor: "var(--fg3)" }}>
            <Check size={10} className="opacity-0 group-hover:opacity-100" color="white" />
          </span>
          <span className="truncate text-[12.5px] font-semibold">{next.text}</span>
        </button>
      ) : (
        <div className="flex flex-col leading-tight">
          <span className="text-[12.5px] font-semibold">All done</span>
          <span className="text-[10.5px]" style={{ color: "var(--fg2)" }}>Click to add one</span>
        </div>
      )}
    </div>
  );
}

function TodosCard(_: CardProps) {
  const todos = useData().todos;
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    // "call mom at 5pm" or "tomorrow" sets a due time
    let due: number | undefined;
    const m = /\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(t);
    if (m) {
      const d = new Date();
      let h = Number(m[1]) % 12;
      if ((m[3] ?? "").toLowerCase() === "pm" || (!m[3] && Number(m[1]) < 8)) h += 12;
      if (!m[3] && Number(m[1]) >= 13) h = Number(m[1]);
      d.setHours(h, Number(m[2] ?? 0), 0, 0);
      if (/\btomorrow\b/i.test(t) || d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      due = d.getTime();
    }
    setData({ todos: [{ id: uid(), text: t, done: false, createdAt: Date.now(), due }, ...todos] });
    setText("");
  };
  const list = todos.filter((t) => showDone || !t.done);
  const done = todos.filter((t) => t.done).length;
  return (
    <div>
      <CardHeader
        title="To-do"
        sub={`${todos.length - done} open · ${done} done`}
        right={done > 0 && <Chip onClick={() => setShowDone(!showDone)}>{showDone ? "Hide done" : "Show done"}</Chip>}
      />
      <div className="mb-2 flex items-center gap-2 rounded-[12px] px-3 py-2" style={{ background: "var(--chip)" }}>
        <Plus size={15} style={{ color: "var(--fg2)" }} />
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a to-do  (try “review PR at 4pm”)" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg3)]" />
      </div>
      <div className="thin-scroll max-h-[300px] overflow-y-auto">
        <AnimatePresence initial={false}>
          {list.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-2.5 rounded-[10px] px-1.5 py-[7px] hover:bg-[var(--chip)]">
              <button
                onClick={() => setData({ todos: todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) })}
                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors"
                style={{ borderColor: t.done ? "#30d158" : "var(--fg3)", background: t.done ? "#30d158" : "transparent" }}
              >
                {t.done && <Check size={11} color="white" strokeWidth={3} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]" style={{ textDecoration: t.done ? "line-through" : undefined, color: t.done ? "var(--fg3)" : "var(--fg)" }}>{t.text}</div>
                {t.due && !t.done && <div className="text-[10.5px]" style={{ color: t.due < Date.now() ? "#ff453a" : "var(--fg2)" }}>{new Date(t.due).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>}
              </div>
              <button className="opacity-0 transition-opacity group-hover:opacity-60" onClick={() => setData({ todos: todos.filter((x) => x.id !== t.id) })}>
                <Trash2 size={13} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {!list.length && <Empty>Nothing to do. Enjoy it.</Empty>}
      </div>
    </div>
  );
}

// ---------- notes ----------

function NotesTile() {
  const notes = useData().notes;
  const n = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const [title, ...rest] = (n?.text ?? "").split("\n");
  return (
    <div className="flex h-full items-center gap-2.5 pl-2 pr-3.5" style={{ maxWidth: 220 }}>
      <div className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-[10px]" style={{ background: "linear-gradient(#ffd60a 0 28%, #fff7d1 28%)" }}>
        <StickyNote size={15} className="mt-2 text-[#8a6d00]" />
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12.5px] font-semibold">{title || "New note"}</span>
        <span className="truncate text-[10.5px]" style={{ color: "var(--fg2)" }}>{rest.join(" ").trim() || (n ? "No more text" : "Click to write")}</span>
      </div>
    </div>
  );
}

function NotesCard(_: CardProps) {
  const notes = useData().notes;
  const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  const [sel, setSel] = useState<string | null>(sorted[0]?.id ?? null);
  const current = notes.find((n) => n.id === sel);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [draft, setDraft] = useState(current?.text ?? "");
  useEffect(() => setDraft(current?.text ?? ""), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (text: string) => {
    setDraft(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const list = useStore.getState().data.notes;
      setData({ notes: list.map((n) => (n.id === sel ? { ...n, text, updatedAt: Date.now() } : n)) });
    }, 300);
  };
  const create = () => {
    const n: Note = { id: uid(), text: "", updatedAt: Date.now() };
    setData({ notes: [n, ...notes] });
    setSel(n.id);
  };
  return (
    <div className="flex h-[340px] gap-3">
      <div className="thin-scroll flex w-[150px] shrink-0 flex-col gap-1 overflow-y-auto">
        <button onClick={create} className="flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-[12px] font-semibold" style={{ background: "var(--chip)" }}>
          <Plus size={13} /> New note
        </button>
        {sorted.map((n) => (
          <button key={n.id} onClick={() => setSel(n.id)} className="rounded-[10px] px-2 py-1.5 text-left" style={{ background: n.id === sel ? "var(--accent)" : "transparent", color: n.id === sel ? "white" : "var(--fg)" }}>
            <div className="truncate text-[12px] font-semibold">{n.text.split("\n")[0] || "New note"}</div>
            <div className="truncate text-[10px] opacity-70">{new Date(n.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</div>
          </button>
        ))}
      </div>
      {current ? (
        <div className="flex min-w-0 flex-1 flex-col rounded-[14px] p-3" style={{ background: "#fff8d6", color: "#2b2400" }}>
          <textarea autoFocus value={draft} onChange={(e) => save(e.target.value)} placeholder="Start typing..." className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-black/30" />
          <div className="flex justify-end">
            <button className="opacity-50 hover:opacity-100" onClick={() => {
              setData({ notes: notes.filter((n) => n.id !== sel) });
              setSel(sorted.find((n) => n.id !== sel)?.id ?? null);
            }}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center"><Empty>No notes yet</Empty></div>
      )}
    </div>
  );
}

// ---------- screen time ----------

interface ScreenTime {
  today: { total: number; hours: number[]; apps: { exe: string; name: string; seconds: number; icon?: string }[] };
  week: { date: string; total: number }[];
  weekApps: { exe: string; name: string; seconds: number; icon?: string }[];
}

function ScreenTimeTile() {
  const st = useTopic<ScreenTime>("screentime");
  const h = new Date().getHours();
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-white" style={{ background: "linear-gradient(160deg,#5e5ce6,#0a84ff)" }}>
        <Watch size={17} />
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[10.5px] font-semibold" style={{ color: "var(--fg2)" }}>Screen Time</span>
        <span className="mt-1 text-[17px] font-semibold">{duration(st?.today.total ?? 0)}</span>
      </div>
      <Bars values={(st?.today.hours ?? Array(24).fill(0)).slice(Math.max(0, h - 7), h + 1)} width={34} height={22} color="#64d2ff" highlight={Math.min(7, h)} />
    </div>
  );
}

function ScreenTimeCard(_: CardProps) {
  const st = useTopic<ScreenTime>("screentime");
  const [tab, setTab] = useState<"day" | "week">("day");
  if (!st) return <Empty>Counting...</Empty>;
  const apps = tab === "day" ? st.today.apps : st.weekApps;
  const max = Math.max(...apps.map((a) => a.seconds), 1);
  const avg = st.week.reduce((s, d) => s + d.total, 0) / Math.max(1, st.week.filter((d) => d.total > 0).length);
  return (
    <div>
      <CardHeader title="Screen Time" sub={tab === "day" ? `Today · ${duration(st.today.total)}` : `Daily average · ${duration(avg)}`} right={<div className="flex gap-1"><Chip active={tab === "day"} onClick={() => setTab("day")}>Day</Chip><Chip active={tab === "week"} onClick={() => setTab("week")}>Week</Chip></div>} />
      <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
        {tab === "day" ? (
          <>
            <Bars values={st.today.hours} width={330} height={70} color="#64d2ff" gap={3} highlight={new Date().getHours()} />
            <div className="mt-1 flex justify-between text-[9.5px]" style={{ color: "var(--fg3)" }}>
              <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span>
            </div>
          </>
        ) : (
          <>
            <Bars values={st.week.map((d) => d.total)} width={330} height={70} color="#5e5ce6" gap={10} highlight={6} />
            <div className="mt-1 flex justify-between px-2 text-[9.5px]" style={{ color: "var(--fg3)" }}>
              {st.week.map((d) => <span key={d.date}>{new Date(d.date + "T12:00").toLocaleDateString([], { weekday: "short" })}</span>)}
            </div>
          </>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {apps.map((a) => (
          <div key={a.exe} className="flex items-center gap-2.5">
            {a.icon ? <img src={a.icon} className="h-6 w-6" /> : <div className="h-6 w-6 rounded-md bg-[var(--chip)]" />}
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-[12px]">
                <span className="truncate font-medium">{a.name}</span>
                <span className="tabular" style={{ color: "var(--fg2)" }}>{duration(a.seconds)}</span>
              </div>
              <div className="mt-1 h-[4px] overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
                <motion.div className="h-full rounded-full" style={{ background: "#64d2ff" }} initial={{ width: 0 }} animate={{ width: `${(a.seconds / max) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
        {!apps.length && <Empty>No app time yet</Empty>}
      </div>
    </div>
  );
}

// ---------- day timeline ----------

type Weather = { daily: { sunrise: string; sunset: string }[] } | { error: string };

function DayTimelineTile() {
  const now = useNow(60_000);
  const st = useTopic<ScreenTime>("screentime");
  const w = useTopic<Weather>("weather");
  const events = useAllEvents();
  const p = useData().pomodoro;
  const day0 = new Date(now);
  day0.setHours(0, 0, 0, 0);
  const W = 230;
  const x = (t: number) => ((t - day0.getTime()) / 86400_000) * W;
  const hours = st?.today.hours ?? Array(24).fill(0);
  const sun = w && !("error" in w) ? w.daily[0] : null;
  const todays = events.filter((e) => !e.allDay && e.start >= day0.getTime() && e.start < day0.getTime() + 86400_000);
  const d = new Date(now);
  return (
    <div className="flex h-full flex-col justify-center px-3 leading-none">
      <div className="mb-[5px] flex justify-between text-[9.5px] font-semibold" style={{ color: "var(--fg2)" }}>
        <span>{d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span>
        <span>{duration(st?.today.total ?? 0)} on the PC{p.day === d.toDateString() && p.completedToday ? <span className="text-[#ff453a]"> · {p.completedToday} rounds</span> : null}</span>
      </div>
      <svg width={W} height={20}>
        {sun && <rect x={x(new Date(sun.sunrise).getTime())} y={0} width={Math.max(0, x(new Date(sun.sunset).getTime()) - x(new Date(sun.sunrise).getTime()))} height={20} rx={4} fill="#ffd60a" opacity={0.08} />}
        {hours.map((s, i) => {
          const h = (Math.min(3600, s) / 3600) * 16;
          return <rect key={i} x={(i / 24) * W + 0.5} y={18 - h} width={W / 24 - 1.5} height={Math.max(1, h)} rx={1.5} fill={i === d.getHours() ? "var(--accent)" : "#64d2ff"} opacity={s ? 0.9 : 0.15} />;
        })}
        {todays.map((e) => <circle key={e.id} cx={x(e.start)} cy={3} r={2.6} fill={e.color} />)}
        <line x1={x(now)} x2={x(now)} y1={0} y2={20} stroke="#ff453a" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ---------- currency ----------

function oldCurrencyPick(): { from: string; to: string; amount: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem("currency") ?? "null");
    return v && typeof v.from === "string" && typeof v.to === "string" ? v : null;
  } catch {
    return null;
  }
}

function useConverter() {
  const rates = useTopic<{ rates: Record<string, number> }>("currency");
  // saved with the rest of the widget data (it used to live in this window's browser storage,
  // which a hard shutdown could lose); an older pick there is carried over once
  const stored = useData().currency;
  const cfg = stored ?? oldCurrencyPick() ?? { from: "USD", to: "EUR", amount: 1 };
  const save = (c: typeof cfg) => setData({ currency: c });
  useEffect(() => {
    const old = stored ? null : oldCurrencyPick();
    if (old) setData({ currency: old });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = rates?.rates;
  const value = r && r[cfg.from] && r[cfg.to] ? (cfg.amount / r[cfg.from]) * r[cfg.to] : null;
  return { rates: r, cfg, save, value };
}

function CurrencyTile() {
  const { cfg, value } = useConverter();
  return (
    <div className="flex h-full flex-col justify-center px-3.5 leading-none">
      <span className="flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: "var(--fg2)" }}>
        {cfg.amount} {cfg.from} <ArrowLeftRight size={10} /> {cfg.to}
      </span>
      <span className="tabular mt-1 text-[18px] font-semibold">{value == null ? "..." : value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 4 : 2 })}</span>
    </div>
  );
}

function CurrencyCard(_: CardProps) {
  const { rates, cfg, save, value } = useConverter();
  const codes = useMemo(() => Object.keys(rates ?? { USD: 1, EUR: 1 }).sort(), [rates]);
  const names = useMemo(() => new Intl.DisplayNames(["en"], { type: "currency" }), []);
  const select = (v: string, on: (c: string) => void) => (
    <select value={v} onChange={(e) => on(e.target.value)} className="rounded-[10px] bg-[var(--chip)] px-2 py-2 text-[13px] font-semibold outline-none">
      {codes.map((c) => <option key={c} value={c} className="bg-[#1c1c1e]">{c} · {names.of(c)}</option>)}
    </select>
  );
  return (
    <div>
      <CardHeader title="Currency" sub="European Central Bank rates" />
      <div className="space-y-2">
        <div className="flex gap-2">
          <input type="number" value={cfg.amount} onChange={(e) => save({ ...cfg, amount: Number(e.target.value) || 0 })} className="tabular min-w-0 flex-1 rounded-[10px] bg-[var(--chip)] px-3 py-2 text-[18px] font-semibold outline-none" />
          {select(cfg.from, (from) => save({ ...cfg, from }))}
        </div>
        <div className="flex justify-center">
          <IconButton onClick={() => save({ ...cfg, from: cfg.to, to: cfg.from })}><ArrowLeftRight size={14} /></IconButton>
        </div>
        <div className="flex gap-2">
          <div className="tabular min-w-0 flex-1 rounded-[10px] bg-[var(--chip)] px-3 py-2 text-[18px] font-semibold">{value == null ? "..." : value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
          {select(cfg.to, (to) => save({ ...cfg, to }))}
        </div>
      </div>
    </div>
  );
}

export const productivityWidgets: WidgetDef[] = [
  { type: "dayTimeline", name: "Day Timeline", category: "Productivity", description: "Your whole day on one line: time on the PC by hour, events, focus rounds, sunrise and sunset.", Tile: DayTimelineTile, Card: ScreenTimeCard, cardWidth: 380 },
  { type: "screenTime", name: "Screen Time", category: "Productivity", description: "Today's time in front of the PC, hour by hour - and every app's, by day and by week.", Tile: ScreenTimeTile, Card: ScreenTimeCard, cardWidth: 380 },
  { type: "pomodoro", name: "Pomodoro", category: "Productivity", description: "Focus rounds and breaks you start and skip from the bar.", Tile: PomodoroTile, Card: PomodoroCard, cardWidth: 320 },
  { type: "timer", name: "Timer", category: "Productivity", description: "A countdown that starts in one click.", Tile: TimerTile, Card: TimerCard, cardWidth: 300, cardFocus: true },
  { type: "stopwatch", name: "Stopwatch", category: "Productivity", description: "Start, pause and lap from the bar; the card keeps every lap.", Tile: StopwatchTile, Card: StopwatchCard, cardWidth: 300 },
  { type: "todos", name: "Todos", category: "Productivity", description: "Your next open task with a progress ring; tick it off from the dock.", Tile: TodosTile, Card: TodosCard, cardWidth: 360, cardFocus: true },
  { type: "notes", name: "Notes", category: "Productivity", description: "Your latest note, one click from editing.", Tile: NotesTile, Card: NotesCard, cardWidth: 460, cardFocus: true },
  { type: "currency", name: "Currency", category: "Productivity", description: "Convert between currencies at current rates.", Tile: CurrencyTile, Card: CurrencyCard, cardWidth: 320, cardFocus: true },
];

export type { Todo };
