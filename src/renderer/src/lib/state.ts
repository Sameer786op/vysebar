// Settings, widget data and live topics, shared by every component of a window.
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { DEFAULT_DATA, DEFAULT_SETTINGS, type Data, type Settings } from "@shared/types";

const vyse = window.vyse;

interface State {
  settings: Settings;
  data: Data;
  topics: Record<string, unknown>;
  pickerOpen: boolean;
}

export const useStore = create<State>(() => ({
  settings: DEFAULT_SETTINGS,
  data: DEFAULT_DATA,
  topics: {},
  pickerOpen: false,
}));

let started = false;
export async function initState(): Promise<void> {
  if (started) return;
  started = true;
  const [settings, data] = await Promise.all([vyse.invoke<Settings>("settings:get"), vyse.invoke<Data>("data:get")]);
  useStore.setState({ settings, data });
  vyse.on("settings", (s: Settings) => useStore.setState({ settings: s }));
  vyse.on("data", (d: Data) => useStore.setState({ data: d }));
  vyse.on("topic", (name: string, value: unknown) => useStore.setState((st) => ({ topics: { ...st.topics, [name]: value } })));
  vyse.on("picker", (open: boolean) => useStore.setState({ pickerOpen: open }));
}

export const useSettings = () => useStore((s) => s.settings);

/** lite mode: chosen in Settings, or picked automatically on a low-end PC */
export const liteOf = (s: Settings): boolean => s.performance === "lite" || (s.performance !== "smooth" && vyse.env.lowEnd);
export const useLite = () => useStore((st) => liteOf(st.settings));
export const useData = () => useStore((s) => s.data);

// once a window starts closing, a normal message can be lost with it; the last edits then go
// over a synchronous one (see useCommitted, which saves pending edits right at this moment)
let leaving = false;
const markLeaving = () => {
  leaving = true;
};
window.addEventListener("beforeunload", markLeaving);
window.addEventListener("pagehide", markLeaving);

export function setSettings(patch: Partial<Settings>): void {
  useStore.setState((st) => ({ settings: { ...st.settings, ...patch } }));
  if (leaving) vyse.sendSync("settings:setNow", patch);
  else void vyse.invoke("settings:set", patch);
}

export function setData(patch: Partial<Data>): void {
  useStore.setState((st) => ({ data: { ...st.data, ...patch } }));
  if (leaving) vyse.sendSync("data:setNow", patch);
  else void vyse.invoke("data:set", patch);
}

/**
 * A text box or slider that never loses what you typed: the value is saved a moment after you
 * stop, when the box loses focus, and when its card or window closes (closing a card unmounts
 * the box without a blur, which used to drop the edit).
 */
export function useCommitted<T>(saved: T, commit: (v: T) => void, delay = 600): [T, (v: T) => void, () => void] {
  const [v, setV] = useState(saved);
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // a change from elsewhere (another window, a reset) shows up unless you're mid-edit
  useEffect(() => {
    if (!pending.current) setV(saved);
  }, [saved]);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) commitRef.current(p.v);
  }, []);
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      pending.current = { v: nv };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [flush]);
  return [v, set, flush];
}

const refs = new Map<string, number>();

/** subscribes to a live feed for as long as the component is on screen */
export function useTopic<T>(name: string | null): T | undefined {
  const value = useStore((s) => (name ? (s.topics[name] as T | undefined) : undefined));
  useEffect(() => {
    if (!name) return;
    refs.set(name, (refs.get(name) ?? 0) + 1);
    if (refs.get(name) === 1) {
      void vyse.invoke<T>("topic:sub", name).then((v) => {
        if (v !== undefined && v !== null) useStore.setState((st) => ({ topics: { ...st.topics, [name]: st.topics[name] ?? v } }));
      });
    }
    return () => {
      const n = (refs.get(name) ?? 1) - 1;
      refs.set(name, n);
      if (n === 0) vyse.send("topic:unsub", name);
    };
  }, [name]);
  return value;
}

export function refreshTopic(name: string): void {
  vyse.send("topic:refresh", name);
}

/** the current time, ticking every `ms` */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    // tick on the boundary so a clock changes the moment the second does
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      t = setTimeout(tick, ms - (Date.now() % ms));
    };
    t = setTimeout(tick, ms - (Date.now() % ms));
    return () => clearTimeout(t);
  }, [ms]);
  return now;
}

export const host = <T = unknown>(cmd: string, args?: Record<string, unknown>) => vyse.invoke<T>("host", cmd, args ?? {});

export const uid = () => Math.random().toString(36).slice(2, 10);

export interface Battery {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

export function useBattery(): Battery | null {
  const [b, setB] = useState<Battery | null>(null);
  useEffect(() => {
    let mgr: any;
    let off = false;
    const read = () =>
      !off && mgr && setB({ level: mgr.level, charging: mgr.charging, chargingTime: mgr.chargingTime, dischargingTime: mgr.dischargingTime });
    (navigator as any).getBattery?.().then((m: any) => {
      mgr = m;
      read();
      for (const ev of ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"]) m.addEventListener(ev, read);
    });
    return () => {
      off = true;
    };
  }, []);
  return b;
}
