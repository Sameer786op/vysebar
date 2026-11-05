// Small building blocks the tiles and cards share.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { useLite } from "../lib/state";

// gauges glide to a new reading in a short tween that settles before the next one arrives
// (a spring kept them moving all the time); lite mode just sets them
const useGaugeTransition = () => (useLite() ? { duration: 0 } : { duration: 0.45, ease: "easeOut" as const });

export function Ring({ value, size = 34, stroke = 4, color = "var(--accent)", track = "var(--track)", children }: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const transition = useGaugeTransition();
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          // whole percents: a reading that moves by less than one doesn't redraw
          animate={{ strokeDashoffset: c * (1 - Math.round(v * 100) / 100) }}
          transition={transition}
        />
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}

export function Bar({ value, color = "var(--accent)", height = 4, className = "" }: { value: number; color?: string; height?: number; className?: string }) {
  const transition = useGaugeTransition();
  return (
    <div className={`w-full overflow-hidden rounded-full ${className}`} style={{ height, background: "var(--track)" }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
        transition={transition}
      />
    </div>
  );
}

export function Sparkline({ values, width = 80, height = 24, color = "var(--accent)", fill = true, strokeWidth = 1.6 }: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const id = useRef(`sp${Math.random().toString(36).slice(2, 8)}`).current;
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Bars({ values, width = 80, height = 24, color = "var(--accent)", gap = 1.5, highlight }: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  gap?: number;
  highlight?: number;
}) {
  const max = Math.max(...values, 1);
  const w = (width - gap * (values.length - 1)) / values.length;
  return (
    <svg width={width} height={height}>
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * height);
        return <rect key={i} x={i * (w + gap)} y={height - h} width={w} height={h} rx={Math.min(1.5, w / 2)} fill={color} opacity={highlight === undefined || highlight === i ? 1 : 0.45} />;
      })}
    </svg>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ background: on ? "var(--accent)" : "var(--track)" }}
    >
      <motion.span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow"
        initial={false}
        animate={{ left: on ? 18 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

/** a slider that commits on release and previews while dragging */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, onCommit, icon, className = "", height = 28 }: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  icon?: ReactNode;
  className?: string;
  height?: number;
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const pct = (local - min) / (max - min || 1);
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const raw = min + ((clientX - r.left) / r.width) * (max - min);
    return Math.max(min, Math.min(max, Math.round(raw / step) * step));
  };
  return (
    <div
      ref={ref}
      className={`relative w-full cursor-pointer overflow-hidden rounded-full ${className}`}
      style={{ height, background: "var(--track)" }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const v = at(e.clientX);
        setLocal(v);
        onChange?.(v);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const v = at(e.clientX);
        setLocal(v);
        onChange?.(v);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        onCommit?.(at(e.clientX));
      }}
      onWheel={(e) => {
        const v = Math.max(min, Math.min(max, local + (e.deltaY < 0 ? step * 2 : -step * 2)));
        setLocal(v);
        onChange?.(v);
        onCommit?.(v);
      }}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `max(${height}px, ${pct * 100}%)` }} />
      {icon && <div className="absolute inset-y-0 left-0 grid place-items-center text-black/70" style={{ width: height }}>{icon}</div>}
    </div>
  );
}

export function Chip({ children, active, onClick, className = "", style }: { children: ReactNode; active?: boolean; onClick?: () => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${className}`}
      style={{ background: active ? "var(--accent)" : "var(--chip)", color: active ? "white" : "var(--fg)", ...style }}
    >
      {children}
    </button>
  );
}

export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold" style={{ color: "var(--fg)" }}>{title}</div>
        {sub && <div className="mt-0.5 truncate text-[12px]" style={{ color: "var(--fg2)" }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-[12.5px]" style={{ color: "var(--fg2)" }}>{children}</div>;
}

export function IconButton({ children, onClick, title, active, size = 30, className = "" }: { children: ReactNode; onClick?: () => void; title?: string; active?: boolean; size?: number; className?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid shrink-0 place-items-center rounded-full transition-colors hover:brightness-110 ${className}`}
      style={{ width: size, height: size, background: active ? "var(--accent)" : "var(--chip)", color: active ? "white" : "var(--fg)" }}
    >
      {children}
    </button>
  );
}
