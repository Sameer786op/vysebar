// Feeds from the internet: weather, currency, crypto, stocks, GitHub, calendars (ICS).
// Each talks straight to its own service; nothing passes through anyone else.
import { net } from "electron";
import { host } from "../host";
import { settings } from "../store";
import { defineTopic, poller, refreshTopic } from "../topics";
import type { CalEvent, City } from "@shared/types";

export async function getJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await net.fetch(url, { ...init, headers: { "User-Agent": "VyseBar", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function getText(url: string): Promise<string> {
  const res = await net.fetch(url, { headers: { "User-Agent": "VyseBar" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

// ---------- weather (Open-Meteo, no key) ----------

export async function searchCity(q: string) {
  const r = await getJson<{ results?: { name: string; country?: string; latitude: number; longitude: number; timezone?: string; admin1?: string }[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`,
  );
  return (r.results ?? []).map((c) => ({
    name: c.name,
    country: [c.admin1, c.country].filter(Boolean).join(", "),
    lat: c.latitude,
    lon: c.longitude,
    tz: c.timezone,
  }));
}

/** with no city chosen, the time zone's city is a fair guess that sends nothing anywhere */
async function defaultCity() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const guess = tz.split("/").pop()?.replace(/_/g, " ");
  const aliases: Record<string, string> = { Calcutta: "Kolkata", Saigon: "Ho Chi Minh City", Kiev: "Kyiv" };
  if (!guess) return null;
  const found = await searchCity(aliases[guess] ?? guess);
  return found[0] ?? null;
}

/**
 * The city this PC is in. Windows location when it's on (precise; the coordinates are rounded
 * to about a kilometre before they go anywhere), else the city of the internet connection's
 * IP address. BigDataCloud's free client lookup turns either into a place name.
 */
async function locate(): Promise<City | null> {
  const fix = await host.try<{ lat?: number; lon?: number }>("location", {}, 15_000);
  const round = (n: number) => Math.round(n * 100) / 100;
  const at = fix && typeof fix.lat === "number" && typeof fix.lon === "number" ? { lat: round(fix.lat), lon: round(fix.lon) } : null;
  const r = await getJson<{ city?: string; locality?: string; principalSubdivision?: string; countryName?: string; latitude?: number; longitude?: number }>(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?${at ? `latitude=${at.lat}&longitude=${at.lon}&` : ""}localityLanguage=en`,
  );
  const name = r.city || r.locality || r.principalSubdivision;
  const lat = at?.lat ?? r.latitude;
  const lon = at?.lon ?? r.longitude;
  if (!name || typeof lat !== "number" || typeof lon !== "number") return null;
  return {
    name,
    country: [r.principalSubdivision, r.countryName].filter((x) => x && x !== name).join(", "),
    lat,
    lon,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    from: at ? "windows" : "ip",
    at: Date.now(),
  };
}

let locating: Promise<City | null> | null = null;
async function weather() {
  let city = settings.value.city;
  // automatic: look again every three hours, so a laptop that travels gets the right weather
  if (settings.value.cityAuto && (!city || !city.at || city.from === "timezone" || Date.now() - city.at > 3 * 3600_000)) {
    locating ??= locate()
      .catch(() => null)
      .finally(() => (locating = null));
    const found = await locating;
    if (found) {
      city = found;
      if (found.lat !== settings.value.city?.lat || found.lon !== settings.value.city?.lon || found.name !== settings.value.city?.name) settings.set({ city: found });
      else settings.set({ city: { ...settings.value.city!, at: found.at } });
    }
  }
  if (!city) {
    city = await defaultCity();
    if (city) settings.set({ city: { ...city, from: "timezone", at: Date.now() } });
  }
  if (!city) return { error: "Pick a city in Settings" };
  const f = settings.value.units === "f";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation` +
    `&hourly=temperature_2m,weather_code,precipitation_probability,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max` +
    `&timezone=auto&forecast_days=7${f ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : ""}`;
  const w = await getJson<any>(url);
  const nowIdx = Math.max(0, (w.hourly.time as string[]).findIndex((t) => new Date(t).getTime() > Date.now()) - 1);
  return {
    city: city.name,
    units: f ? "f" : "c",
    utcOffset: w.utc_offset_seconds,
    current: {
      temp: Math.round(w.current.temperature_2m),
      feels: Math.round(w.current.apparent_temperature),
      humidity: w.current.relative_humidity_2m,
      code: w.current.weather_code,
      wind: Math.round(w.current.wind_speed_10m),
      day: !!w.current.is_day,
      precip: w.current.precipitation,
    },
    hourly: (w.hourly.time as string[]).slice(nowIdx, nowIdx + 12).map((t, i) => ({
      time: t,
      temp: Math.round(w.hourly.temperature_2m[nowIdx + i]),
      code: w.hourly.weather_code[nowIdx + i],
      rain: w.hourly.precipitation_probability[nowIdx + i],
      day: !!w.hourly.is_day[nowIdx + i],
    })),
    daily: (w.daily.time as string[]).map((t, i) => ({
      date: t,
      code: w.daily.weather_code[i],
      max: Math.round(w.daily.temperature_2m_max[i]),
      min: Math.round(w.daily.temperature_2m_min[i]),
      sunrise: w.daily.sunrise[i],
      sunset: w.daily.sunset[i],
      rain: w.daily.precipitation_probability_max[i],
      uv: w.daily.uv_index_max[i],
    })),
    fetchedAt: Date.now(),
  };
}

// ---------- GitHub: the public contribution graph needs no token ----------

async function github() {
  const user = settings.value.accounts.githubUser;
  if (!user) return { error: "Add your GitHub username in Settings › Accounts" };
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = settings.value.accounts.githubToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  const [profile, html] = await Promise.all([
    getJson<any>(`https://api.github.com/users/${encodeURIComponent(user)}`, { headers }),
    getText(`https://github.com/users/${encodeURIComponent(user)}/contributions`),
  ]);
  const days: { date: string; level: number; count: number }[] = [];
  const cell = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*?data-level="(\d)"/g;
  const tips = new Map<string, number>();
  const tip = /<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g;
  const idToDate = new Map<string, string>();
  for (const m of html.matchAll(/id="([^"]+)"[^>]*data-date="(\d{4}-\d{2}-\d{2})"/g)) idToDate.set(m[1], m[2]);
  for (const m of html.matchAll(tip)) {
    const date = idToDate.get(m[1]);
    const n = /^(\d+|No) contribution/.exec(m[2].trim());
    if (date && n) tips.set(date, n[1] === "No" ? 0 : Number(n[1]));
  }
  for (const m of html.matchAll(cell)) days.push({ date: m[1], level: Number(m[2]), count: tips.get(m[1]) ?? 0 });
  days.sort((a, b) => a.date.localeCompare(b.date));
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].level > 0) streak++;
    else if (i === days.length - 1) continue; // today may not have started
    else break;
  }
  const week = days.slice(-7).reduce((s, d) => s + d.count, 0);
  const year = days.reduce((s, d) => s + d.count, 0);
  let notifications: number | null = null;
  if (token) {
    try {
      notifications = (await getJson<unknown[]>("https://api.github.com/notifications?per_page=50", { headers })).length;
    } catch {
      notifications = null;
    }
  }
  return {
    user,
    avatar: profile.avatar_url,
    followers: profile.followers,
    repos: profile.public_repos,
    days: days.slice(-126),
    streak,
    week,
    today: days.at(-1)?.count ?? 0,
    year,
    notifications,
  };
}

// ---------- money ----------

async function currency() {
  const r = await getJson<{ base: string; date: string; rates: Record<string, number> }>("https://api.frankfurter.app/latest?from=USD");
  return { base: "USD", date: r.date, rates: { USD: 1, ...r.rates } };
}

async function crypto() {
  const id = settings.value.crypto || "bitcoin";
  const r = await getJson<any>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}&sparkline=true&price_change_percentage=24h`,
  );
  const c = r[0];
  if (!c) return { error: "Unknown coin" };
  return {
    id,
    symbol: String(c.symbol).toUpperCase(),
    name: c.name,
    price: c.current_price,
    change: c.price_change_percentage_24h,
    image: c.image,
    spark: (c.sparkline_in_7d?.price as number[] | undefined)?.filter((_, i: number) => i % 4 === 0) ?? [],
  };
}

const stockHistory = new Map<string, number[]>();

async function stocks() {
  const key = settings.value.accounts.finnhubKey;
  if (!key) return { error: "Add a free Finnhub key in Settings › Accounts" };
  const quotes = await Promise.all(
    settings.value.tickers.slice(0, 6).map(async (t) => {
      const q = await getJson<any>(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${key}`);
      // the free plan has no candles, so the day's line is built from the quotes as they come
      const h = stockHistory.get(t) ?? [];
      if (q.c && h.at(-1) !== q.c) h.push(q.c);
      if (h.length > 240) h.shift();
      stockHistory.set(t, h);
      return { symbol: t, price: q.c, change: q.dp, open: q.o, high: q.h, low: q.l, prev: q.pc, history: q.pc ? [q.pc, ...h] : [...h] };
    }),
  );
  return { quotes, at: Date.now() };
}

export async function stripe() {
  const key = settings.value.accounts.stripeKey;
  if (!key) return { error: "Add a restricted Stripe key in Settings › Accounts" };
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  const daily = new Map<string, number>();
  let total = 0;
  let currencyCode = "usd";
  let starting: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = `https://api.stripe.com/v1/balance_transactions?limit=100&created[gte]=${since}${starting ? `&starting_after=${starting}` : ""}`;
    const r = await getJson<any>(url, { headers: { Authorization: `Bearer ${key}` } });
    for (const t of r.data as any[]) {
      if (t.type !== "charge" && t.type !== "payment" && t.type !== "refund" && t.type !== "payment_refund") continue;
      const day = new Date(t.created * 1000).toISOString().slice(0, 10);
      daily.set(day, (daily.get(day) ?? 0) + t.net / 100);
      total += t.net / 100;
      currencyCode = t.currency;
    }
    if (!r.has_more || !r.data.length) break;
    starting = r.data.at(-1).id;
  }
  const days: { date: string; value: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push({ date: d, value: daily.get(d) ?? 0 });
  }
  const week = days.slice(-7).reduce((s, d) => s + d.value, 0);
  const prevWeek = days.slice(0, 7).reduce((s, d) => s + d.value, 0);
  return { total, currency: currencyCode.toUpperCase(), days, week, change: prevWeek ? ((week - prevWeek) / prevWeek) * 100 : 0 };
}

// ---------- calendars: Google, Outlook and iCloud all publish an ICS address ----------

function icsDate(v: string): { t: number; allDay: boolean } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v);
  if (!m) return { t: NaN, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { t: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  return { t: z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(), allDay: false };
}

export function parseIcs(text: string, source: string, color: string): CalEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: CalEvent[] = [];
  const horizonStart = Date.now() - 31 * 86400_000;
  const horizonEnd = Date.now() + 62 * 86400_000;
  let ev: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT" && ev) {
      const start = icsDate(ev.DTSTART ?? "");
      const end = ev.DTEND ? icsDate(ev.DTEND) : { t: start.t + (start.allDay ? 86400_000 : 3600_000), allDay: start.allDay };
      if (!isNaN(start.t)) {
        const base: CalEvent = {
          id: (ev.UID ?? Math.random().toString(36)) + "@" + start.t,
          title: (ev.SUMMARY ?? "Event").replace(/\\,/g, ",").replace(/\\n/g, " ").replace(/\\;/g, ";"),
          start: start.t,
          end: end.t,
          allDay: start.allDay,
          location: ev.LOCATION?.replace(/\\,/g, ","),
          source,
          color,
        };
        const rule = ev.RRULE;
        if (rule) {
          // daily and weekly repeats cover most meetings; others show their first date
          const freq = /FREQ=(\w+)/.exec(rule)?.[1];
          const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1);
          const until = /UNTIL=(\w+)/.exec(rule)?.[1];
          const count = Number(/COUNT=(\d+)/.exec(rule)?.[1] ?? 500);
          const byDay = /BYDAY=([\w,]+)/.exec(rule)?.[1]?.split(",");
          const step = freq === "DAILY" ? 86400_000 : freq === "WEEKLY" ? 7 * 86400_000 : 0;
          const untilT = until ? icsDate(until).t : Infinity;
          const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
          if (step) {
            let n = 0;
            for (let t = base.start; t <= Math.min(untilT, horizonEnd) && n < count; t += step * interval) {
              const offsets = freq === "WEEKLY" && byDay ? byDay.map((d) => (days.indexOf(d.slice(-2)) - new Date(base.start).getDay() + 7) % 7) : [0];
              for (const off of offsets) {
                const s = t + off * 86400_000;
                n++;
                if (s >= horizonStart && s <= horizonEnd) out.push({ ...base, id: base.id + ":" + s, start: s, end: s + (base.end - base.start) });
              }
            }
            continue;
          }
          if (freq === "YEARLY" || freq === "MONTHLY") {
            for (let i = 0; i < 40; i++) {
              const d = new Date(base.start);
              if (freq === "YEARLY") d.setFullYear(d.getFullYear() + i * interval);
              else d.setMonth(d.getMonth() + i * interval);
              const s = d.getTime();
              if (s > Math.min(untilT, horizonEnd)) break;
              if (s >= horizonStart) out.push({ ...base, id: base.id + ":" + s, start: s, end: s + (base.end - base.start) });
            }
            continue;
          }
        }
        if (base.end >= horizonStart && base.start <= horizonEnd) out.push(base);
      }
      ev = null;
    } else if (ev) {
      const i = line.indexOf(":");
      if (i > 0) {
        const key = line.slice(0, i).split(";")[0];
        if (!(key in ev)) ev[key] = line.slice(i + 1);
      }
    }
  }
  return out;
}

async function calendars() {
  const all: CalEvent[] = [];
  const errors: string[] = [];
  await Promise.all(
    settings.value.calendars.map(async (c) => {
      try {
        const url = c.url.replace(/^webcal:/i, "https:");
        all.push(...parseIcs(await getText(url), c.name, c.color));
      } catch (e) {
        errors.push(`${c.name}: ${(e as Error).message}`);
      }
    }),
  );
  return { events: all, errors, at: Date.now() };
}

export function initOnlineTopics(): void {
  defineTopic("weather", poller(weather, 15 * 60_000));
  defineTopic("github", poller(github, 30 * 60_000));
  defineTopic("currency", poller(currency, 6 * 3600_000));
  defineTopic("crypto", poller(crypto, 2 * 60_000));
  defineTopic("stocks", poller(stocks, 60_000));
  defineTopic("stripe", poller(stripe, 15 * 60_000));
  defineTopic("calendars", poller(calendars, 20 * 60_000));
  settings.onChange((v, prev) => {
    if (v.city?.lat !== prev.city?.lat || v.city?.lon !== prev.city?.lon || v.units !== prev.units || (v.cityAuto && !prev.cityAuto)) refreshTopic("weather");
    if (v.accounts !== prev.accounts) {
      refreshTopic("github");
      refreshTopic("stocks");
      refreshTopic("stripe");
    }
    if (v.calendars !== prev.calendars) refreshTopic("calendars");
    if (v.crypto !== prev.crypto) refreshTopic("crypto");
    if (v.tickers !== prev.tickers) refreshTopic("stocks");
  });
}
