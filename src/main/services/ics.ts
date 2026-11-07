// Calendar files (ICS), the way Google, Outlook and iCloud publish them: the events of the weeks
// around today, with repeating ones laid out. What those three write is covered: zones by name
// (IANA, Windows' own names, or a VTIMEZONE without daylight time), repeats by day, week, month
// and year with BYDAY / BYMONTHDAY / BYMONTH / BYSETPOS, COUNT and UNTIL, dates left out (EXDATE),
// single occurrences moved or cancelled (RECURRENCE-ID) and DURATION. Repeats step on the
// calendar, not by 24 hours, so a 9:00 meeting stays at 9:00 across a clock change.
import { createHash } from "node:crypto";
import type { CalEvent } from "@shared/types";

const DAY = 86400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// ---------- reading the file ----------

type Prop = { value: string; params: Record<string, string> };
type Comp = { name: string; props: Map<string, Prop[]>; children: Comp[] };

/** splits on `sep` outside double quotes */
function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') quoted = !quoted;
    else if (s[i] === sep && !quoted) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

function readLine(line: string): { name: string; prop: Prop } | null {
  // the value starts after the first colon that isn't inside a quoted parameter
  let quoted = false;
  let i = 0;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) break;
  }
  if (i === 0 || i >= line.length) return null;
  const [name, ...params] = splitOutside(line.slice(0, i), ";");
  const prop: Prop = { value: line.slice(i + 1), params: {} };
  for (const p of params) {
    const eq = p.indexOf("=");
    if (eq > 0) prop.params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), prop };
}

function readComponents(text: string): Comp {
  const root: Comp = { name: "", props: new Map(), children: [] };
  const stack = [root];
  for (const raw of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const line = readLine(raw);
    if (!line) continue;
    const top = stack[stack.length - 1];
    if (line.name === "BEGIN") {
      const comp: Comp = { name: line.prop.value.trim().toUpperCase(), props: new Map(), children: [] };
      top.children.push(comp);
      stack.push(comp);
    } else if (line.name === "END") {
      // a missing END (an alarm's, say) is forgiven: everything up to the named one closes
      const name = line.prop.value.trim().toUpperCase();
      let at = stack.length - 1;
      while (at > 0 && stack[at].name !== name) at--;
      if (at > 0) stack.length = at;
    } else {
      const list = top.props.get(line.name);
      if (list) list.push(line.prop);
      else top.props.set(line.name, [line.prop]);
    }
  }
  return root;
}

/** every component called `name`, however deep (not looking inside the ones found) */
function findAll(comp: Comp, name: string, out: Comp[] = []): Comp[] {
  for (const c of comp.children) {
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}

const first = (c: Comp, key: string): Prop | undefined => c.props.get(key)?.[0];

/** a text value with its escapes undone; line breaks become spaces */
const plain = (p: Prop | undefined): string =>
  (p?.value ?? "").replace(/\\([\\,;nN])/g, (_, c: string) => (c === "n" || c === "N" ? " " : c)).trim();

// ---------- time ----------

type Zone = { kind: "utc" } | { kind: "local" } | { kind: "named"; tz: string } | { kind: "fixed"; offset: number };
const UTC: Zone = { kind: "utc" };
const LOCAL: Zone = { kind: "local" };

// Outlook writes Windows' names for zones: the ones calendars use most, as CLDR maps them
const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "Eastern Standard Time": "America/New_York",
  "SA Pacific Standard Time": "America/Bogota",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires",
  "UTC": "Etc/UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Israel Standard Time": "Asia/Jerusalem",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Arab Standard Time": "Asia/Riyadh",
  "Arabian Standard Time": "Asia/Dubai",
  "Iran Standard Time": "Asia/Tehran",
  "Afghanistan Standard Time": "Asia/Kabul",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Calcutta",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Katmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "Myanmar Standard Time": "Asia/Rangoon",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "Taipei Standard Time": "Asia/Taipei",
  "W. Australia Standard Time": "Australia/Perth",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
};

const formats = new Map<string, Intl.DateTimeFormat | null>();
function formatFor(tz: string): Intl.DateTimeFormat | null {
  if (!formats.has(tz)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      /* not a zone this PC knows */
    }
    formats.set(tz, f);
  }
  return formats.get(tz) ?? null;
}

/** the zone's clock minus UTC at instant t, in ms */
function offsetAt(f: Intl.DateTimeFormat, t: number): number {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(t))) p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

// Asking Intl is slow, and a big calendar asks for every occurrence. A zone's offset is the same
// all day except on the days its clocks change: it is asked once per day, and exactly on those
const dayOffsets = new Map<string, number | null>();
function offsetOn(tz: string, f: Intl.DateTimeFormat, t: number): number {
  const day = Math.floor(t / DAY);
  const key = `${tz}|${day}`;
  let o = dayOffsets.get(key);
  if (o === undefined) {
    const a = offsetAt(f, day * DAY);
    o = a === offsetAt(f, (day + 1) * DAY) ? a : null;
    if (dayOffsets.size > 20_000) dayOffsets.clear();
    dayOffsets.set(key, o);
  }
  return o ?? offsetAt(f, t);
}

function namedZone(id: string): Zone | null {
  // an IANA name may come with a vendor's prefix ("/mozilla.org/20050126_1/America/New_York")
  const tail = /[A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/.exec(id)?.[0];
  for (const tz of [id, WINDOWS_ZONES[id], tail]) if (tz && formatFor(tz)) return { kind: "named", tz };
  return null;
}

function offsetValue(v: string | undefined): number | null {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(v?.trim() ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * ((+m[2] * 60 + +m[3]) * 60 + +(m[4] ?? 0)) * 1000 : null;
}

/** the zones the file defines itself, for names the PC doesn't know */
function fileZones(root: Comp): Map<string, Zone> {
  const zones = new Map<string, Zone>();
  const y = new Date().getFullYear();
  const here = [new Date(y, 0, 1), new Date(y, 6, 1)].map((d) => -d.getTimezoneOffset() * 60_000);
  for (const vtz of findAll(root, "VTIMEZONE")) {
    const id = first(vtz, "TZID")?.value.trim();
    if (!id) continue;
    const named = namedZone(id);
    if (named) {
      zones.set(id, named);
      continue;
    }
    // the latest rules of each kind
    const latest = (kind: string): number | null => {
      let best: Comp | null = null;
      for (const c of vtz.children) {
        if (c.name === kind && (!best || (first(c, "DTSTART")?.value ?? "") > (first(best, "DTSTART")?.value ?? ""))) best = c;
      }
      return best ? offsetValue(first(best, "TZOFFSETTO")?.value) : null;
    };
    const std = latest("STANDARD");
    const dst = latest("DAYLIGHT");
    if (std === null) continue;
    if (dst === null) zones.set(id, { kind: "fixed", offset: std });
    // with daylight time the PC's own zone is the better guess, when its offsets are the same
    else zones.set(id, here.includes(std) && here.includes(dst) ? LOCAL : { kind: "fixed", offset: std });
  }
  return zones;
}

function zoneOf(tzid: string | undefined, zones: Map<string, Zone>): Zone {
  if (!tzid) return LOCAL;
  let z = zones.get(tzid);
  if (!z) {
    z = namedZone(tzid) ?? LOCAL;
    zones.set(tzid, z);
  }
  return z;
}

/** a clock time on a calendar day: days since 1970-01-01 and seconds into the day */
type Wall = { day: number; secs: number };
type When = { wall: Wall; zone: Zone; allDay: boolean };

const civil = (day: number) => {
  const d = new Date(day * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY);
/** 0 = Sunday; 1970-01-01 was a Thursday */
const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** the moment a clock time in `zone` stands for */
function instant(w: Wall, zone: Zone): number {
  const { y, m, d } = civil(w.day);
  const h = Math.floor(w.secs / 3600);
  const mi = Math.floor(w.secs / 60) % 60;
  const s = w.secs % 60;
  if (zone.kind === "utc") return Date.UTC(y, m, d, h, mi, s);
  if (zone.kind === "fixed") return Date.UTC(y, m, d, h, mi, s) - zone.offset;
  if (zone.kind === "local") return new Date(y, m, d, h, mi, s).getTime();
  const f = formatFor(zone.tz);
  if (!f) return new Date(y, m, d, h, mi, s).getTime();
  const clock = Date.UTC(y, m, d, h, mi, s);
  return clock - offsetOn(zone.tz, f, clock - offsetOn(zone.tz, f, clock));
}

function readWhen(p: Prop | undefined, zones: Map<string, Zone>): When | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(p?.value.trim() ?? "");
  if (!p || !m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const wall = { day: dayOf(+y, +mo - 1, +d), secs: h === undefined ? 0 : +h * 3600 + +mi * 60 + +s };
  // a date alone is a whole day wherever you are
  if (h === undefined) return { wall, zone: LOCAL, allDay: true };
  return { wall, zone: z ? UTC : zoneOf(p.params.TZID, zones), allDay: false };
}

function readDuration(v: string | undefined): { days: number; ms: number } | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v?.trim() ?? "");
  if (!m || m[1] === "-") return null;
  const days = +(m[2] ?? 0) * 7 + +(m[3] ?? 0);
  return { days, ms: days * DAY + ((+(m[4] ?? 0) * 60 + +(m[5] ?? 0)) * 60 + +(m[6] ?? 0)) * 1000 };
}

// ---------- repeats ----------

type ByDay = { n: number; wd: number };
type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  /** occurrences in all, DTSTART included */
  count: number;
  until: number;
  byDay: ByDay[] | null;
  byMonthDay: number[] | null;
  /** 0 = January */
  byMonth: number[] | null;
  bySetPos: number[] | null;
  wkst: number;
};

function readRule(value: string, start: When, zones: Map<string, Zone>): Rule | null {
  const parts: Record<string, string> = {};
  for (const kv of value.split(";")) {
    const eq = kv.indexOf("=");
    if (eq > 0) parts[kv.slice(0, eq).trim().toUpperCase()] = kv.slice(eq + 1).trim().toUpperCase();
  }
  const freq = parts.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const nums = (k: string): number[] | null => {
    const list = parts[k]?.split(",").map(Number).filter((x) => Number.isInteger(x) && x !== 0);
    return list?.length ? list : null;
  };
  const byDay = (parts.BYDAY ?? "")
    .split(",")
    .map((x) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ n: Number(m[1] ?? 0), wd: WEEKDAYS.indexOf(m[2]) }));
  let until = Infinity;
  if (parts.UNTIL) {
    const u = readWhen({ value: parts.UNTIL, params: {} }, zones);
    // a date alone means all of that day, in the event's own time
    if (u) until = u.allDay ? instant({ day: u.wall.day, secs: 86399 }, start.zone) : instant(u.wall, u.zone.kind === "utc" ? UTC : start.zone);
  }
  const count = Math.floor(Number(parts.COUNT));
  return {
    freq,
    interval: Math.max(1, Math.floor(Number(parts.INTERVAL)) || 1),
    count: parts.COUNT && Number.isFinite(count) && count > 0 ? count : Infinity,
    until,
    byDay: byDay.length ? byDay : null,
    byMonthDay: nums("BYMONTHDAY"),
    byMonth: nums("BYMONTH")?.map((m) => m - 1) ?? null,
    bySetPos: nums("BYSETPOS"),
    wkst: Math.max(0, WEEKDAYS.indexOf(parts.WKST ?? "MO")),
  };
}

/** the days in [from, to) that BYDAY picks: every such weekday, or the nth (from the end when negative) */
function pickWeekdays(from: number, to: number, byDay: ByDay[]): number[] {
  const out: number[] = [];
  for (const { n, wd } of byDay) {
    const all: number[] = [];
    for (let d = from + ((wd - weekday(from) + 7) % 7); d < to; d += 7) all.push(d);
    if (!n) out.push(...all);
    else {
      const pick = n > 0 ? all[n - 1] : all[all.length + n];
      if (pick !== undefined) out.push(pick);
    }
  }
  return out;
}

/** the days of a month the rule picks; `dom` is DTSTART's day of the month */
function monthDays(y: number, m: number, rule: Rule, dom: number): number[] {
  const start = dayOf(y, m, 1);
  const len = daysIn(y, m);
  const wanted = (x: number) => (x > 0 ? x : len + x + 1);
  if (rule.byDay) {
    const days = pickWeekdays(start, start + len, rule.byDay);
    if (!rule.byMonthDay) return days;
    const want = new Set(rule.byMonthDay.map(wanted));
    return days.filter((d) => want.has(d - start + 1));
  }
  if (rule.byMonthDay) return rule.byMonthDay.map(wanted).filter((x) => x >= 1 && x <= len).map((x) => start + x - 1);
  // the 31st repeats only in months that have one
  return dom <= len ? [start + dom - 1] : [];
}

function yearDays(y: number, rule: Rule, s: { m: number; d: number }): number[] {
  if (rule.byMonth) return rule.byMonth.flatMap((m) => monthDays(y, m, rule, s.d));
  // "the 20th Monday of the year": counted over the whole year
  if (rule.byDay) return pickWeekdays(dayOf(y, 0, 1), dayOf(y + 1, 0, 1), rule.byDay);
  if (rule.byMonthDay) return Array.from({ length: 12 }, (_, m) => monthDays(y, m, rule, s.d)).flat();
  // the 29th of February repeats in leap years only
  return s.d <= daysIn(y, s.m) ? [dayOf(y, s.m, s.d)] : [];
}

function setPos(days: number[], pos: number[] | null): number[] {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!pos) return sorted;
  const picked = pos.map((p) => (p > 0 ? sorted[p - 1] : sorted[sorted.length + p])).filter((d): d is number => d !== undefined);
  return [...new Set(picked)].sort((a, b) => a - b);
}

/**
 * the days a rule repeats on, in order, up to `lastDay`. A repeat without a COUNT starts near
 * `fromDay` (years of a daily meeting are skipped, not stepped through); with one it starts at
 * the beginning, since every occurrence counts.
 */
function* repeatDays(rule: Rule, start: Wall, fromDay: number, lastDay: number): Generator<number> {
  const s = civil(start.day);
  const MAX = 100_000;
  const inMonths = (days: number[]) => (rule.byMonth ? days.filter((d) => rule.byMonth!.includes(civil(d).m)) : days);
  if (rule.freq === "DAILY") {
    let k = Math.max(0, Math.floor((fromDay - start.day) / rule.interval) - 1);
    for (let i = 0; i < MAX; i++, k++) {
      const d = start.day + k * rule.interval;
      if (d > lastDay) return;
      const c = civil(d);
      if (rule.byMonth && !rule.byMonth.includes(c.m)) continue;
      if (rule.byMonthDay && !rule.byMonthDay.some((x) => (x > 0 ? x : daysIn(c.y, c.m) + x + 1) === c.d)) continue;
      if (rule.byDay && !rule.byDay.some((b) => b.wd === weekday(d))) continue;
      yield d;
    }
  } else if (rule.freq === "WEEKLY") {
    const week0 = start.day - ((weekday(start.day) - rule.wkst + 7) % 7);
    const span = 7 * rule.interval;
    const every = rule.byDay?.map((b) => ({ n: 0, wd: b.wd }));
    let k = Math.max(0, Math.floor((fromDay - week0) / span) - 1);
    for (let i = 0; i < MAX; i++, k++) {
      const ws = week0 + k * span;
      if (ws > lastDay) return;
      yield* setPos(inMonths(every ? pickWeekdays(ws, ws + 7, every) : [ws + start.day - week0]), rule.bySetPos);
    }
  } else if (rule.freq === "MONTHLY") {
    const m0 = s.y * 12 + s.m;
    const f = civil(fromDay);
    let k = Math.max(0, Math.floor((f.y * 12 + f.m - m0) / rule.interval) - 1);
    for (let i = 0; i < MAX; i++, k++) {
      const mm = m0 + k * rule.interval;
      const y = Math.floor(mm / 12);
      const m = mm - y * 12;
      if (dayOf(y, m, 1) > lastDay) return;
      yield* setPos(inMonths(monthDays(y, m, rule, s.d)), rule.bySetPos);
    }
  } else {
    let k = Math.max(0, Math.floor((civil(fromDay).y - s.y) / rule.interval) - 1);
    for (let i = 0; i < MAX; i++, k++) {
      const y = s.y + k * rule.interval;
      if (dayOf(y, 0, 1) > lastDay) return;
      yield* setPos(yearDays(y, rule, s), rule.bySetPos);
    }
  }
}

// ---------- events ----------

export function parseIcs(text: string, source: string, color: string, now = Date.now()): CalEvent[] {
  const root = readComponents(text);
  const zones = fileZones(root);
  const from = now - 31 * DAY;
  const to = now + 62 * DAY;
  // in calendar days, with a margin for zones either side of UTC
  const fromDay = Math.floor(from / DAY) - 2;
  const lastDay = Math.floor(to / DAY) + 2;
  const events = findAll(root, "VEVENT");
  const out: CalEvent[] = [];

  // an occurrence moved or cancelled on its own comes as an event of its own, naming the
  // start it replaces in RECURRENCE-ID
  const replaced = new Map<string, Set<number>>();
  for (const ev of events) {
    const rid = readWhen(first(ev, "RECURRENCE-ID"), zones);
    const uid = first(ev, "UID")?.value.trim();
    if (!rid || !uid) continue;
    const set = replaced.get(uid) ?? new Set<number>();
    set.add(instant(rid.wall, rid.zone));
    replaced.set(uid, set);
  }

  for (const ev of events) {
    const startProp = first(ev, "DTSTART");
    const start = readWhen(startProp, zones);
    if (!startProp || !start) continue;
    const startT = instant(start.wall, start.zone);
    if (Number.isNaN(startT) || /^CANCELLED$/i.test(first(ev, "STATUS")?.value.trim() ?? "")) continue;
    const title = plain(first(ev, "SUMMARY")) || "Event";
    // an event without an ID gets one from what it is, so it is the same event on every refresh
    const uid = first(ev, "UID")?.value.trim() || createHash("sha1").update(`${title}|${startProp.value}`).digest("hex").slice(0, 16);

    // how long each occurrence lasts; whole days stay whole days across a clock change
    const endWhen = readWhen(first(ev, "DTEND"), zones);
    const duration = readDuration(first(ev, "DURATION")?.value);
    let days = 1;
    let ms = 3600_000;
    if (start.allDay) days = Math.max(1, endWhen ? endWhen.wall.day - start.wall.day : duration?.days || 1);
    else if (endWhen) ms = Math.max(0, instant(endWhen.wall, endWhen.zone) - startT);
    else if (duration) ms = duration.ms;

    const base = { title, allDay: start.allDay, location: plain(first(ev, "LOCATION")) || undefined, source, color };
    const push = (wall: Wall, t: number, id: string) => {
      const end = start.allDay ? instant({ day: wall.day + days, secs: 0 }, LOCAL) : t + ms;
      if (end >= from && t <= to) out.push({ id, ...base, start: t, end });
    };

    const rid = readWhen(first(ev, "RECURRENCE-ID"), zones);
    if (rid) {
      // a moved occurrence keeps the ID of the one it replaces
      push(start.wall, startT, `${uid}@${instant(rid.wall, rid.zone)}`);
      continue;
    }

    // dates left out: EXDATE can come more than once, each with several dates
    const skip = new Set<number>(replaced.get(uid));
    const skipDays = new Set<number>();
    for (const ex of ev.props.get("EXDATE") ?? []) {
      for (const v of ex.value.split(",")) {
        const w = readWhen({ value: v, params: ex.params }, zones);
        if (!w) continue;
        if (w.allDay && !start.allDay) skipDays.add(w.wall.day);
        else skip.add(instant(w.wall, w.zone));
      }
    }
    const occurs = (wall: Wall, t: number) => !skip.has(t) && !skipDays.has(wall.day);

    // DTSTART is always the first occurrence
    if (occurs(start.wall, startT)) push(start.wall, startT, `${uid}@${startT}`);
    const ruleProp = first(ev, "RRULE");
    const rule = ruleProp ? readRule(ruleProp.value, start, zones) : null;
    if (!rule) continue;
    let n = 1;
    for (const day of repeatDays(rule, start.wall, rule.count === Infinity ? fromDay : start.wall.day, lastDay)) {
      if (day <= start.wall.day) continue;
      const wall = { day, secs: start.wall.secs };
      const t = instant(wall, start.zone);
      if (t > rule.until || ++n > rule.count) break;
      if (occurs(wall, t)) push(wall, t, `${uid}@${t}`);
    }
  }
  return out;
}
