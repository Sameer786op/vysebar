// Claude Code usage, read from its own logs on this PC: the 5-hour session, the week, when it resets.
import { compact, countdown, relative } from "../lib/format";
import { setSettings, useCommitted, useNow, useSettings, useStore, useTopic } from "../lib/state";
import { Burst } from "../components/icons";
import { Bars, CardHeader, Chip, Empty, Ring, Sparkline } from "../components/ui";
import type { CardProps, WidgetDef } from "./types";

const CLAUDE = "#d97757";
const H5 = 5 * 3600_000;

interface Claude {
  active: boolean;
  sessionTokens: number;
  sessionStart: number | null;
  resetsAt: number | null;
  weekTokens: number;
  topModel: string | null;
  messages: number;
  limit: number | null;
  percent: number | null;
  series: number[];
  daily: { date: string; tokens: number }[];
}
type C = Claude | { error: string };

function useClaude() {
  const c = useTopic<C>("claude");
  const now = useNow(1000);
  if (!c) return { c: null, error: null, now, ring: 0 };
  if ("error" in c) return { c: null, error: c.error, now, ring: 0 };
  // with a limit the ring is the share used; without one it is how far the window has run
  const ring = c.percent != null ? c.percent / 100 : c.sessionStart ? Math.min(1, (now - c.sessionStart) / H5) : 0;
  return { c, error: null, now, ring };
}

function ClaudeUsageTile() {
  const { c, error, now, ring } = useClaude();
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <Ring value={ring} size={34} stroke={3.5} color={(c?.percent ?? 0) >= 80 ? "#ff453a" : CLAUDE}>
        <Burst size={15} style={{ color: CLAUDE }} />
      </Ring>
      <div className="flex flex-col leading-none">
        {c ? (
          <>
            <span className="tabular text-[15px] font-semibold">{c.percent != null ? `${c.percent}%` : compact(c.sessionTokens)}</span>
            <span className="tabular mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>{c.active && c.resetsAt ? `resets in ${countdown(c.resetsAt - now).replace(/^0:/, "")}` : "No session"}</span>
          </>
        ) : (
          <span className="max-w-[120px] truncate text-[11px]" style={{ color: "var(--fg2)" }}>{error ?? "Reading usage..."}</span>
        )}
      </div>
    </div>
  );
}

function ClaudePlanTile() {
  const { c, error } = useClaude();
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px]" style={{ background: CLAUDE }}>
        <Burst size={18} style={{ color: "white" }} />
      </div>
      {c ? (
        <>
          <div className="flex flex-col leading-none">
            <span className="text-[10px] font-semibold" style={{ color: "var(--fg2)" }}>This week</span>
            <span className="tabular mt-1 text-[15px] font-semibold">{compact(c.weekTokens)}</span>
          </div>
          <Bars values={c.daily.map((d) => d.tokens)} width={42} height={24} color={CLAUDE} highlight={6} />
        </>
      ) : (
        <span className="max-w-[120px] truncate text-[11px]" style={{ color: "var(--fg2)" }}>{error ?? "Reading usage..."}</span>
      )}
    </div>
  );
}

// rough session budgets people see on each plan, counting cached tokens; pick yours or type one
const PLANS: [string, number][] = [["Pro", 25_000_000], ["Max 5x", 120_000_000], ["Max 20x", 480_000_000]];

function ClaudeCard(_: CardProps) {
  const s = useSettings();
  const { c, error, now, ring } = useClaude();
  const [custom, setCustom, flushCustom] = useCommitted(s.accounts.claudeLimit ? String(s.accounts.claudeLimit / 1e6) : "", (v) => {
    const n = parseFloat(v);
    setSettings({ accounts: { ...useStore.getState().settings.accounts, claudeLimit: n > 0 ? Math.round(n * 1e6) : undefined } });
  });
  if (!c) return <Empty>{error ?? "Reading usage..."}</Empty>;
  const setLimit = (n: number | undefined) => setSettings({ accounts: { ...s.accounts, claudeLimit: n } });
  return (
    <div>
      <CardHeader title={<span className="flex items-center gap-1.5"><Burst size={15} style={{ color: CLAUDE }} /> Claude Code</span>} sub={c.topModel ? `Mostly ${c.topModel} this week` : "Usage from this PC"} />
      <div className="flex items-center gap-4 rounded-[16px] p-3.5" style={{ background: "var(--chip)" }}>
        <Ring value={ring} size={92} stroke={8} color={(c.percent ?? 0) >= 80 ? "#ff453a" : CLAUDE}>
          <div className="text-center leading-tight">
            <div className="tabular text-[20px] font-semibold">{c.percent != null ? `${c.percent}%` : compact(c.sessionTokens)}</div>
            <div className="text-[9.5px]" style={{ color: "var(--fg2)" }}>{c.percent != null ? "of session" : "tokens"}</div>
          </div>
        </Ring>
        <div className="min-w-0 flex-1 space-y-1.5 text-[12px]">
          <div className="flex justify-between"><span style={{ color: "var(--fg2)" }}>Session</span><b>{c.active ? "Active" : "Idle"}</b></div>
          <div className="flex justify-between"><span style={{ color: "var(--fg2)" }}>Resets</span><b className="tabular">{c.active && c.resetsAt ? countdown(c.resetsAt - now) : "-"}</b></div>
          <div className="flex justify-between"><span style={{ color: "var(--fg2)" }}>Started</span><b>{c.sessionStart ? relative(c.sessionStart - now) : "-"}</b></div>
          <div className="flex justify-between"><span style={{ color: "var(--fg2)" }}>Replies</span><b className="tabular">{c.messages}</b></div>
        </div>
      </div>
      {c.series.length > 1 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>This session</div>
          <Sparkline values={c.series} width={330} height={44} color={CLAUDE} />
        </div>
      )}
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>
          <span>Last 7 days</span>
          <span className="tabular">{compact(c.weekTokens)} tokens</span>
        </div>
        <Bars values={c.daily.map((d) => d.tokens)} width={330} height={50} color={CLAUDE} gap={8} highlight={6} />
        <div className="mt-1 flex justify-between px-1 text-[9.5px]" style={{ color: "var(--fg3)" }}>
          {c.daily.map((d) => <span key={d.date}>{new Date(d.date + "T12:00").toLocaleDateString([], { weekday: "narrow" })}</span>)}
        </div>
      </div>
      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <div className="mb-1.5 text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>Session limit (for the percentage and the 80% alert)</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!s.accounts.claudeLimit} onClick={() => setLimit(undefined)}>Off</Chip>
          {PLANS.map(([name, n]) => <Chip key={name} active={s.accounts.claudeLimit === n} onClick={() => setLimit(n)}>{name}</Chip>)}
          <span className="flex items-center gap-1 rounded-full px-2 py-[3px] text-[12px]" style={{ background: "var(--chip)" }}>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={flushCustom} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="custom" className="w-[46px] bg-transparent text-right outline-none" />M
          </span>
        </div>
      </div>
    </div>
  );
}

export const aiWidgets: WidgetDef[] = [
  { type: "claudeUsage", name: "Claude Usage", category: "AI", description: "Your Claude Code session: tokens used and when the 5-hour window resets.", Tile: ClaudeUsageTile, Card: ClaudeCard, cardWidth: 370, cardFocus: true },
  { type: "claudePlan", name: "Claude This Week", category: "AI", description: "Tokens over the last seven days, day by day.", Tile: ClaudePlanTile, Card: ClaudeCard, cardWidth: 370, cardFocus: true },
];
