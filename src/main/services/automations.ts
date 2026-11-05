// The dock stepping in on its own: timers that ring, reminders before events, music paused
// for meetings, warnings before an AI session runs out or a drive fills up. Quiet hours hold
// the sounds.
import type { CalEvent, Data, Toast } from "@shared/types";
import { broadcast } from "../broadcast";
import { host } from "../host";
import { data, settings } from "../store";
import { lastValue, keepAlive } from "../topics";
import { drives } from "./system";

const uid = () => Math.random().toString(36).slice(2, 10);

function inQuietHours(): boolean {
  const q = settings.value.quietHours;
  if (!q.on) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = q.from.split(":").map(Number);
  const [th, tm] = q.to.split(":").map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? mins >= from && mins < to : mins >= from || mins < to;
}

export function toast(t: Omit<Toast, "id"> & { id?: string }): void {
  const quiet = inQuietHours();
  broadcast("toast", { id: t.id ?? uid(), ...t, tone: (t.tone ?? true) && settings.value.sounds.on && !quiet });
}

// ---------- timer and pomodoro ----------

let timerTimeout: NodeJS.Timeout | null = null;
let pomoTimeout: NodeJS.Timeout | null = null;

function scheduleTimers(d: Data): void {
  if (timerTimeout) clearTimeout(timerTimeout);
  timerTimeout = null;
  if (d.timer.endsAt) {
    timerTimeout = setTimeout(() => {
      const t = data.value.timer;
      data.set({ timer: { ...t, endsAt: null, remaining: t.duration } });
      toast({ title: "Timer done", body: `${Math.round(t.duration / 60_000) || 1} min timer finished`, icon: "timer", accent: "#ff9f0a", ttl: 15_000 });
    }, Math.max(0, d.timer.endsAt - Date.now()));
  }
  if (pomoTimeout) clearTimeout(pomoTimeout);
  pomoTimeout = null;
  if (d.pomodoro.endsAt) {
    pomoTimeout = setTimeout(finishPomodoroPhase, Math.max(0, d.pomodoro.endsAt - Date.now()));
  }
}

function finishPomodoroPhase(): void {
  const p = data.value.pomodoro;
  const today = new Date().toDateString();
  let next = { ...p, endsAt: null as number | null };
  if (p.phase === "focus") {
    const completedToday = (p.day === today ? p.completedToday : 0) + 1;
    const long = p.round >= p.rounds;
    next = { ...next, phase: long ? "long" : "short", completedToday, day: today };
    next.remaining = (long ? p.longMin : p.shortMin) * 60_000;
    // breaks start on their own; focus waits for you
    next.endsAt = Date.now() + next.remaining;
    toast({ title: "Focus round done", body: long ? `Take a ${p.longMin} min break - you earned it` : `Take a ${p.shortMin} min break`, icon: "focus", accent: "#ff453a", ttl: 20_000 });
  } else {
    next = { ...next, phase: "focus", round: p.phase === "long" ? 1 : p.round + 1, remaining: p.focusMin * 60_000 };
    toast({ title: "Break's over", body: "Ready for the next focus round?", icon: "focus", accent: "#30d158", ttl: 20_000 });
  }
  data.set({ pomodoro: next });
}

// ---------- reminders and checks ----------

const fired = new Set<string>();
const once = (key: string, fn: () => void) => {
  if (fired.has(key)) return;
  fired.add(key);
  fn();
};

function allEvents(): CalEvent[] {
  const ics = lastValue<{ events: CalEvent[] }>("calendars")?.events ?? [];
  return [...data.value.events, ...ics];
}

async function check(): Promise<void> {
  const a = settings.value.automations;
  const now = Date.now();

  for (const e of allEvents()) {
    if (e.allDay) continue;
    const until = e.start - now;
    if (a.eventReminders && until > 0 && until <= 5 * 60_000) {
      once(`remind:${e.id}`, () =>
        toast({ title: e.title, body: `Starts in ${Math.max(1, Math.round(until / 60_000))} min${e.location ? " · " + e.location : ""}`, icon: "calendar", accent: e.color, ttl: 30_000 }),
      );
    }
    if (a.pauseMusicForEvents && until <= 60_000 && until > -60_000) {
      once(`pause:${e.id}`, async () => {
        const m = await host.try<{ status: string } | null>("media");
        if (m?.status === "playing") {
          await host.try("mediaControl", { action: "pause" });
          toast({ title: "Music paused", body: `${e.title} is starting`, icon: "music", ttl: 10_000 });
        }
      });
    }
  }

  for (const t of data.value.todos) {
    if (t.done || !t.due) continue;
    if (t.due <= now && t.due > now - 60 * 60_000) once(`todo:${t.id}:${t.due}`, () => toast({ title: "To-do due", body: t.text, icon: "todo", accent: "#30d158" }));
  }

  if (a.aiLimits) {
    const c = lastValue<{ active: boolean; resetsAt: number | null; percent: number | null; sessionTokens: number }>("claude");
    if (c?.active && c.resetsAt) {
      if (c.percent != null && c.percent >= 80) once(`claude80:${c.resetsAt}`, () => toast({ title: "Claude session at " + c.percent + "%", body: `Resets at ${new Date(c.resetsAt!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, icon: "ai", accent: "#d97757" }));
      const left = c.resetsAt - now;
      if (left > 0 && left < 60_000) once(`claudeReset:${c.resetsAt}`, () => toast({ title: "Claude session resets now", body: "A fresh 5-hour window is ready", icon: "ai", accent: "#d97757" }));
    }
  }

  if (a.storageLow) {
    for (const d of drives()) {
      if (d.free / d.total < 0.07) once(`disk:${d.letter}:${new Date().toDateString()}`, () => toast({ title: `${d.letter}: is almost full`, body: `${(d.free / 1e9).toFixed(1)} GB left`, icon: "storage", accent: "#ff453a", tone: false }));
    }
  }
}

export function initAutomations(): void {
  scheduleTimers(data.value);
  data.onChange((v, prev) => {
    if (v.timer !== prev.timer || v.pomodoro !== prev.pomodoro) scheduleTimers(v);
  });
  // reminders need these feeds even when no widget shows them
  keepAlive("calendars");
  keepAlive("claude");
  setInterval(() => void check(), 20_000);
  setTimeout(() => void check(), 5000);
}
