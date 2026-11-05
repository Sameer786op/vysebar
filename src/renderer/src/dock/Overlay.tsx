// What opens out of the dock: cards over a tile, right-click menus and toasts.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Calendar, Check, CheckSquare, Cpu, HardDrive, Music2, Sparkles, Timer, Target, X } from "lucide-react";
import type { Toast } from "@shared/types";
import type { MenuItem } from "../widgets/types";
import { play } from "../lib/sound";
import { useSettings } from "../lib/state";

const spring = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const;

export interface CardState {
  uid: string;
  anchor: DOMRect;
  content: ReactNode;
  width: number;
  hover?: boolean;
  padding?: number;
}

/** a card floats over the tile it belongs to, inside the dock window, kept on screen */
export function Card({ card, edge, dockRect, glass, onMeasure, onHover }: {
  card: CardState;
  edge: "top" | "bottom";
  dockRect: DOMRect | null;
  glass: boolean;
  onMeasure?: () => void;
  onHover?: (inside: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setH(el.offsetHeight);
      onMeasure?.();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const gap = 10;
  const left = Math.max(10, Math.min(W - card.width - 10, card.anchor.left + card.anchor.width / 2 - card.width / 2));
  const edgeY = dockRect ? (edge === "bottom" ? dockRect.top : dockRect.bottom) : edge === "bottom" ? H - 70 : 70;
  const maxH = edge === "bottom" ? edgeY - gap - 8 : H - edgeY - gap - 8;
  const style =
    edge === "bottom"
      ? { left, bottom: H - edgeY + gap, width: card.width, maxHeight: maxH }
      : { left, top: edgeY + gap, width: card.width, maxHeight: maxH };
  const from = edge === "bottom" ? 14 : -14;
  void h;
  return (
    <motion.div
      ref={ref}
      data-hit
      data-glass="card"
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className="thin-scroll absolute overflow-y-auto overflow-x-hidden rounded-[22px]"
      style={{
        ...style,
        padding: card.padding ?? 16,
        background: glass ? "var(--card)" : "var(--card-solid)",
        border: "1px solid var(--card-border)",
        boxShadow: "0 18px 50px rgb(0 0 0 / 0.35), 0 2px 8px rgb(0 0 0 / 0.2)",
        color: "var(--fg)",
        transformOrigin: `${card.anchor.left + card.anchor.width / 2 - left}px ${edge === "bottom" ? "100%" : "0%"}`,
      }}
      initial={{ opacity: 0, y: from, scale: 0.94, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: from * 0.6, scale: 0.96, filter: "blur(3px)", transition: { duration: 0.14 } }}
      transition={spring}
    >
      {card.content}
    </motion.div>
  );
}

export function Menu({ at, items, edge, onClose }: { at: { x: number; y: number }; items: MenuItem[]; edge: "top" | "bottom"; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, at.x - 8));
    const top = edge === "bottom" ? Math.max(8, at.y - h - 6) : Math.min(window.innerHeight - h - 8, at.y + 6);
    setPos({ left, top });
  }, [at, edge, items]);
  return (
    <motion.div
      ref={ref}
      data-hit
      data-glass="card"
      className="absolute z-50 min-w-[210px] max-w-[300px] rounded-[14px] p-1.5"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? 0,
        background: "var(--card)",
        border: "1px solid var(--card-border)",
        boxShadow: "0 14px 40px rgb(0 0 0 / 0.35)",
        color: "var(--fg)",
        transformOrigin: edge === "bottom" ? "bottom left" : "top left",
      }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: pos ? 1 : 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
      transition={{ type: "spring", stiffness: 700, damping: 40 }}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="mx-2 my-1 h-px" style={{ background: "var(--line)" }} />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
            className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-[13px] transition-colors duration-75 hover:bg-[var(--accent)] hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
            style={{ color: it.danger ? "#ff453a" : undefined }}
          >
            <span className="grid w-4 place-items-center opacity-80">{it.checked ? <Check size={14} /> : it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
          </button>
        ),
      )}
    </motion.div>
  );
}

const toastIcons: Record<string, ReactNode> = {
  timer: <Timer size={16} />,
  focus: <Target size={16} />,
  calendar: <Calendar size={16} />,
  music: <Music2 size={16} />,
  ai: <Sparkles size={16} />,
  storage: <HardDrive size={16} />,
  todo: <CheckSquare size={16} />,
  cpu: <Cpu size={16} />,
  bell: <Bell size={16} />,
};

export function Toasts({ edge, dockRect }: { edge: "top" | "bottom"; dockRect: DOMRect | null }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const settings = useSettings();
  useEffect(
    () =>
      window.vyse.on("toast", (t: Toast) => {
        setToasts((list) => [...list.filter((x) => x.id !== t.id), t].slice(-4));
        if (t.tone) play(settings.sounds.tone);
        setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.ttl ?? 8000);
      }),
    [settings.sounds.tone],
  );
  const H = window.innerHeight;
  const right = dockRect ? Math.max(12, window.innerWidth - dockRect.right) : 24;
  const edgeY = dockRect ? (edge === "bottom" ? dockRect.top : dockRect.bottom) : edge === "bottom" ? H - 70 : 70;
  return (
    <div className="pointer-events-none absolute flex flex-col gap-2" style={edge === "bottom" ? { right, bottom: H - edgeY + 10 } : { right, top: edgeY + 10, flexDirection: "column-reverse" }}>
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            data-hit
            data-glass="card"
            className="pointer-events-auto flex w-[300px] items-start gap-3 rounded-[18px] p-3 pr-2"
            style={{ background: "var(--card)", border: "1px solid var(--card-border)", boxShadow: "0 14px 40px rgb(0 0 0 / 0.35)", color: "var(--fg)" }}
            initial={{ opacity: 0, y: edge === "bottom" ? 24 : -24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, transition: { duration: 0.18 } }}
            transition={spring}
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-white" style={{ background: t.accent ?? "var(--accent)" }}>
              {toastIcons[t.icon ?? "bell"] ?? <Bell size={16} />}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="truncate text-[13px] font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--fg2)" }}>{t.body}</div>}
              {t.action && (
                <button
                  onClick={() => {
                    void window.vyse.invoke(t.action!.invoke);
                    setToasts((l) => l.filter((x) => x.id !== t.id));
                  }}
                  className="mt-2 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold text-white"
                  style={{ background: t.accent ?? "var(--accent)" }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button className="grid h-6 w-6 place-items-center rounded-full opacity-60 hover:opacity-100" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}>
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
