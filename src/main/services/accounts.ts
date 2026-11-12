// Widgets that read an account with your own key (revenue, analytics, social, Linear,
// DeepSeek, LeetCode), plus a few more feeds: ChatGPT's Codex limits from its local logs,
// the wallpaper gallery, temperature and the extra Quick Toggles switches.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, ipcMain } from "electron";
import { PROVIDERS, REVENUE_PROVIDERS, isConnected, type ProviderData, type RevenueData, type UsageData, type UsageWindow } from "@shared/accounts";
import { host } from "../host";
import { settings } from "../store";
import { defineTopic, isRefusal, passing, poller, refreshTopic } from "../topics";
import { getJson, request, stripe } from "./online";
import { initLocalAiTopics } from "./localai";
import { writeFileAtomicSoon } from "../files";

type Keys = Record<string, string>;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await request(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "VyseBar", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** a date on this PC's calendar, not UTC's */
const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => localDay(Date.now() - (n - 1 - i) * 86400_000));
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Node's own fetch: Chromium's drops a Cookie header set by hand */
async function cookieJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await request(url, { headers: { "User-Agent": "VyseBar", Accept: "application/json", ...headers } }, 20_000, true);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** an amount in cents, wherever the service put it: { val: "1234" }, "1234" or 1234 */
function centsIn(o: any, keys: string[]): number | undefined {
  const seen = new Set<unknown>();
  const queue = [o];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    for (const k of keys) {
      const v = cur[k];
      const raw = v && typeof v === "object" ? (v.val ?? v.value ?? v.amount) : v;
      if (raw != null && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
    }
    for (const v of Object.values(cur)) if (v && typeof v === "object") queue.push(v);
  }
  return undefined;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1).replace(/_/g, " ") : t);

/** 30 days of amounts by day, as the revenue widgets show them */
function revenueOf(entries: { t: number; amount: number }[], currency: string): RevenueData {
  const daily = new Map<string, number>();
  const since = Date.now() - 30 * 86400_000;
  let total = 0;
  for (const e of entries) {
    if (e.t < since) continue;
    daily.set(day(e.t), (daily.get(day(e.t)) ?? 0) + e.amount);
    total += e.amount;
  }
  const days: RevenueData["days"] = [];
  for (let i = 13; i >= 0; i--) {
    const d = day(Date.now() - i * 86400_000);
    days.push({ date: d, value: daily.get(d) ?? 0 });
  }
  const week = days.slice(-7).reduce((s, d) => s + d.value, 0);
  const prev = days.slice(0, 7).reduce((s, d) => s + d.value, 0);
  return { kind: "revenue", currency: currency.toUpperCase(), total, days, week, change: prev ? ((week - prev) / prev) * 100 : 0 };
}

// ---------- the services ----------

const fetchers: Record<string, (k: Keys) => Promise<ProviderData>> = {
  async stripe() {
    const r: any = await stripe();
    if (r.error) throw new Error(r.error);
    return { kind: "revenue", ...r };
  },

  async polar(k) {
    // amounts are in cents
    const r = await getJson<any>(`https://api.polar.sh/v1/metrics/?start_date=${day(Date.now() - 30 * 86400_000)}&end_date=${day(Date.now())}&interval=day`, { headers: { Authorization: `Bearer ${k.token}` } });
    return revenueOf((r.periods ?? []).map((p: any) => ({ t: Date.parse(p.timestamp), amount: (p.revenue ?? 0) / 100 })), "usd");
  },

  async lemonsqueezy(k) {
    const since = Date.now() - 30 * 86400_000;
    const out: { t: number; amount: number }[] = [];
    let currency = "usd";
    let url: string | null = "https://api.lemonsqueezy.com/v1/orders?page[size]=100&sort=-created_at";
    for (let page = 0; url && page < 10; page++) {
      const r: any = await getJson(url, { headers: { Authorization: `Bearer ${k.key}`, Accept: "application/vnd.api+json" } });
      let older = false;
      for (const o of r.data ?? []) {
        const a = o.attributes;
        const t = Date.parse(a.created_at);
        if (t < since) older = true;
        if (a.status !== "paid" && a.status !== "partial_refund" && a.status !== "refunded") continue;
        // after tax and refunds
        out.push({ t, amount: (a.total - (a.tax ?? 0) - (a.refunded_amount ?? 0)) / 100 });
        currency = a.currency ?? currency;
      }
      url = older ? null : r.links?.next ?? null;
    }
    return revenueOf(out, currency);
  },

  async paddle(k) {
    const out: { t: number; amount: number }[] = [];
    let currency = "usd";
    let url: string | null = `https://api.paddle.com/transactions?status=completed&created_at[GTE]=${encodeURIComponent(isoDaysAgo(30))}&per_page=200`;
    for (let page = 0; url && page < 10; page++) {
      const r: any = await getJson(url, { headers: { Authorization: `Bearer ${k.key}` } });
      for (const t of r.data ?? []) {
        const totals = t.details?.totals;
        if (!totals) continue;
        // earnings: what is left after Paddle's fee, in the currency's smallest unit
        out.push({ t: Date.parse(t.billed_at ?? t.created_at), amount: Number(totals.earnings ?? totals.grand_total ?? 0) / 100 });
        currency = totals.currency_code ?? currency;
      }
      url = r.meta?.pagination?.has_more ? r.meta.pagination.next : null;
    }
    return revenueOf(out, currency);
  },

  async gumroad(k) {
    const out: { t: number; amount: number }[] = [];
    let pageKey = "";
    for (let page = 0; page < 10; page++) {
      const r: any = await getJson(`https://api.gumroad.com/v2/sales?access_token=${encodeURIComponent(k.token)}&after=${day(Date.now() - 30 * 86400_000)}${pageKey ? `&page_key=${pageKey}` : ""}`);
      for (const s of r.sales ?? []) {
        if (s.refunded) continue;
        // what you kept: the price less Gumroad's fee, both in cents
        out.push({ t: Date.parse(s.created_at), amount: ((s.price ?? 0) - (s.gumroad_fee ?? 0)) / 100 });
      }
      if (!r.next_page_key) break;
      pageKey = r.next_page_key;
    }
    return revenueOf(out, "usd");
  },

  async shopify(k) {
    const shop = k.shop.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const r: any = await getJson(
      `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(isoDaysAgo(30))}&fields=created_at,current_total_price,currency,cancelled_at`,
      { headers: { "X-Shopify-Access-Token": k.token } },
    );
    const orders = (r.orders ?? []).filter((o: any) => !o.cancelled_at);
    return revenueOf(orders.map((o: any) => ({ t: Date.parse(o.created_at), amount: Number(o.current_total_price ?? 0) })), orders[0]?.currency ?? "usd");
  },

  async dodo(k) {
    const out: { t: number; amount: number }[] = [];
    let currency = "usd";
    for (let page = 0; page < 10; page++) {
      const r: any = await getJson(`https://live.dodopayments.com/payments?page_size=100&page_number=${page}&created_at_gte=${encodeURIComponent(isoDaysAgo(30))}`, { headers: { Authorization: `Bearer ${k.key}` } });
      const items = r.items ?? [];
      for (const p of items) {
        if (p.status !== "succeeded") continue;
        out.push({ t: Date.parse(p.created_at), amount: (p.total_amount ?? 0) / 100 });
        currency = p.currency ?? currency;
      }
      if (items.length < 100) break;
    }
    return revenueOf(out, currency);
  },

  async plausible(k) {
    const r = await postJson<any>(
      "https://plausible.io/api/v2/query",
      { site_id: k.site, metrics: ["visitors"], date_range: [day(Date.now() - 13 * 86400_000), day(Date.now())], dimensions: ["time:day"] },
      { Authorization: `Bearer ${k.key}` },
    );
    const byDay = new Map<string, number>((r.results ?? []).map((x: any) => [x.dimensions[0], x.metrics[0]]));
    const series = Array.from({ length: 14 }, (_, i) => byDay.get(day(Date.now() - (13 - i) * 86400_000)) ?? 0);
    return weekCount(series);
  },

  async dub(k) {
    const r = await getJson<any[]>("https://api.dub.co/analytics?event=clicks&groupBy=timeseries&interval=30d", { headers: { Authorization: `Bearer ${k.key}` } });
    const series = (r ?? []).map((x) => x.clicks ?? 0).slice(-14);
    while (series.length < 14) series.unshift(0);
    return weekCount(series);
  },

  async resend(k) {
    const r = await getJson<any>("https://api.resend.com/emails?limit=100", { headers: { Authorization: `Bearer ${k.key}` } });
    const since = Date.now() - 7 * 86400_000;
    const week = (r.data ?? []).filter((e: any) => Date.parse(e.created_at) >= since);
    const delivered = week.filter((e: any) => e.last_event === "delivered" || e.last_event === "opened" || e.last_event === "clicked").length;
    return { kind: "count", value: week.length, label: `${delivered} delivered` };
  },

  async linear(k) {
    const q = `query { viewer { assignedIssues(first: 25, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { identifier title url state { name type } } } } }`;
    const r = await postJson<any>("https://api.linear.app/graphql", { query: q }, { Authorization: k.key });
    if (r.errors?.length) throw new Error(r.errors[0].message);
    const nodes = r.data?.viewer?.assignedIssues?.nodes ?? [];
    return { kind: "issues", issues: nodes.map((n: any) => ({ id: n.identifier, title: n.title, state: n.state?.name ?? "", type: n.state?.type ?? "", url: n.url })) };
  },

  async youtube(k) {
    const ch = k.channel.trim();
    const sel = ch.startsWith("UC") ? `id=${encodeURIComponent(ch)}` : `forHandle=${encodeURIComponent(ch.startsWith("@") ? ch : `@${ch}`)}`;
    const r = await getJson<any>(`https://www.googleapis.com/youtube/v3/channels?part=statistics&${sel}&key=${encodeURIComponent(k.key)}`);
    const st = r.items?.[0]?.statistics;
    if (!st) throw new Error("No channel with that name");
    return { kind: "count", value: Number(st.subscriberCount ?? 0), label: `${Number(st.viewCount ?? 0).toLocaleString()} views` };
  },

  async instagram(k) {
    const r = await getJson<any>(`https://graph.instagram.com/me?fields=username,followers_count,media_count&access_token=${encodeURIComponent(k.token)}`);
    return { kind: "count", value: r.followers_count ?? 0, label: r.username ? `@${r.username}` : undefined };
  },

  async x(k) {
    const r = await getJson<any>(`https://api.x.com/2/users/by/username/${encodeURIComponent(k.user.replace(/^@/, ""))}?user.fields=public_metrics`, { headers: { Authorization: `Bearer ${k.token}` } });
    const m = r.data?.public_metrics;
    if (!m) throw new Error(r.errors?.[0]?.detail ?? "No such account");
    return { kind: "count", value: m.followers_count ?? 0, label: `@${r.data.username}` };
  },

  async tiktok(k) {
    const r = await getJson<any>("https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count", { headers: { Authorization: `Bearer ${k.token}` } });
    const u = r.data?.user;
    if (!u) throw new Error(r.error?.message ?? "Couldn't read the profile");
    return { kind: "count", value: u.follower_count ?? 0, label: u.display_name };
  },

  async datafast(k) {
    const h = { headers: { Authorization: `Bearer ${k.key}` } };
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const ago = (n: number) => localDay(Date.now() - n * 86400_000);
    const overview = async (from: number, to: number) => {
      const r = await getJson<any>(`https://datafa.st/api/v1/analytics/overview?startAt=${ago(from)}&endAt=${ago(to)}&timezone=${tz}`, h);
      if (r.status && r.status !== "success") throw new Error(r.error?.message ?? r.message ?? "DataFast refused the request");
      return (Array.isArray(r.data) ? r.data[0] : r.data) ?? {};
    };
    const [week, prev] = await Promise.all([overview(6, 0), overview(13, 7)]);
    // visitors day by day, when the timeseries answers
    let series: number[] | undefined;
    try {
      const t = await getJson<any>(`https://datafa.st/api/v1/analytics/timeseries?startAt=${ago(13)}&endAt=${ago(0)}&interval=day&timezone=${tz}`, h);
      const rows: any[] = Array.isArray(t.data) ? t.data : (t.data?.timeseries ?? []);
      if (rows.length > 1) series = rows.map((x) => num(x.visitors));
    } catch {
      /* the totals are enough */
    }
    const value = num(week.visitors);
    const before = num(prev.visitors);
    const revenue = num(week.revenue);
    const label =
      revenue > 0
        ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: week.currency || "USD", maximumFractionDigits: 0 }).format(revenue)} revenue`
        : week.pageviews != null
          ? `${num(week.pageviews).toLocaleString()} page views`
          : undefined;
    return { kind: "count", value, series, change: before ? ((value - before) / before) * 100 : undefined, label };
  },

  async supabase(k) {
    const h = { headers: { Authorization: `Bearer ${k.token}` } };
    let ref = k.project?.trim();
    let name: string | undefined;
    if (!ref) {
      const projects = await getJson<any[]>("https://api.supabase.com/v1/projects", h);
      if (!projects.length) throw new Error("No projects on this account");
      ref = projects[0].id ?? projects[0].ref;
      name = projects[0].name;
    }
    const r = await getJson<any>(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref!)}/analytics/endpoints/usage.api-counts?interval=7day`, h);
    if (r?.error) throw new Error(typeof r.error === "string" ? r.error : (r.error.message ?? "Supabase refused the request"));
    const rows: any[] = Array.isArray(r) ? r : (r?.result ?? []);
    const days = lastDays(7);
    const byDay = new Map(days.map((d) => [d, 0]));
    // timestamps come in microseconds, milliseconds or as text
    const when = (ts: unknown) => {
      const n = Number(ts);
      if (!Number.isFinite(n)) return Date.parse(String(ts));
      return n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000;
    };
    for (const x of rows) {
      const d = localDay(when(x.timestamp));
      if (!byDay.has(d)) continue;
      const total = num(x.total_rest_requests) + num(x.total_auth_requests) + num(x.total_storage_requests) + num(x.total_realtime_requests);
      byDay.set(d, byDay.get(d)! + total);
    }
    const series = days.map((d) => byDay.get(d)!);
    return { kind: "count", value: series.reduce((a, b) => a + b, 0), series, label: name ?? ref };
  },

  async grok(k) {
    const h = { headers: { Authorization: `Bearer ${k.key}` } };
    const team = encodeURIComponent(k.team.trim());
    const r = await getJson<any>(`https://management-api.x.ai/v1/billing/teams/${team}/prepaid/balance`, h);
    // prepaid credit is kept in cents, and xAI may write credit as a negative amount
    const cents = centsIn(r, ["total", "balance", "amount"]) ?? 0;
    let spent: number | undefined;
    try {
      const inv = await getJson<any>(`https://management-api.x.ai/v1/billing/teams/${team}/postpaid/invoice/preview`, h);
      const c = centsIn(inv, ["totalWithCorr", "amountAfterVat", "total", "amount"]);
      if (c != null) spent = Math.abs(c) / 100;
    } catch {
      /* prepaid only */
    }
    const balance = Math.abs(cents) / 100;
    return { kind: "balance", balance, currency: "USD", available: balance > 0, spent };
  },

  async glm(k) {
    const base = k.region === "china" ? "https://bigmodel.cn" : "https://api.z.ai";
    // z.ai wants the bare key here, without "Bearer"
    const r = await getJson<any>(`${base}/api/monitor/usage/quota/limit`, { headers: { Authorization: k.key, "Accept-Language": "en-US,en" } });
    if (r.success === false || (r.code != null && r.code !== 200 && r.code !== 0)) throw new Error(r.code === 401 || r.code === 1000 ? "401 refused" : r.msg || "z.ai didn't send the limits");
    const limits: any[] = r.data?.limits ?? [];
    const pctOf = (l: any) => (l.percentage != null ? num(l.percentage) : num(l.usage) ? (num(l.currentValue) / num(l.usage)) * 100 : 0);
    const windows: UsageWindow[] = [];
    for (const l of limits.filter((x) => x.type === "TOKENS_LIMIT")) windows.push({ label: "5-hour tokens", used: pctOf(l), resetsAt: l.nextResetTime ? num(l.nextResetTime) : null });
    for (const l of limits.filter((x) => x.type === "TIME_LIMIT"))
      windows.push({
        label: "Tool calls this month",
        used: pctOf(l),
        resetsAt: l.nextResetTime ? num(l.nextResetTime) : null,
        detail: l.usage ? `${num(l.currentValue).toLocaleString()} of ${num(l.usage).toLocaleString()}` : undefined,
      });
    if (!windows.length) throw new Error("No coding plan on this key");
    const plan = typeof r.data?.level === "string" ? `${cap(r.data.level)} plan` : undefined;
    return { kind: "usage", plan, windows };
  },

  async cursor(k) {
    const token = k.token.trim().replace(/^WorkosCursorSessionToken=/, "");
    const r = await cookieJson<any>("https://cursor.com/api/usage-summary", { Cookie: `WorkosCursorSessionToken=${token}`, Origin: "https://cursor.com", Referer: "https://cursor.com/dashboard" });
    const end = r.billingCycleEnd ? Date.parse(r.billingCycleEnd) : null;
    const plan = r.individualUsage?.plan;
    const windows: UsageWindow[] = [];
    if (plan) {
      windows.push({ label: "Included usage", used: num(plan.totalPercentUsed), resetsAt: end });
      windows.push({ label: "Auto", used: num(plan.autoPercentUsed), resetsAt: end });
      windows.push({ label: "Other models", used: num(plan.apiPercentUsed), resetsAt: end });
    }
    const notes: { label: string; value: string }[] = [];
    // on-demand spend is in cents
    const od = r.individualUsage?.onDemand?.enabled ? r.individualUsage.onDemand : r.teamUsage?.onDemand?.enabled ? r.teamUsage.onDemand : null;
    if (od) notes.push({ label: "On-demand", value: num(od.limit) > 0 ? `${usd(Math.max(0, num(od.used)))} of ${usd(num(od.limit))}` : usd(Math.max(0, num(od.used))) });
    const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (r.billingCycleStart && end) notes.push({ label: "Billing period", value: `${fmt(Date.parse(r.billingCycleStart))} to ${fmt(end)}` });
    if (!windows.length && !od) throw new Error("Cursor sent no usage: copy the cookie again");
    const membership = typeof r.membershipType === "string" ? cap(r.membershipType) : undefined;
    return { kind: "usage", plan: membership ? `${membership}${r.isUnlimited ? " · unlimited" : ""}` : undefined, windows, notes };
  },

  async deepseek(k) {
    const r = await getJson<any>("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${k.key}` } });
    const b = r.balance_infos?.[0];
    return { kind: "balance", balance: Number(b?.total_balance ?? 0), currency: b?.currency ?? "USD", available: !!r.is_available };
  },

  async leetcode(k) {
    const q = `query($u: String!) { matchedUser(username: $u) { profile { ranking } submitStatsGlobal { acSubmissionNum { difficulty count } } userCalendar { streak } } }`;
    const r = await postJson<any>("https://leetcode.com/graphql", { query: q, variables: { u: k.user.trim() } }, { Referer: "https://leetcode.com" });
    const u = r.data?.matchedUser;
    if (!u) throw new Error("No LeetCode user with that name");
    const n = (d: string) => u.submitStatsGlobal.acSubmissionNum.find((x: any) => x.difficulty === d)?.count ?? 0;
    return { kind: "leetcode", solved: n("All"), easy: n("Easy"), medium: n("Medium"), hard: n("Hard"), streak: u.userCalendar?.streak ?? 0, ranking: u.profile?.ranking ?? null };
  },
};

function weekCount(series: number[]): ProviderData {
  const week = series.slice(-7).reduce((s, v) => s + v, 0);
  const prev = series.slice(0, 7).reduce((s, v) => s + v, 0);
  return { kind: "count", value: week, series, change: prev ? ((week - prev) / prev) * 100 : 0 };
}

// the total and each service's own widget share one reading for ten minutes
const cache = new Map<string, { at: number; value: ProviderData | { error: string } }>();
const keysOf = (id: string): Keys | null => {
  // Stripe keeps its key where it always has, on the Accounts page
  if (id === "stripe") return settings.value.accounts.stripeKey ? { key: settings.value.accounts.stripeKey } : null;
  const spec = PROVIDERS.find((p) => p.id === id);
  if (!spec) return null;
  const k = settings.value.providers[id] ?? {};
  return isConnected(spec, k) ? k : null;
};

// AI plans: the first window's share over the last day, for the card's chart (kept across restarts)
const historyFile = join(app.getPath("userData"), "usage-history.json");
let history: Record<string, { t: number; used: number }[]> = {};
try {
  history = JSON.parse(readFileSync(historyFile, "utf8"));
} catch {
  history = {};
}
export function remember(id: string, used: number): { t: number; used: number }[] {
  const now = Date.now();
  const list = (history[id] ?? []).filter((p) => now - p.t < 24 * 3600_000);
  const last = list[list.length - 1];
  const v = Math.round(used * 10) / 10;
  // a point when it changes, and one every few minutes otherwise
  if (last && last.used === v && now - last.t <= 4 * 60_000) return history[id] ?? list;
  list.push({ t: now, used: v });
  history[id] = list.slice(-400);
  // written whole, one at a time: two overlapping writes could leave the file half each
  writeFileAtomicSoon(historyFile, JSON.stringify(history));
  return history[id];
}

const isUsage = (id: string) => PROVIDERS.find((p) => p.id === id)?.kind === "usage";

async function read(id: string, fresh = false): Promise<ProviderData | { error: string; connect?: boolean }> {
  const k = keysOf(id);
  if (!k) return { error: "Not connected", connect: true };
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < (isUsage(id) ? 4 : 10) * 60_000) return hit.value;
  let value: ProviderData | { error: string };
  try {
    value = await fetchers[id](k);
    if (value.kind === "usage" && value.windows[0]) value = { ...value, history: remember(id, value.windows[0].used) } satisfies UsageData;
  } catch (e) {
    const msg = (e as Error).message;
    const reach = { error: `Couldn't reach ${PROVIDERS.find((p) => p.id === id)?.name ?? "Stripe"}: ${msg}` };
    if (/^40[13]\b/.test(msg)) value = { error: "The key was refused - check it in the card" };
    else if (isRefusal(msg)) value = reach;
    // no connection or a timeout: what was read before stays on show, and is asked for again soon
    else throw passing(msg, reach);
  }
  cache.set(id, { at: Date.now(), value });
  return value;
}

async function totalRevenue() {
  const parts: { id: string; name: string; total: number; currency: string; days: RevenueData["days"] }[] = [];
  for (const p of [{ id: "stripe", name: "Stripe" }, ...REVENUE_PROVIDERS]) {
    if (!keysOf(p.id)) continue;
    const r = await read(p.id);
    if ("kind" in r && r.kind === "revenue") parts.push({ id: p.id, name: p.name, total: r.total, currency: r.currency, days: r.days });
  }
  if (!parts.length) return { error: "Connect a store to add up its revenue", connect: true };
  // amounts in other currencies than the first store's are listed but not added
  const currency = parts[0].currency;
  const same = parts.filter((p) => p.currency === currency);
  const days = same[0].days.map((d, i) => ({ date: d.date, value: same.reduce((s, p) => s + (p.days[i]?.value ?? 0), 0) }));
  return { currency, total: same.reduce((s, p) => s + p.total, 0), days, parts };
}

// ---------- ChatGPT: Codex's 5-hour and weekly limits, from its own session logs ----------

async function codexUsage() {
  const root = join(homedir(), ".codex", "sessions");
  if (!existsSync(root)) return { error: "Codex isn't on this PC" };
  // sessions/YYYY/MM/DD/rollout-*.jsonl: only the newest few days are looked at, so a long
  // history isn't walked file by file every minute (and nothing here holds up the dock)
  const newest = async (dir: string, n: number) =>
    (await readdir(dir).catch(() => [] as string[]))
      .filter((d) => /^\d+$/.test(d))
      .sort()
      .reverse()
      .slice(0, n)
      .map((d) => join(dir, d));
  const dirs = [root];
  for (const y of await newest(root, 2)) {
    for (const m of await newest(y, 2)) {
      for (const d of await newest(m, 3)) if (dirs.length < 4) dirs.push(d);
    }
  }
  let latest: { file: string; mtime: number } | null = null;
  for (const dir of dirs) {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith(".jsonl")) continue;
      const p = join(dir, name);
      const st = await stat(p).catch(() => null);
      if (st && (!latest || st.mtimeMs > latest.mtime)) latest = { file: p, mtime: st.mtimeMs };
    }
  }
  if (!latest) return { error: "No Codex sessions yet" };
  const { file, mtime } = latest as { file: string; mtime: number };
  // the limits ride along with token counts near the end of the file
  const fh = await open(file, "r");
  let buf: Buffer;
  try {
    const size = (await fh.stat()).size;
    const len = Math.min(size, 512 * 1024);
    buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
  } finally {
    await fh.close();
  }
  const lines = buf.toString("utf8").split("\n").reverse();
  for (const line of lines) {
    if (!line.includes("rate_limits")) continue;
    try {
      const e = JSON.parse(line);
      const rl = e.payload?.rate_limits ?? e.rate_limits;
      if (!rl) continue;
      const win = (w: any) =>
        w && {
          used: Math.round(w.used_percent ?? 0),
          minutes: w.window_minutes ?? null,
          resetsAt: w.resets_at ? w.resets_at * 1000 : w.resets_in_seconds != null ? mtime + w.resets_in_seconds * 1000 : null,
        };
      const session = win(rl.primary);
      return { session, week: win(rl.secondary), plan: typeof rl.plan_type === "string" ? rl.plan_type : null, at: mtime, history: session ? remember("codex", session.used) : [] };
    } catch {
      /* a partial line */
    }
  }
  return { error: "Codex hasn't reported its limits yet" };
}

// ---------- wallpaper gallery: Bing's pictures of the day, no key needed ----------

async function wallpapers() {
  const r = await getJson<any>("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=en-US");
  return (r.images ?? []).map((i: any) => ({
    id: i.hsh ?? i.urlbase,
    title: i.title ?? "",
    credit: i.copyright ?? "",
    thumb: `https://www.bing.com${i.urlbase}_400x240.jpg`,
    full: `https://www.bing.com${i.urlbase}_UHD.jpg`,
  }));
}

/** a picture an earlier version saved half-way (it wrote straight to the final name) is fetched again */
function isWholeJpeg(file: string): boolean {
  try {
    const b = readFileSync(file);
    return b.length > 1024 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  } catch {
    return false;
  }
}

async function setWallpaper(url: string, id: string) {
  if (!/^https:\/\/www\.bing\.com\//.test(url)) throw new Error("not a gallery picture");
  const dir = join(app.getPath("userData"), "wallpapers");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id.replace(/[^\w-]/g, "").slice(0, 40) || "wallpaper"}.jpg`);
  if (!isWholeJpeg(file)) {
    // downloaded beside its real name and renamed once whole: a download cut short (the PC
    // going to sleep, the network dropping) never becomes a broken wallpaper
    const part = `${file}.part`;
    try {
      const res = await request(url, {}, 300_000);
      if (!res.ok || !res.body) throw new Error(`${res.status}`);
      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(part));
      renameSync(part, file);
    } catch (e) {
      rmSync(part, { force: true });
      throw e;
    }
  }
  return host.call("setWallpaper", { path: file });
}

// a new wallpaper on its own: once a day (the first check on a new day) or once a week
const dayOf = (t: number) => new Date(t).toDateString();
async function rotateWallpaper(force = false): Promise<void> {
  const r = settings.value.wallpaperRotate;
  if (r.every === "off") return;
  const now = Date.now();
  const due = force || !r.last || (r.every === "day" ? dayOf(now) !== dayOf(r.last) : now - r.last >= 7 * 86400_000 - 3600_000);
  if (!due) return;
  const list = (await wallpapers()) as { id: string; full: string }[];
  if (!list.length) return;
  const others = list.filter((p) => p.id !== r.current);
  const pick = r.pick === "shuffle" ? (others.length ? others : list)[Math.floor(Math.random() * (others.length || list.length))] : list[0];
  // today's picture is already up: nothing to change, but the day still counts as done
  if (pick.id !== r.current) await setWallpaper(pick.full, pick.id);
  settings.set({ wallpaperRotate: { ...settings.value.wallpaperRotate, last: now, current: pick.id } });
}

export function initAccountTopics(): void {
  // checked a minute after start (the network is up by then) and then every half hour
  const tryRotate = (force = false) => void rotateWallpaper(force).catch((e) => console.error("wallpaper rotation:", (e as Error).message));
  setTimeout(tryRotate, 60_000);
  setInterval(tryRotate, 30 * 60_000);
  settings.onChange((v, prev) => {
    const a = v.wallpaperRotate;
    const b = prev.wallpaperRotate;
    // switched on, or how often / which picture changed: the first new one comes now
    if (a.every !== "off" && (a.every !== b.every || a.pick !== b.pick)) tryRotate(true);
  });
  ipcMain.handle("wallpaper:next", () => rotateWallpaper(true));

  // plan limits move faster than revenue
  for (const p of PROVIDERS) defineTopic(`acct:${p.id}`, poller(() => read(p.id), (p.kind === "usage" ? 5 : 15) * 60_000));
  defineTopic("revenueTotal", poller(totalRevenue, 15 * 60_000));
  defineTopic("codex", poller(codexUsage, 60_000));
  initLocalAiTopics();
  defineTopic("wallpapers", poller(wallpapers, 3600_000));
  defineTopic("temperature", poller(() => host.try("temperature"), 5000));
  defineTopic(
    "switches",
    poller(async () => {
      const [keepAwake, mic, desktopIcons, energy, dnd, camera, hotspot, ethernet] = await Promise.all([
        host.try<boolean>("keepAwake"),
        host.try<{ muted: boolean } | null>("mic"),
        host.try<boolean | null>("desktopIcons"),
        host.try<{ on: boolean; available: boolean; always: boolean } | null>("energySaver"),
        host.try<boolean | null>("dnd"),
        host.try<boolean | null>("camera"),
        host.try<{ on: boolean; clients: number; name?: string } | null>("hotspot"),
        host.try<boolean | null>("ethernet"),
      ]);
      return { keepAwake: !!keepAwake, mic: mic ? !mic.muted : null, desktopIcons, energy, dnd, camera, hotspot, ethernet };
    }, 5000),
  );

  ipcMain.handle("wallpaper:set", (_e, url: string, id: string) => setWallpaper(url, id));
  ipcMain.handle("account:refresh", async (_e, id: string) => {
    cache.delete(id);
    refreshTopic(`acct:${id}`);
    refreshTopic("revenueTotal");
  });
  // new keys: read again right away
  settings.onChange((v, prev) => {
    if (v.accounts.stripeKey !== prev.accounts.stripeKey) {
      cache.delete("stripe");
      refreshTopic("revenueTotal");
    }
    if (v.providers === prev.providers) return;
    for (const p of PROVIDERS) {
      if (JSON.stringify(v.providers[p.id] ?? {}) === JSON.stringify(prev.providers[p.id] ?? {})) continue;
      cache.delete(p.id);
      refreshTopic(`acct:${p.id}`);
      if (p.kind === "revenue") refreshTopic("revenueTotal");
    }
  });
}
