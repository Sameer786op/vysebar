export function time(t: number | Date, h24: boolean, seconds = false): { hm: string; ampm: string; s: string } {
  const d = new Date(t);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  if (!h24) h = h % 12 || 12;
  const hm = `${h24 ? String(h).padStart(2, "0") : h}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { hm, ampm: h24 ? "" : ampm, s: seconds ? String(d.getSeconds()).padStart(2, "0") : "" };
}

export function clock(t: number | Date, h24: boolean): string {
  const { hm, ampm } = time(t, h24);
  return ampm ? `${hm} ${ampm}` : hm;
}

export function tzTime(t: number, tz: string, h24: boolean): { hm: string; ampm: string; h: number; m: number; s: number; offsetH: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  const h = get("hour");
  const m = get("minute");
  const s = get("second");
  const local = new Date(t);
  let offsetH = h - local.getHours() + (m - local.getMinutes()) / 60;
  if (offsetH > 12) offsetH -= 24;
  if (offsetH < -12) offsetH += 24;
  const hh = h24 ? String(h).padStart(2, "0") : String(h % 12 || 12);
  return { hm: `${hh}:${String(m).padStart(2, "0")}`, ampm: h24 ? "" : h >= 12 ? "PM" : "AM", h, m, s, offsetH };
}

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function stopwatch(ms: number): string {
  const cs = Math.floor((ms % 1000) / 10);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60_000) % 60;
  const h = Math.floor(ms / 3_600_000);
  return `${h ? h + ":" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function relative(ms: number): string {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60_000);
  if (m < 1) return ms >= 0 ? "now" : "just now";
  const txt = m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + "m" : ""}`.trim() : `${Math.round(m / 1440)}d`;
  return ms >= 0 ? `in ${txt}` : `${txt} ago`;
}

export function compact(n: number, digits = 1): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(digits).replace(/\.0+$/, "") + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(digits).replace(/\.0+$/, "") + "M";
  if (abs >= 1e4) return (n / 1e3).toFixed(digits).replace(/\.0+$/, "") + "K";
  if (abs >= 1e3) return (n / 1e3).toFixed(digits).replace(/\.0+$/, "") + "K";
  return String(Math.round(n));
}

export function bytes(n: number, digits = 1): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : digits)} ${u[i]}`;
}

export function speed(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${Math.round(bps / 1024)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

export function money(n: number, currency = "USD", short = false): string {
  if (short && Math.abs(n) >= 1000) {
    const sym = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(0).replace(/0/g, "").trim();
    return sym + compact(n);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }).format(n);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const sameDay = (a: number | Date, b: number | Date) => new Date(a).toDateString() === new Date(b).toDateString();
export const startOfDay = (t: number | Date) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
