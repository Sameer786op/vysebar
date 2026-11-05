// GitHub contributions, crypto, Stripe revenue and stocks.
import { useState } from "react";
import { motion } from "motion/react";
import { Bell, Flame, Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import { compact, money } from "../lib/format";
import { refreshTopic, setSettings, useCommitted, useSettings, useTopic } from "../lib/state";
import { GithubMark } from "../components/icons";
import { Bars, CardHeader, Chip, Ring, Sparkline } from "../components/ui";
import type { CardProps, WidgetDef } from "./types";

type Err = { error: string };
const isErr = (v: unknown): v is Err => !!v && typeof v === "object" && "error" in v;
const up = "#30d158";
const down = "#ff453a";
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n ?? 0).toFixed(2)}%`;

function NeedsSetup({ text, compactView }: { text: string; compactView?: boolean }) {
  if (compactView) return <span className="max-w-[150px] truncate px-1 text-[11px]" style={{ color: "var(--fg2)" }}>{text}</span>;
  return (
    <div className="py-5 text-center">
      <div className="text-[12.5px]" style={{ color: "var(--fg2)" }}>{text}</div>
      <button onClick={() => window.vyse.invoke("window:settings", "accounts")} className="mt-3 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--accent)" }}>Open Accounts</button>
    </div>
  );
}

// ---------- GitHub ----------

interface Github { user: string; avatar: string; followers: number; repos: number; days: { date: string; level: number; count: number }[]; streak: number; week: number; today: number; year: number; notifications: number | null }
const levels = ["var(--track)", "#0e4429", "#006d32", "#26a641", "#39d353"];

function Contributions({ days, weeks, cell, gap = 1.5 }: { days: Github["days"]; weeks: number; cell: number; gap?: number }) {
  // columns are weeks starting on Sunday, like on github.com
  const list = days.slice(-(weeks * 7 - (6 - new Date().getDay())));
  const pad = list.length ? new Date(list[0].date + "T12:00").getDay() : 0;
  const cells = [...Array(pad).fill(null), ...list];
  const cols = Math.ceil(cells.length / 7);
  return (
    <svg width={cols * (cell + gap)} height={7 * (cell + gap)}>
      {cells.map((d, i) =>
        d ? <rect key={d.date} x={Math.floor(i / 7) * (cell + gap)} y={(i % 7) * (cell + gap)} width={cell} height={cell} rx={cell / 4} fill={levels[d.level]}><title>{`${d.count} on ${d.date}`}</title></rect> : null,
      )}
    </svg>
  );
}

function GithubActivityTile() {
  const g = useTopic<Github | Err>("github");
  if (!g || isErr(g)) return <div className="flex h-full items-center gap-2 px-3"><GithubMark size={20} /><NeedsSetup compactView text={isErr(g) ? "Add your GitHub username" : "Loading..."} /></div>;
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <Contributions days={g.days} weeks={16} cell={4.2} gap={1.2} />
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{g.today}</span>
        <span className="mt-1 text-[9.5px]" style={{ color: "var(--fg2)" }}>today</span>
      </div>
    </div>
  );
}

function GithubOverviewTile() {
  const g = useTopic<Github | Err>("github");
  if (!g || isErr(g)) return <div className="flex h-full items-center gap-2 px-3"><GithubMark size={20} /><NeedsSetup compactView text={isErr(g) ? "Add your GitHub username" : "Loading..."} /></div>;
  return (
    <div className="flex h-full items-center gap-2.5 pl-2 pr-3.5">
      <img src={g.avatar} className="h-[32px] w-[32px] rounded-full" />
      <div className="flex flex-col leading-none">
        <span className="flex items-center gap-1 text-[13px] font-semibold"><Flame size={12} className="text-[#ff9f0a]" />{g.streak} day{g.streak === 1 ? "" : "s"}</span>
        <span className="mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>{g.week} this week</span>
      </div>
      {g.notifications ? <span className="flex items-center gap-0.5 rounded-full bg-[#ff453a] px-1.5 py-[2px] text-[10px] font-bold text-white"><Bell size={9} />{g.notifications}</span> : null}
    </div>
  );
}

function GithubCard(_: CardProps) {
  const g = useTopic<Github | Err>("github");
  if (!g || isErr(g)) return <NeedsSetup text={isErr(g) ? g.error : "Loading..."} />;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <img src={g.avatar} className="h-11 w-11 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{g.user}</div>
          <div className="text-[11.5px]" style={{ color: "var(--fg2)" }}>{g.repos} repos · {g.followers} followers</div>
        </div>
        <button onClick={() => window.vyse.invoke("open:url", `https://github.com/${g.user}`)} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Profile</button>
      </div>
      <div className="overflow-hidden rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
        <Contributions days={g.days} weeks={18} cell={14} gap={3} />
        <div className="mt-2 flex items-center justify-end gap-1 text-[9.5px]" style={{ color: "var(--fg2)" }}>
          Less {levels.map((c) => <span key={c} className="h-[9px] w-[9px] rounded-[2px]" style={{ background: c }} />)} More
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {([["Today", g.today], ["Week", g.week], ["Streak", g.streak], ["Year", compact(g.year)]] as const).map(([k, v]) => (
          <div key={k} className="rounded-[12px] py-2" style={{ background: "var(--chip)" }}>
            <div className="tabular text-[17px] font-semibold">{v}</div>
            <div className="text-[10px]" style={{ color: "var(--fg2)" }}>{k}</div>
          </div>
        ))}
      </div>
      {g.notifications != null && (
        <button onClick={() => window.vyse.invoke("open:url", "https://github.com/notifications")} className="mt-2 flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-[12.5px]" style={{ background: "var(--chip)" }}>
          <span className="flex items-center gap-2"><Bell size={13} /> Notifications</span>
          <b>{g.notifications}</b>
        </button>
      )}
    </div>
  );
}

// ---------- crypto ----------

interface Crypto { id: string; symbol: string; name: string; price: number; change: number; image: string; spark: number[] }

function CryptoTile() {
  const c = useTopic<Crypto | Err>("crypto");
  if (!c || isErr(c)) return <div className="flex h-full items-center px-3 text-[11px]" style={{ color: "var(--fg2)" }}>{isErr(c) ? c.error : "Loading..."}</div>;
  const color = c.change >= 0 ? up : down;
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <img src={c.image} className="h-[28px] w-[28px]" />
      <div className="flex flex-col leading-none">
        <span className="tabular text-[14px] font-semibold">{money(c.price)}</span>
        <span className="tabular mt-1 text-[10px] font-semibold" style={{ color }}>{c.symbol} {pct(c.change)}</span>
      </div>
      <Sparkline values={c.spark} width={46} height={24} color={color} />
    </div>
  );
}

const COINS = ["bitcoin", "ethereum", "solana", "binancecoin", "ripple", "dogecoin", "cardano", "toncoin"];

function CryptoCard(_: CardProps) {
  const s = useSettings();
  const c = useTopic<Crypto | Err>("crypto");
  const [coin, setCoin] = useState("");
  const pick = (id: string) => {
    setSettings({ crypto: id });
    setTimeout(() => refreshTopic("crypto"), 50);
  };
  return (
    <div>
      {c && !isErr(c) ? (
        <>
          <div className="flex items-center gap-3">
            <img src={c.image} className="h-10 w-10" />
            <div>
              <div className="text-[15px] font-semibold">{c.name}</div>
              <div className="text-[11.5px]" style={{ color: "var(--fg2)" }}>{c.symbol} · last 7 days</div>
            </div>
            <div className="ml-auto text-right">
              <div className="tabular text-[20px] font-semibold">{money(c.price)}</div>
              <div className="tabular text-[12px] font-semibold" style={{ color: c.change >= 0 ? up : down }}>{pct(c.change)} 24h</div>
            </div>
          </div>
          <div className="mt-3"><Sparkline values={c.spark} width={330} height={90} color={c.change >= 0 ? up : down} strokeWidth={2} /></div>
        </>
      ) : (
        <div className="py-4 text-center text-[12px]" style={{ color: "var(--fg2)" }}>{isErr(c) ? c.error : "Loading..."}</div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {COINS.map((id) => <Chip key={id} active={s.crypto === id} onClick={() => pick(id)}>{id === "binancecoin" ? "BNB" : id[0].toUpperCase() + id.slice(1)}</Chip>)}
        <span className="flex items-center rounded-full px-2 text-[12px]" style={{ background: "var(--chip)" }}>
          <input value={coin} onChange={(e) => setCoin(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && coin.trim()) { pick(coin.trim().toLowerCase()); setCoin(""); } }} placeholder="CoinGecko id" className="w-[90px] bg-transparent py-1 outline-none" />
        </span>
      </div>
    </div>
  );
}

// ---------- Stripe ----------

interface Stripe { total: number; currency: string; days: { date: string; value: number }[]; week: number; change: number }

function StripeLogo({ size = 30 }: { size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center rounded-[9px] text-white" style={{ width: size, height: size, background: "#635bff" }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="white"><path d="M13.5 9.2c-1.6-.6-2.5-1-2.5-1.7 0-.6.5-1 1.4-1 1.6 0 3.3.6 4.4 1.2l.7-4.1C16.6 3 15 2.5 12.7 2.5 10.9 2.5 9.4 3 8.3 3.8 7.2 4.7 6.6 6 6.6 7.5c0 2.8 1.7 4 4.5 5 1.8.6 2.4 1.1 2.4 1.8s-.6 1.1-1.6 1.1c-1.3 0-3.4-.6-4.8-1.4l-.7 4.1c1.2.7 3.4 1.4 5.7 1.4 1.9 0 3.5-.5 4.6-1.3 1.2-.9 1.8-2.3 1.8-4 0-2.9-1.8-4.1-4.9-5Z" /></svg>
    </div>
  );
}

function StripeTile() {
  const s = useSettings();
  const r = useTopic<Stripe | Err>("stripe");
  if (!r || isErr(r)) return <div className="flex h-full items-center gap-2 px-2.5"><StripeLogo /><NeedsSetup compactView text={isErr(r) ? "Add a Stripe key" : "Loading..."} /></div>;
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <Ring value={r.total / (s.revenueGoal || 1)} size={32} stroke={3.5} color="#635bff"><span className="text-[8.5px] font-bold">{Math.min(999, Math.round((r.total / (s.revenueGoal || 1)) * 100))}%</span></Ring>
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{money(r.total, r.currency, true)}</span>
        <span className="mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>last 30 days</span>
      </div>
    </div>
  );
}

function StripeChartTile() {
  const r = useTopic<Stripe | Err>("stripe");
  if (!r || isErr(r)) return <div className="flex h-full items-center gap-2 px-2.5"><StripeLogo /><NeedsSetup compactView text={isErr(r) ? "Add a Stripe key" : "Loading..."} /></div>;
  return (
    <div className="flex h-full items-center gap-2.5 pl-3 pr-3.5">
      <div className="flex flex-col leading-none">
        <span className="tabular text-[14px] font-semibold">{money(r.week, r.currency, true)}</span>
        <span className="tabular mt-1 flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: r.change >= 0 ? up : down }}>{r.change >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{pct(r.change)}</span>
      </div>
      <Bars values={r.days.slice(-7).map((d) => Math.max(0, d.value))} width={56} height={26} color="#635bff" highlight={6} />
    </div>
  );
}

function StripeCard(_: CardProps) {
  const s = useSettings();
  const r = useTopic<Stripe | Err>("stripe");
  const [goal, setGoal, flushGoal] = useCommitted(String(s.revenueGoal), (g) => setSettings({ revenueGoal: Number(g) || 1000 }));
  if (!r || isErr(r)) return <NeedsSetup text={isErr(r) ? r.error : "Loading..."} />;
  return (
    <div>
      <CardHeader title={<span className="flex items-center gap-2"><StripeLogo size={22} /> Revenue</span>} sub="Net of fees and refunds" right={<button onClick={() => window.vyse.invoke("open:url", "https://dashboard.stripe.com")} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Dashboard</button>} />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
          <div className="text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>Last 30 days</div>
          <div className="tabular mt-0.5 text-[21px] font-semibold">{money(r.total, r.currency)}</div>
        </div>
        <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
          <div className="text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>This week</div>
          <div className="tabular mt-0.5 text-[21px] font-semibold">{money(r.week, r.currency)}</div>
          <div className="tabular text-[11px] font-semibold" style={{ color: r.change >= 0 ? up : down }}>{pct(r.change)} vs last week</div>
        </div>
      </div>
      <div className="mt-3 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
        <Bars values={r.days.map((d) => Math.max(0, d.value))} width={306} height={70} color="#635bff" gap={4} highlight={r.days.length - 1} />
        <div className="mt-1 flex justify-between text-[9.5px]" style={{ color: "var(--fg3)" }}>
          <span>{new Date(r.days[0].date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })}</span>
          <span>Today</span>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-[11.5px]">
          <span className="font-semibold">Monthly goal</span>
          <span className="flex items-center gap-1" style={{ color: "var(--fg2)" }}>
            <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^\d.]/g, ""))} onBlur={flushGoal} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="w-[70px] rounded-md bg-[var(--chip)] px-1.5 py-0.5 text-right outline-none" /> {r.currency}
          </span>
        </div>
        <div className="mt-1.5 h-[8px] overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
          <motion.div className="h-full rounded-full" style={{ background: "#635bff" }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, (r.total / (s.revenueGoal || 1)) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

// ---------- stocks ----------

interface Quote { symbol: string; price: number; change: number; open: number; high: number; low: number; prev: number; history: number[] }
interface Stocks { quotes: Quote[]; at: number }

function StockTile() {
  const st = useTopic<Stocks | Err>("stocks");
  if (!st || isErr(st)) return <div className="flex h-full items-center gap-2 px-3"><TrendingUp size={18} /><NeedsSetup compactView text={isErr(st) ? "Add a Finnhub key" : "Loading..."} /></div>;
  const q = st.quotes[0];
  if (!q) return <div className="flex h-full items-center px-3 text-[11px]">No tickers</div>;
  return (
    <div className="flex h-full flex-col justify-center px-3.5 leading-none">
      <span className="text-[10.5px] font-bold" style={{ color: "var(--fg2)" }}>{q.symbol}</span>
      <span className="tabular mt-1 text-[16px] font-semibold">{money(q.price)}</span>
      <span className="tabular mt-[3px] text-[10px] font-semibold" style={{ color: q.change >= 0 ? up : down }}>{pct(q.change)}</span>
    </div>
  );
}

function StockChartTile() {
  const st = useTopic<Stocks | Err>("stocks");
  if (!st || isErr(st)) return <div className="flex h-full items-center gap-2 px-3"><TrendingUp size={18} /><NeedsSetup compactView text={isErr(st) ? "Add a Finnhub key" : "Loading..."} /></div>;
  const q = st.quotes[0];
  if (!q) return null;
  const color = q.change >= 0 ? up : down;
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <div className="flex flex-col leading-none">
        <span className="text-[10.5px] font-bold">{q.symbol}</span>
        <span className="tabular mt-1 text-[13px] font-semibold">{money(q.price)}</span>
        <span className="tabular mt-[2px] text-[9.5px] font-semibold" style={{ color }}>{pct(q.change)}</span>
      </div>
      <Sparkline values={q.history.length > 1 ? q.history : [q.prev, q.open, q.low, q.high, q.price]} width={60} height={28} color={color} />
    </div>
  );
}

function WatchlistTile() {
  const st = useTopic<Stocks | Err>("stocks");
  if (!st || isErr(st)) return <div className="flex h-full items-center gap-2 px-3"><TrendingUp size={18} /><NeedsSetup compactView text={isErr(st) ? "Add a Finnhub key" : "Loading..."} /></div>;
  return (
    <div className="flex h-full items-center gap-3.5 px-3.5">
      {st.quotes.slice(0, 3).map((q) => (
        <div key={q.symbol} className="flex flex-col leading-none">
          <span className="text-[10px] font-bold" style={{ color: "var(--fg2)" }}>{q.symbol}</span>
          <span className="tabular mt-1 text-[12.5px] font-semibold">{q.price.toFixed(2)}</span>
          <span className="tabular mt-[2px] text-[9.5px] font-semibold" style={{ color: q.change >= 0 ? up : down }}>{pct(q.change)}</span>
        </div>
      ))}
    </div>
  );
}

function StocksCard(_: CardProps) {
  const s = useSettings();
  const st = useTopic<Stocks | Err>("stocks");
  const [sym, setSym] = useState("");
  const setTickers = (tickers: string[]) => {
    setSettings({ tickers });
    setTimeout(() => refreshTopic("stocks"), 50);
  };
  if (!st || isErr(st)) return <NeedsSetup text={isErr(st) ? st.error : "Loading..."} />;
  return (
    <div>
      <CardHeader title="Stocks" sub={`Updated ${new Date(st.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`} />
      <div className="space-y-1">
        {st.quotes.map((q) => {
          const color = q.change >= 0 ? up : down;
          return (
            <div key={q.symbol} className="group flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-[var(--chip)]">
              <div className="w-[60px]">
                <div className="text-[13px] font-bold">{q.symbol}</div>
                <div className="tabular text-[10px]" style={{ color: "var(--fg2)" }}>L {q.low?.toFixed(0)} · H {q.high?.toFixed(0)}</div>
              </div>
              <Sparkline values={q.history.length > 1 ? q.history : [q.prev, q.open, q.price]} width={120} height={28} color={color} />
              <div className="ml-auto text-right">
                <div className="tabular text-[13px] font-semibold">{q.price.toFixed(2)}</div>
                <div className="tabular rounded-md px-1.5 text-[11px] font-semibold text-white" style={{ background: color }}>{pct(q.change)}</div>
              </div>
              <button className="opacity-0 transition-opacity group-hover:opacity-60" onClick={() => setTickers(s.tickers.filter((t) => t !== q.symbol))}><X size={13} /></button>
            </div>
          );
        })}
      </div>
      {s.tickers.length < 6 && (
        <div className="mt-2 flex items-center gap-2 rounded-[12px] px-3 py-2" style={{ background: "var(--chip)" }}>
          <Plus size={14} style={{ color: "var(--fg2)" }} />
          <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter" && sym.trim() && !s.tickers.includes(sym.trim())) { setTickers([...s.tickers, sym.trim()]); setSym(""); } }} placeholder="Add a ticker (e.g. TSLA)" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--fg3)]" />
        </div>
      )}
    </div>
  );
}

export const moneyWidgets: WidgetDef[] = [
  { type: "githubActivity", name: "GitHub Activity", category: "Developer", description: "Your contribution graph, the last four months of it.", Tile: GithubActivityTile, Card: GithubCard, cardWidth: 380, account: "GitHub username" },
  { type: "githubOverview", name: "GitHub Overview", category: "Developer", description: "Streak, this week's contributions and unread notifications.", Tile: GithubOverviewTile, Card: GithubCard, cardWidth: 380, account: "GitHub username" },
  { type: "crypto", name: "Crypto", category: "Finance", description: "A coin's price, its day and its week.", Tile: CryptoTile, Card: CryptoCard, cardWidth: 360, cardFocus: true },
  { type: "stripe", name: "Stripe Revenue", category: "Finance", description: "Revenue over 30 days against your monthly goal.", Tile: StripeTile, Card: StripeCard, cardWidth: 360, cardFocus: true, account: "Stripe key" },
  { type: "stripeChart", name: "Stripe Chart", category: "Finance", description: "This week's revenue, day by day, and how it compares.", Tile: StripeChartTile, Card: StripeCard, cardWidth: 360, cardFocus: true, account: "Stripe key" },
  { type: "stock", name: "Stock", category: "Stocks", description: "One ticker's price and today's move.", Tile: StockTile, Card: StocksCard, cardWidth: 360, cardFocus: true, account: "Finnhub key" },
  { type: "stockChart", name: "Stock Chart", category: "Stocks", description: "A ticker with today's line.", Tile: StockChartTile, Card: StocksCard, cardWidth: 360, cardFocus: true, account: "Finnhub key" },
  { type: "watchlist", name: "Watchlist", category: "Stocks", description: "Three tickers side by side.", Tile: WatchlistTile, Card: StocksCard, cardWidth: 360, cardFocus: true, account: "Finnhub key" },
];
