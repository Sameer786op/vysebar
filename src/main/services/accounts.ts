// Widgets that read an account with your own key (revenue, analytics, social, Linear,
// DeepSeek, LeetCode), plus a few more feeds: ChatGPT's Codex limits from its local logs,
// the wallpaper gallery, temperature and the extra Quick Toggles switches.
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, ipcMain, net } from "electron";
import { PROVIDERS, REVENUE_PROVIDERS, type ProviderData, type RevenueData } from "@shared/accounts";
import { host } from "../host";
import { settings } from "../store";
import { defineTopic, poller, refreshTopic } from "../topics";
import { getJson, stripe } from "./online";

type Keys = Record<string, string>;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await net.fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "VyseBar", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

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
  return spec.fields.every((f) => k[f.key]?.trim()) ? k : null;
};

async function read(id: string, fresh = false): Promise<ProviderData | { error: string; connect?: boolean }> {
  const k = keysOf(id);
  if (!k) return { error: "Not connected", connect: true };
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  let value: ProviderData | { error: string };
  try {
    value = await fetchers[id](k);
  } catch (e) {
    const msg = (e as Error).message;
    value = { error: /^40[13]/.test(msg) ? "The key was refused - check it in the card" : `Couldn't reach ${PROVIDERS.find((p) => p.id === id)?.name ?? "Stripe"}: ${msg}` };
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

function codexUsage() {
  const root = join(homedir(), ".codex", "sessions");
  if (!existsSync(root)) return { error: "Codex isn't on this PC" };
  // the newest session file: sessions/YYYY/MM/DD/rollout-*.jsonl
  let newest: { file: string; mtime: number } | null = null;
  const walk = (dir: string, depth: number) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (name.endsWith(".jsonl") && (!newest || st.mtimeMs > newest.mtime)) newest = { file: p, mtime: st.mtimeMs };
    }
  };
  walk(root, 0);
  if (!newest) return { error: "No Codex sessions yet" };
  const { file, mtime } = newest as { file: string; mtime: number };
  // the limits ride along with token counts near the end of the file
  const size = statSync(file).size;
  const len = Math.min(size, 512 * 1024);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  readSync(fd, buf, 0, len, size - len);
  closeSync(fd);
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
      return { session: win(rl.primary), week: win(rl.secondary), plan: typeof rl.plan_type === "string" ? rl.plan_type : null, at: mtime };
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

async function setWallpaper(url: string, id: string) {
  if (!/^https:\/\/www\.bing\.com\//.test(url)) throw new Error("not a gallery picture");
  const dir = join(app.getPath("userData"), "wallpapers");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id.replace(/[^\w-]/g, "").slice(0, 40) || "wallpaper"}.jpg`);
  if (!existsSync(file)) {
    const res = await net.fetch(url);
    if (!res.ok || !res.body) throw new Error(`${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file));
  }
  return host.call("setWallpaper", { path: file });
}

export function initAccountTopics(): void {
  for (const p of PROVIDERS) defineTopic(`acct:${p.id}`, poller(() => read(p.id), 15 * 60_000));
  defineTopic("revenueTotal", poller(totalRevenue, 15 * 60_000));
  defineTopic("codex", poller(codexUsage, 60_000));
  defineTopic("wallpapers", poller(wallpapers, 6 * 3600_000));
  defineTopic("temperature", poller(() => host.try("temperature"), 5000));
  defineTopic(
    "switches",
    poller(async () => {
      const [keepAwake, mic, desktopIcons] = await Promise.all([host.try<boolean>("keepAwake"), host.try<{ muted: boolean } | null>("mic"), host.try<boolean | null>("desktopIcons")]);
      return { keepAwake: !!keepAwake, mic: mic ? !mic.muted : null, desktopIcons };
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
