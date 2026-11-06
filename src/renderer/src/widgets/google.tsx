// Gmail and Search Console, through your Google sign-in: each asks Google for its one read-only
// permission from its own card, the first time you open it.
import { useState } from "react";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { compact, relative } from "../lib/format";
import { setSettings, useNow, useSettings, useTopic } from "../lib/state";
import { CardHeader, Chip, Sparkline } from "../components/ui";
import { Mark } from "./accounts";
import type { CardProps, WidgetDef } from "./types";

type Extra = "gmail" | "searchConsole";
type Need = { error: string; connect?: "signin" | "grant"; enable?: string };
const isNeed = (v: unknown): v is Need => !!v && typeof v === "object" && "error" in v;
const muted = { color: "var(--fg2)" };
const open = (url: string) => void window.vyse.invoke("open:url", url);
const API: Record<Extra, string> = {
  gmail: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  searchConsole: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com",
};
const WHAT: Record<Extra, string> = {
  gmail: "Let VyseBar see who your unread mail is from and its subject lines. It can't read the messages themselves or send anything.",
  searchConsole: "Let VyseBar read your sites' search clicks, impressions and positions. It can't change anything in Search Console.",
};

const GMAIL = { color: "#ea4335", letter: "M" };
const GSC = { color: "#458cf5", letter: "G" };
const pill = "flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40";

function Connect({ need, extra, name }: { need: Need; extra: Extra; name: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const grant = async () => {
    setBusy(true);
    setErr(null);
    const r = await window.vyse.invoke<{ ok: true } | { error: string }>("google:grant", extra).catch((e: Error) => ({ error: e.message }));
    setBusy(false);
    if ("error" in r) setErr(r.error);
  };
  return (
    <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
      <p className="text-[12.5px] leading-snug">{need.connect === "signin" ? `Sign in with Google in Settings › Accounts, then allow ${name} here.` : need.connect === "grant" ? WHAT[extra] : need.error}</p>
      {need.connect === "grant" && (
        <p className="mt-1.5 text-[11px] leading-snug" style={muted}>
          First turn on the {name} API in the Google Cloud project your OAuth client is in. While the app is in Testing, Google ends this access after a week; Audience › Publish app keeps it. Google will then warn that the app isn't verified: it's your own client, so choose Advanced and continue.
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {need.connect === "signin" && <button onClick={() => void window.vyse.invoke("window:settings", "accounts")} className={pill} style={{ background: "var(--accent)", color: "white" }}>Open Accounts</button>}
        {need.connect === "grant" && (
          <button onClick={() => void grant()} disabled={busy} className={pill} style={{ background: "var(--accent)", color: "white" }}>
            {busy ? "Waiting for your browser..." : `Allow ${name}`}
          </button>
        )}
        {(need.connect === "grant" || need.enable) && (
          <button onClick={() => open(need.enable ?? API[extra])} className={pill} style={{ background: "var(--track)" }}>
            Turn on the API <ExternalLink size={11} />
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-[11.5px]" style={{ color: "#ff453a" }}>{err}</p>}
    </div>
  );
}

function TileNote({ spec, v, name }: { spec: { color: string; letter: string }; v: Need | null | undefined; name: string }) {
  return (
    <div className="flex h-full items-center gap-2 pl-2.5 pr-3">
      <Mark spec={spec} />
      <span className="max-w-[130px] truncate text-[11px]" style={muted}>{!v ? "Loading..." : v.connect ? `Connect ${name}` : v.error}</span>
    </div>
  );
}

// ---------- Gmail ----------

interface Gmail {
  unread: number;
  email: string;
  messages: { id: string; thread: string; from: string; subject: string; at: number }[];
}

function GmailTile() {
  const g = useTopic<Gmail | Need>("gmail");
  if (!g || isNeed(g)) return <TileNote spec={GMAIL} v={g} name="Gmail" />;
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <Mark spec={GMAIL} />
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{g.unread.toLocaleString()}</span>
        <span className="mt-1 text-[10px]" style={muted}>unread</span>
      </div>
    </div>
  );
}

function GmailCard({ close }: CardProps) {
  const g = useTopic<Gmail | Need>("gmail");
  const now = useNow(60_000);
  const email = g && !isNeed(g) ? g.email : "";
  const inbox = (thread?: string) => {
    open(`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#inbox${thread ? `/${thread}` : ""}`);
    close();
  };
  return (
    <div>
      <CardHeader
        title={<span className="flex items-center gap-2"><Mark spec={GMAIL} size={22} /> Gmail</span>}
        sub={email || "Unread in your inbox"}
        right={
          <button title="Open Gmail" onClick={() => inbox()} className="grid h-7 w-7 place-items-center rounded-full" style={{ background: "var(--chip)" }}>
            <ExternalLink size={12} />
          </button>
        }
      />
      {!g ? (
        <div className="py-6 text-center text-[12px]" style={muted}>Loading...</div>
      ) : isNeed(g) ? (
        <Connect need={g} extra="gmail" name="Gmail" />
      ) : g.messages.length ? (
        <>
          <div className="thin-scroll max-h-[320px] space-y-0.5 overflow-y-auto">
            {g.messages.map((m) => (
              <button key={m.id} onClick={() => inbox(m.thread)} className="flex w-full items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--chip)]">
                <span className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: GMAIL.color }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12.5px] font-semibold">{m.from}</span>
                    <span className="tabular shrink-0 text-[10.5px]" style={{ color: "var(--fg3)" }}>{m.at ? relative(m.at - now) : ""}</span>
                  </span>
                  <span className="block truncate text-[11.5px]" style={muted}>{m.subject}</span>
                </span>
              </button>
            ))}
          </div>
          {g.unread > g.messages.length && <div className="mt-2 text-center text-[11px]" style={muted}>{g.unread.toLocaleString()} unread in all</div>}
        </>
      ) : (
        <div className="py-6 text-center text-[12.5px]" style={muted}>Nothing unread. Inbox zero.</div>
      )}
    </div>
  );
}

// ---------- Search Console ----------

interface Search {
  sites: string[];
  site: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  days: { date: string; clicks: number; impressions: number }[];
  change: number | null;
  through: string | null;
}
const siteName = (s: string) => s.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");

function SearchTile() {
  const r = useTopic<Search | Need>("searchConsole");
  if (!r || isNeed(r)) return <TileNote spec={GSC} v={r} name="Search Console" />;
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <Mark spec={GSC} />
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{compact(r.clicks)}</span>
        <span className="mt-1 text-[10px]" style={muted}>clicks · 28 days</span>
      </div>
      {r.days.length > 1 && <Sparkline values={r.days.map((d) => d.clicks)} width={44} height={24} color={GSC.color} />}
    </div>
  );
}

function SearchCard(_: CardProps) {
  const s = useSettings();
  const r = useTopic<Search | Need>("searchConsole");
  const stat = (label: string, value: string) => (
    <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
      <div className="text-[11px] font-semibold" style={muted}>{label}</div>
      <div className="tabular mt-0.5 text-[19px] font-semibold leading-tight">{value}</div>
    </div>
  );
  return (
    <div>
      <CardHeader
        title={<span className="flex items-center gap-2"><Mark spec={GSC} size={22} /> Search Console</span>}
        sub={r && !isNeed(r) ? siteName(r.site) : "Google search, last 28 days"}
        right={
          <button title="Open Search Console" onClick={() => open(r && !isNeed(r) ? `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(r.site)}` : "https://search.google.com/search-console")} className="grid h-7 w-7 place-items-center rounded-full" style={{ background: "var(--chip)" }}>
            <ExternalLink size={12} />
          </button>
        }
      />
      {!r ? (
        <div className="py-6 text-center text-[12px]" style={muted}>Loading...</div>
      ) : isNeed(r) ? (
        <Connect need={r} extra="searchConsole" name="Search Console" />
      ) : (
        <>
          {r.sites.length > 1 && (
            <div className="thin-scroll mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
              {r.sites.map((x) => (
                <Chip key={x} active={x === r.site} onClick={() => setSettings({ google: { ...s.google, searchSite: x } })} className="shrink-0">
                  {siteName(x)}
                </Chip>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {stat("Clicks", r.clicks.toLocaleString())}
            {stat("Impressions", compact(r.impressions))}
            {stat("Click rate", `${r.ctr.toFixed(1)}%`)}
            {stat("Average position", r.position ? r.position.toFixed(1) : "-")}
          </div>
          {r.days.length > 1 && (
            <div className="mt-3 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold" style={muted}>
                <span>Clicks a day</span>
                {r.change != null && (
                  <span className="tabular flex items-center gap-0.5" style={{ color: r.change >= 0 ? "#30d158" : "#ff453a" }}>
                    {r.change >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {r.change >= 0 ? "+" : ""}
                    {r.change.toFixed(0)}% this week
                  </span>
                )}
              </div>
              <Sparkline values={r.days.map((d) => d.clicks)} width={306} height={60} color={GSC.color} strokeWidth={2} />
            </div>
          )}
          <div className="mt-2 text-center text-[10.5px]" style={{ color: "var(--fg3)" }}>
            {r.through ? `Through ${new Date(r.through + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })}: Google's numbers trail by two or three days` : "No search data for this site yet"}
          </div>
        </>
      )}
    </div>
  );
}

export const googleWidgets: WidgetDef[] = [
  { type: "gmail", name: "Gmail", category: "Online & Mail", description: "Unread mail in your inbox: who it's from and the subject. Uses your Google sign-in.", Tile: GmailTile, Card: GmailCard, cardWidth: 370 },
  { type: "searchConsole", name: "Search Console", category: "Analytics", description: "Your site's Google search clicks, impressions and position over 28 days.", Tile: SearchTile, Card: SearchCard, cardWidth: 360 },
];
