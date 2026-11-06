// Widgets for services you connect with your own key: revenue from six stores and their total,
// site analytics, followers, email, Supabase, Linear issues, AI balances and plan limits, LeetCode.
// Each card has its own connect form, so a key can be added right where the widget is.
import { useState, type FC, type ReactNode } from "react";
import { motion } from "motion/react";
import { ExternalLink, Flame, KeyRound, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { PROVIDERS, isConnected, type BalanceData, type CountData, type IssuesData, type LeetcodeData, type ProviderData, type ProviderSpec, type RevenueData, type UsageData } from "@shared/accounts";
import { compact, countdown, money } from "../lib/format";
import { setSettings, useCommitted, useNow, useSettings, useTopic } from "../lib/state";
import { Bars, CardHeader, Ring, Sparkline } from "../components/ui";
import type { CardProps, Category, TileProps, WidgetDef } from "./types";

type Err = { error: string; connect?: boolean };
const isErr = (v: unknown): v is Err => !!v && typeof v === "object" && "error" in v;
const up = "#30d158";
const down = "#ff453a";
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n ?? 0).toFixed(1)}%`;
const muted = { color: "var(--fg2)" };
const open = (url: string) => void window.vyse.invoke("open:url", url);

export function Mark({ spec, size = 30 }: { spec: Pick<ProviderSpec, "color" | "letter">; size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center font-bold leading-none text-white" style={{ width: size, height: size, borderRadius: size * 0.3, background: spec.color, fontSize: size * 0.46, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14)" }}>
      {spec.letter}
    </div>
  );
}

const useAcct = <T extends ProviderData>(id: string) => useTopic<T | Err>(`acct:${id}`);

/** what a tile shows before it has numbers */
function TileNote({ spec, v }: { spec: ProviderSpec; v: Err | undefined }) {
  return (
    <div className="flex h-full items-center gap-2 pl-2.5 pr-3">
      <Mark spec={spec} />
      <span className="flex max-w-[130px] items-center gap-1 truncate text-[11px]" style={muted}>
        {v?.connect && <KeyRound size={11} />}
        {!v ? "Loading..." : v.connect ? `Connect ${spec.name}` : v.error}
      </span>
    </div>
  );
}

function Change({ n, size = 10 }: { n: number; size?: number }) {
  return (
    <span className="tabular flex items-center gap-0.5 font-semibold" style={{ color: n >= 0 ? up : down, fontSize: size }}>
      {n >= 0 ? <TrendingUp size={size} /> : <TrendingDown size={size} />}
      {pct(n)}
    </span>
  );
}

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
      <div className="text-[11px] font-semibold" style={muted}>{label}</div>
      <div className="tabular mt-0.5 text-[21px] font-semibold leading-tight">{children}</div>
      {sub && <div className="mt-0.5 text-[11px]">{sub}</div>}
    </div>
  );
}

// ---------- connecting ----------

function ConnectForm({ spec, onDone }: { spec: ProviderSpec; onDone?: () => void }) {
  const s = useSettings();
  const saved = s.providers[spec.id] ?? {};
  // a choice starts on its first option
  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(spec.fields.filter((f) => f.options).map((f) => [f.key, f.options![0].value])), ...saved }));
  const connected = !!s.providers[spec.id] && isConnected(spec, saved);
  const ready = isConnected(spec, vals);
  const save = () => {
    if (!ready) return;
    setSettings({ providers: { ...s.providers, [spec.id]: Object.fromEntries(spec.fields.map((f) => [f.key, (vals[f.key] ?? "").trim()])) } });
    onDone?.();
  };
  const disconnect = () => {
    const { [spec.id]: _gone, ...rest } = s.providers;
    setSettings({ providers: rest });
    setVals({});
  };
  return (
    <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
      <div className="space-y-2">
        {spec.fields.map((f, i) =>
          f.options ? (
            <div key={f.key}>
              <span className="mb-1 block text-[11px] font-semibold" style={muted}>{f.label}</span>
              <div className="flex gap-1.5">
                {f.options.map((o) => (
                  <button key={o.value} onClick={() => setVals({ ...vals, [f.key]: o.value })} className="rounded-full px-2.5 py-[4px] text-[12px] font-medium" style={{ background: vals[f.key] === o.value ? "var(--accent)" : "var(--track)", color: vals[f.key] === o.value ? "white" : undefined }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <label key={f.key} className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={muted}>{f.label}{f.optional && <span className="font-normal" style={{ color: "var(--fg3)" }}> · optional</span>}</span>
            <input
              autoFocus={i === 0}
              type={f.secret ? "password" : "text"}
              value={vals[f.key] ?? ""}
              placeholder={f.placeholder}
              spellCheck={false}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && save()}
              className="w-full rounded-[9px] px-2.5 py-[6px] text-[12.5px] outline-none placeholder:text-[var(--fg3)] focus:ring-2 focus:ring-[var(--accent)]"
              style={{ background: "var(--track)" }}
            />
          </label>
          ),
        )}
      </div>
      <p className="mt-2 text-[11px] leading-snug" style={muted}>{spec.help}</p>
      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={save} disabled={!ready} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-40" style={{ background: "var(--accent)" }}>
          {connected ? "Save" : "Connect"}
        </button>
        <button onClick={() => open(spec.site)} className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px]" style={{ background: "var(--track)" }}>
          Open {spec.name} <ExternalLink size={11} />
        </button>
        {connected && <button onClick={disconnect} className="ml-auto text-[11.5px] font-medium" style={{ color: down }}>Disconnect</button>}
      </div>
      <p className="mt-2 text-[10.5px]" style={{ color: "var(--fg3)" }}>Saved on this PC and sent only to {spec.name}.</p>
    </div>
  );
}

/** a card's header, plus the connect form when there is nothing to show or the key is being changed */
function AccountCard({ spec, v, children }: { spec: ProviderSpec; v: ProviderData | Err | undefined; children: (d: ProviderData) => ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [spin, setSpin] = useState(false);
  const refresh = () => {
    setSpin(true);
    void window.vyse.invoke("account:refresh", spec.id).finally(() => setTimeout(() => setSpin(false), 600));
  };
  const showForm = editing || (isErr(v) && (v.connect || /refused/.test(v.error)));
  return (
    <div>
      <CardHeader
        title={<span className="flex items-center gap-2"><Mark spec={spec} size={22} /> {spec.name}</span>}
        sub={spec.unit ? cap(spec.unit) : spec.kind === "revenue" ? "Last 30 days" : v && !isErr(v) && v.kind === "usage" && v.plan ? v.plan : spec.group}
        right={
          <span className="flex items-center gap-1">
            {v && !(isErr(v) && v.connect) && (
              <>
                <button title="Refresh" onClick={refresh} className="grid h-7 w-7 place-items-center rounded-full" style={{ background: "var(--chip)" }}>
                  <motion.span animate={{ rotate: spin ? 360 : 0 }} transition={{ duration: spin ? 0.6 : 0 }} className="grid"><RefreshCw size={12} /></motion.span>
                </button>
                <button title="Change key" onClick={() => setEditing(!editing)} className="grid h-7 w-7 place-items-center rounded-full" style={{ background: editing ? "var(--accent)" : "var(--chip)", color: editing ? "white" : undefined }}>
                  <KeyRound size={12} />
                </button>
              </>
            )}
            <button title={`Open ${spec.name}`} onClick={() => open(spec.site)} className="grid h-7 w-7 place-items-center rounded-full" style={{ background: "var(--chip)" }}>
              <ExternalLink size={12} />
            </button>
          </span>
        }
      />
      {isErr(v) && !v.connect && <div className="mb-2 rounded-[10px] px-3 py-2 text-[11.5px]" style={{ background: "rgb(255 69 58 / 0.14)", color: "#ff8a80" }}>{v.error}</div>}
      {showForm ? <ConnectForm spec={spec} onDone={() => setEditing(false)} /> : !v ? <div className="py-6 text-center text-[12px]" style={muted}>Loading...</div> : isErr(v) ? null : children(v)}
    </div>
  );
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const dayLabel = (d: string) => new Date(d + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" });

// ---------- revenue ----------

function RevenueBody({ r, color }: { r: RevenueData; color: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Last 30 days">{money(r.total, r.currency)}</Stat>
        <Stat label="This week" sub={<Change n={r.change} size={11} />}>{money(r.week, r.currency)}</Stat>
      </div>
      <div className="mt-3 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
        <Bars values={r.days.map((d) => Math.max(0, d.value))} width={306} height={70} color={color} gap={4} highlight={r.days.length - 1} />
        <div className="mt-1 flex justify-between text-[9.5px]" style={{ color: "var(--fg3)" }}>
          <span>{dayLabel(r.days[0].date)}</span>
          <span>Today</span>
        </div>
      </div>
    </>
  );
}

function revenueWidget(spec: ProviderSpec): WidgetDef[] {
  const Tile: FC<TileProps> = () => {
    const r = useAcct<RevenueData>(spec.id);
    if (!r || isErr(r)) return <TileNote spec={spec} v={r} />;
    return (
      <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
        <Mark spec={spec} />
        <div className="flex flex-col leading-none">
          <span className="tabular text-[15px] font-semibold">{money(r.total, r.currency, true)}</span>
          <span className="mt-1 text-[10px]" style={muted}>last 30 days</span>
        </div>
      </div>
    );
  };
  const ChartTile: FC<TileProps> = () => {
    const r = useAcct<RevenueData>(spec.id);
    if (!r || isErr(r)) return <TileNote spec={spec} v={r} />;
    return (
      <div className="flex h-full items-center gap-2.5 pl-3 pr-3.5">
        <div className="flex flex-col leading-none">
          <span className="tabular text-[14px] font-semibold">{money(r.week, r.currency, true)}</span>
          <span className="mt-1"><Change n={r.change} /></span>
        </div>
        <Bars values={r.days.slice(-7).map((d) => Math.max(0, d.value))} width={56} height={26} color={spec.color} highlight={6} />
      </div>
    );
  };
  const Card: FC<CardProps> = () => {
    const r = useAcct<RevenueData>(spec.id);
    return <AccountCard spec={spec} v={r}>{(d) => d.kind === "revenue" && <RevenueBody r={d} color={spec.color} />}</AccountCard>;
  };
  const base = { category: "Finance" as Category, Card, cardWidth: 360, cardFocus: true, account: spec.id };
  return [
    { ...base, type: `acct-${spec.id}`, name: `${spec.name} Revenue`, description: `What ${spec.name} brought in over the last 30 days.`, Tile },
    { ...base, type: `acct-${spec.id}-chart`, name: `${spec.name} Chart`, description: `This week's ${spec.name} revenue day by day, against last week.`, Tile: ChartTile },
  ];
}

// ---------- total revenue: every connected store added up ----------

interface Total { currency: string; total: number; days: RevenueData["days"]; parts: { id: string; name: string; total: number; currency: string }[] }
const TOTAL = { color: "linear-gradient(135deg, #30d158, #0a84ff)", letter: "$" };

function TotalTile() {
  const s = useSettings();
  const t = useTopic<Total | Err>("revenueTotal");
  if (!t || isErr(t))
    return (
      <div className="flex h-full items-center gap-2 pl-2.5 pr-3">
        <Mark spec={TOTAL} />
        <span className="max-w-[140px] truncate text-[11px]" style={muted}>{t ? (t.connect ? "Connect a store" : t.error) : "Adding up..."}</span>
      </div>
    );
  const goal = s.revenueGoal || 1;
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <Ring value={t.total / goal} size={32} stroke={3.5} color="#30d158"><span className="text-[8.5px] font-bold">{Math.min(999, Math.round((t.total / goal) * 100))}%</span></Ring>
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{money(t.total, t.currency, true)}</span>
        <span className="mt-1 text-[10px]" style={muted}>{t.parts.length} store{t.parts.length === 1 ? "" : "s"} · 30 days</span>
      </div>
    </div>
  );
}

function TotalCard(_: CardProps) {
  const s = useSettings();
  const t = useTopic<Total | Err>("revenueTotal");
  const [goal, setGoal, flushGoal] = useCommitted(String(s.revenueGoal), (g) => setSettings({ revenueGoal: Number(g) || 1000 }));
  if (!t || isErr(t))
    return (
      <div className="py-4 text-center">
        <div className="text-[12.5px]" style={muted}>{t ? t.error : "Adding up..."}</div>
        <div className="mt-1 text-[11px]" style={{ color: "var(--fg3)" }}>Stripe, Polar, Lemon Squeezy, Paddle, Gumroad, Shopify and Dodo Payments count toward it.</div>
      </div>
    );
  const max = Math.max(...t.parts.map((p) => p.total), 1);
  return (
    <div>
      <CardHeader title={<span className="flex items-center gap-2"><Mark spec={TOTAL} size={22} /> Total Revenue</span>} sub="Every connected store, last 30 days" />
      <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
        <div className="tabular text-[26px] font-semibold leading-tight">{money(t.total, t.currency)}</div>
        <div className="mt-2"><Bars values={t.days.map((d) => Math.max(0, d.value))} width={306} height={56} color="#30d158" gap={4} highlight={t.days.length - 1} /></div>
      </div>
      <div className="mt-3 space-y-1.5">
        {t.parts.map((p) => {
          const spec = PROVIDERS.find((x) => x.id === p.id) ?? { color: "#635bff", letter: "S" };
          return (
            <div key={p.id} className="flex items-center gap-2.5 text-[12.5px]">
              <Mark spec={spec} size={20} />
              <span className="w-[96px] truncate">{p.name}</span>
              <div className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((Math.max(0, p.total) / max) * 100)}%`, background: spec.color }} />
              </div>
              <span className="tabular w-[78px] text-right font-semibold">{money(p.total, p.currency, true)}</span>
            </div>
          );
        })}
      </div>
      {t.parts.some((p) => p.currency !== t.currency) && <p className="mt-2 text-[10.5px]" style={{ color: "var(--fg3)" }}>Stores in other currencies than {t.currency} are listed but not added in.</p>}
      <div className="mt-3 flex justify-between text-[11.5px]">
        <span className="font-semibold">Monthly goal</span>
        <span className="flex items-center gap-1" style={muted}>
          <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^\d.]/g, ""))} onBlur={flushGoal} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="w-[70px] rounded-md bg-[var(--chip)] px-1.5 py-0.5 text-right outline-none" /> {t.currency}
        </span>
      </div>
    </div>
  );
}

// ---------- counts: visitors, clicks, emails, followers ----------

function countWidget(spec: ProviderSpec): WidgetDef {
  const unit = spec.unit ?? "";
  const short = unit.replace(/ this week$/, "");
  const Tile: FC<TileProps> = () => {
    const c = useAcct<CountData>(spec.id);
    if (!c || isErr(c)) return <TileNote spec={spec} v={c} />;
    return (
      <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
        <Mark spec={spec} />
        <div className="flex flex-col leading-none">
          <span className="tabular text-[15px] font-semibold">{compact(c.value)}</span>
          <span className="mt-1 text-[10px]" style={muted}>{short}</span>
        </div>
        {c.series && c.series.length > 1 && <Sparkline values={c.series} width={44} height={24} color={spec.color === "#000000" ? "var(--fg)" : spec.color} />}
      </div>
    );
  };
  const Card: FC<CardProps> = () => {
    const c = useAcct<CountData>(spec.id);
    return (
      <AccountCard spec={spec} v={c}>
        {(d) =>
          d.kind === "count" && (
            <>
              <div className="rounded-[14px] p-3.5" style={{ background: "var(--chip)" }}>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="tabular text-[30px] font-semibold leading-none">{d.value.toLocaleString()}</div>
                    <div className="mt-1 text-[11.5px]" style={muted}>{unit}</div>
                  </div>
                  <div className="text-right">
                    {d.change != null && <Change n={d.change} size={12} />}
                    {d.label && <div className="mt-1 text-[11px]" style={muted}>{d.label}</div>}
                  </div>
                </div>
                {d.series && d.series.length > 1 && (
                  <div className="mt-3">
                    <Sparkline values={d.series} width={306} height={60} color={spec.color === "#000000" ? "var(--fg)" : spec.color} strokeWidth={2} />
                    <div className="mt-1 flex justify-between text-[9.5px]" style={{ color: "var(--fg3)" }}><span>{d.series.length > 7 ? "Two weeks ago" : "A week ago"}</span><span>Today</span></div>
                  </div>
                )}
              </div>
            </>
          )
        }
      </AccountCard>
    );
  };
  const category: Category = spec.group === "Social" ? "Social" : spec.group === "Analytics" ? "Analytics" : spec.id === "resend" ? "Online & Mail" : "Developer";
  return { type: `acct-${spec.id}`, name: spec.group === "Social" ? `${spec.name} Followers` : spec.name, category, description: `${cap(unit)} on ${spec.name}.`, Tile, Card, cardWidth: 360, cardFocus: true, account: spec.id };
}

// ---------- API balances: DeepSeek, Grok ----------

function balanceWidget(spec: ProviderSpec): WidgetDef {
  const Tile: FC<TileProps> = () => {
    const b = useAcct<BalanceData>(spec.id);
    if (!b || isErr(b)) return <TileNote spec={spec} v={b} />;
    return (
      <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
        <Mark spec={spec} />
        <div className="flex flex-col leading-none">
          <span className="tabular text-[15px] font-semibold">{money(b.balance, b.currency)}</span>
          <span className="mt-1 text-[10px]" style={{ color: b.available ? "var(--fg2)" : down }}>{b.available ? "balance" : "out of credit"}</span>
        </div>
      </div>
    );
  };
  const Card: FC<CardProps> = () => {
    const b = useAcct<BalanceData>(spec.id);
    return (
      <AccountCard spec={spec} v={b}>
        {(d) =>
          d.kind === "balance" && (
            <div className="grid grid-cols-2 gap-2">
              <Stat label={d.spent != null ? "Prepaid credit" : "Balance"}>{money(d.balance, d.currency)}</Stat>
              {d.spent != null ? (
                <Stat label="This month" sub={<span style={muted}>billed after credit</span>}>{money(d.spent, d.currency)}</Stat>
              ) : (
                <Stat label="API">{<span style={{ color: d.available ? up : down }}>{d.available ? "Available" : "Top up"}</span>}</Stat>
              )}
            </div>
          )
        }
      </AccountCard>
    );
  };
  return { type: `acct-${spec.id}`, name: `${spec.name} Balance`, category: "AI", description: `What's left on your ${spec.name} API balance${spec.id === "grok" ? ", and this month's bill" : ""}.`, Tile, Card, cardWidth: 340, cardFocus: true, account: spec.id };
}

// ---------- AI plan limits: GLM, Cursor ----------

/** a dark brand colour can't be seen on the dark glass, so it draws in the text colour */
const ink = (c: string) => (/^#[01][0-9a-f]{5}$/i.test(c) ? "var(--fg)" : c);
const meterColor = (used: number, spec: ProviderSpec) => (used >= 90 ? down : used >= 75 ? "#ff9f0a" : ink(spec.color));
const until = (ms: number) => (ms > 48 * 3600_000 ? `${Math.round(ms / 86400_000)} days` : ms > 3600_000 ? countdown(ms).replace(/:\d\d$/, "") : `${Math.max(1, Math.round(ms / 60_000))} min`);
const resetText = (at: number | null, now: number) => (!at ? null : at > now ? `resets in ${until(at - now)}` : "reset");

function UsageBody({ d, spec, now }: { d: UsageData; spec: ProviderSpec; now: number }) {
  const hist = d.history ?? [];
  return (
    <>
      <div className="space-y-2.5 rounded-[14px] p-3.5" style={{ background: "var(--chip)" }}>
        {d.windows.map((w, i) => (
          <div key={w.label}>
            <div className="flex items-baseline justify-between">
              <span className={i === 0 ? "text-[12.5px] font-semibold" : "text-[12px]"}>{w.label}</span>
              <span className={`tabular font-semibold ${i === 0 ? "text-[17px]" : "text-[12.5px]"}`} style={{ color: w.used >= 90 ? down : undefined }}>{Math.round(w.used)}%</span>
            </div>
            <div className={`mt-1 overflow-hidden rounded-full ${i === 0 ? "h-[8px]" : "h-[5px]"}`} style={{ background: "var(--track)" }}>
              <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${Math.min(100, w.used)}%` }} transition={{ type: "spring", stiffness: 140, damping: 22 }} style={{ background: meterColor(w.used, spec) }} />
            </div>
            {(w.detail || (w.resetsAt && w.resetsAt !== d.windows[i - 1]?.resetsAt)) && (
              <div className="tabular mt-1 flex justify-between text-[10.5px]" style={muted}>
                <span>{w.detail}</span>
                <span>{w.resetsAt !== d.windows[i - 1]?.resetsAt ? resetText(w.resetsAt, now) : null}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {hist.length > 2 && (
        <div className="mt-3 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
          <div className="mb-1.5 flex justify-between text-[11px] font-semibold" style={muted}>
            <span>{d.windows[0]?.label} over the last day</span>
            <span className="tabular">peak {Math.round(Math.max(...hist.map((p) => p.used)))}%</span>
          </div>
          <Sparkline values={hist.map((p) => p.used)} width={306} height={52} color={ink(spec.color)} strokeWidth={2} range={[0, 100]} />
          <div className="mt-1 flex justify-between text-[9.5px]" style={{ color: "var(--fg3)" }}>
            <span>{new Date(hist[0].t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            <span>Now</span>
          </div>
        </div>
      )}
      {!!d.notes?.length && (
        <div className="mt-3 space-y-1 px-1 text-[12px]">
          {d.notes.map((n) => (
            <div key={n.label} className="flex justify-between">
              <span style={muted}>{n.label}</span>
              <b className="tabular">{n.value}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function usageWidget(spec: ProviderSpec): WidgetDef {
  const Tile: FC<TileProps> = () => {
    const u = useAcct<UsageData>(spec.id);
    const now = useNow(30_000);
    if (!u || isErr(u)) return <TileNote spec={spec} v={u} />;
    const w = u.windows[0];
    return (
      <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
        <Ring value={(w?.used ?? 0) / 100} size={34} stroke={3.5} color={meterColor(w?.used ?? 0, spec)}>
          <span className="text-[11px] font-bold" style={{ color: ink(spec.color) }}>{spec.letter}</span>
        </Ring>
        <div className="flex flex-col leading-none">
          <span className="tabular text-[15px] font-semibold">{w ? `${Math.round(w.used)}%` : "-"}</span>
          <span className="tabular mt-1 max-w-[110px] truncate text-[10px]" style={muted}>{resetText(w?.resetsAt ?? null, now) ?? w?.label ?? spec.name}</span>
        </div>
      </div>
    );
  };
  const Card: FC<CardProps> = () => {
    const u = useAcct<UsageData>(spec.id);
    const now = useNow(30_000);
    return <AccountCard spec={spec} v={u}>{(d) => d.kind === "usage" && <UsageBody d={d} spec={spec} now={now} />}</AccountCard>;
  };
  const description = spec.id === "cursor" ? "How much of Cursor's included usage is gone, by pool, and when the cycle starts over." : `Your ${spec.name} limits: the 5-hour window and the month, and when each resets.`;
  return { type: `acct-${spec.id}`, name: `${spec.name} Usage`, category: "AI", description, Tile, Card, cardWidth: 360, cardFocus: true, account: spec.id };
}

// ---------- Linear ----------

const STATE_COLORS: Record<string, string> = { started: "#f2c94c", unstarted: "#8a8f98", backlog: "#5e6ad2", triage: "#ff9f0a" };

function issuesWidget(spec: ProviderSpec): WidgetDef {
  const Tile: FC<TileProps> = () => {
    const l = useAcct<IssuesData>(spec.id);
    if (!l || isErr(l)) return <TileNote spec={spec} v={l} />;
    const doing = l.issues.filter((i) => i.type === "started").length;
    return (
      <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
        <Mark spec={spec} />
        <div className="flex flex-col leading-none">
          <span className="tabular text-[15px] font-semibold">{l.issues.length}</span>
          <span className="mt-1 text-[10px]" style={muted}>{doing ? `${doing} in progress` : "open issues"}</span>
        </div>
      </div>
    );
  };
  const Card: FC<CardProps> = ({ close }) => {
    const l = useAcct<IssuesData>(spec.id);
    return (
      <AccountCard spec={spec} v={l}>
        {(d) =>
          d.kind === "issues" &&
          (d.issues.length ? (
            <div className="thin-scroll max-h-[300px] space-y-0.5 overflow-y-auto">
              {d.issues.map((i) => (
                <button key={i.id} onClick={() => { open(i.url); close(); }} className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--chip)]">
                  <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ border: `2px solid ${STATE_COLORS[i.type] ?? "#8a8f98"}`, background: i.type === "started" ? STATE_COLORS.started : undefined }} />
                  <span className="tabular w-[62px] shrink-0 text-[11px]" style={muted}>{i.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{i.title}</span>
                  <span className="shrink-0 text-[10.5px]" style={{ color: "var(--fg3)" }}>{i.state}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-[12.5px]" style={muted}>Nothing assigned to you. Nice.</div>
          ))
        }
      </AccountCard>
    );
  };
  return { type: `acct-${spec.id}`, name: "Linear Issues", category: "Developer", description: "Issues assigned to you that are still open, newest first.", Tile, Card, cardWidth: 380, cardFocus: true, account: spec.id };
}

// ---------- LeetCode ----------

const DIFF: [keyof Pick<LeetcodeData, "easy" | "medium" | "hard">, string, string][] = [["easy", "Easy", "#00b8a3"], ["medium", "Medium", "#ffc01e"], ["hard", "Hard", "#ef4743"]];

function leetcodeWidget(spec: ProviderSpec): WidgetDef {
  const Tile: FC<TileProps> = () => {
    const l = useAcct<LeetcodeData>(spec.id);
    if (!l || isErr(l)) return <TileNote spec={spec} v={l} />;
    return (
      <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
        <Mark spec={spec} />
        <div className="flex flex-col leading-none">
          <span className="tabular text-[15px] font-semibold">{l.solved}</span>
          <span className="mt-1 flex items-center gap-0.5 text-[10px]" style={muted}>{l.streak ? <><Flame size={10} className="text-[#ff9f0a]" />{l.streak} day streak</> : "solved"}</span>
        </div>
      </div>
    );
  };
  const Card: FC<CardProps> = () => {
    const l = useAcct<LeetcodeData>(spec.id);
    return (
      <AccountCard spec={spec} v={l}>
        {(d) =>
          d.kind === "leetcode" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Solved">{d.solved}</Stat>
                <Stat label="Streak">{d.streak}</Stat>
                <Stat label="Rank">{d.ranking ? compact(d.ranking) : "-"}</Stat>
              </div>
              <div className="mt-3 space-y-2 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
                {DIFF.map(([k, label, color]) => (
                  <div key={k} className="flex items-center gap-2.5 text-[12px]">
                    <span className="w-[54px] font-semibold" style={{ color }}>{label}</span>
                    <div className="h-[7px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
                      <div className="h-full rounded-full" style={{ width: `${d.solved ? Math.round((d[k] / d.solved) * 100) : 0}%`, background: color }} />
                    </div>
                    <span className="tabular w-[36px] text-right font-semibold">{d[k]}</span>
                  </div>
                ))}
              </div>
            </>
          )
        }
      </AccountCard>
    );
  };
  return { type: `acct-${spec.id}`, name: "LeetCode", category: "Developer", description: "Problems solved by difficulty, and your streak.", Tile, Card, cardWidth: 350, cardFocus: true, account: spec.id };
}

export const accountWidgets: WidgetDef[] = [
  { type: "totalRevenue", name: "Total Revenue", category: "Finance", description: "Stripe and every other store you connect, added up against your goal.", Tile: TotalTile, Card: TotalCard, cardWidth: 360, cardFocus: true },
  ...PROVIDERS.flatMap((p) => {
    if (p.kind === "revenue") return revenueWidget(p);
    if (p.kind === "count") return [countWidget(p)];
    if (p.kind === "balance") return [balanceWidget(p)];
    if (p.kind === "issues") return [issuesWidget(p)];
    if (p.kind === "usage") return [usageWidget(p)];
    return [leetcodeWidget(p)];
  }),
];
