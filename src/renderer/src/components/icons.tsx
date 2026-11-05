// Drawn icons: the Start mark, VyseBar's own mark, weather and a few services.
import type { CSSProperties } from "react";

type P = { size?: number; className?: string; style?: CSSProperties };

export function WindowsLogo({ size = 20, className, style }: P) {
  const g = 1.6;
  const s = (24 - g) / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={style}>
      <defs>
        <linearGradient id="winlogo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4cc2ff" />
          <stop offset="1" stopColor="#0078d4" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={s} height={s} rx="1.2" fill="url(#winlogo)" />
      <rect x={s + g} y="0" width={s} height={s} rx="1.2" fill="url(#winlogo)" />
      <rect x="0" y={s + g} width={s} height={s} rx="1.2" fill="url(#winlogo)" />
      <rect x={s + g} y={s + g} width={s} height={s} rx="1.2" fill="url(#winlogo)" />
    </svg>
  );
}

export function VyseLogo({ size = 20, className, style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} style={style}>
      <defs>
        <linearGradient id="vyselogo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7cc4ff" />
          <stop offset="0.5" stopColor="#8b7bff" />
          <stop offset="1" stopColor="#ff6fb5" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#vyselogo)" />
      <path d="M9 10.5 L16 22.5 L23 10.5" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="8" y="24.6" width="16" height="2.2" rx="1.1" fill="white" opacity="0.85" />
    </svg>
  );
}

export function GithubMark({ size = 20, className, style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} style={style} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** a warm starburst, for Claude's tiles */
export function Burst({ size = 20, className, style }: P) {
  const rays = 11;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={style}>
      {Array.from({ length: rays }, (_, i) => {
        const a = (i / rays) * Math.PI * 2;
        const len = 8.6 + ((i * 7) % 3) * 0.9;
        return (
          <line
            key={i}
            x1={12 + Math.cos(a) * 1.6}
            y1={12 + Math.sin(a) * 1.6}
            x2={12 + Math.cos(a) * len}
            y2={12 + Math.sin(a) * len}
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

// ---------- weather ----------

export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export function sky(code: number): Sky {
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

export function skyLabel(code: number): string {
  const map: Record<number, string> = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Icy fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers",
    85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
  };
  return map[code] ?? "Cloudy";
}

/** the tile's background for the weather now, like iOS */
export function skyGradient(code: number, day = true): string {
  const s = sky(code);
  if (!day) return "linear-gradient(160deg,#0f1c3d,#28305a)";
  switch (s) {
    case "clear":
      return "linear-gradient(160deg,#2f8ff0,#5cb8ff)";
    case "partly":
      return "linear-gradient(160deg,#3a83d6,#7fb1e3)";
    case "rain":
    case "drizzle":
    case "storm":
      return "linear-gradient(160deg,#3b4a63,#61718a)";
    case "snow":
      return "linear-gradient(160deg,#7f97b5,#b3c4d8)";
    default:
      return "linear-gradient(160deg,#55708f,#8aa1ba)";
  }
}

export function WeatherIcon({ code, day = true, size = 22 }: { code: number; day?: boolean; size?: number }) {
  const s = sky(code);
  const sun = (cx: number, cy: number, r: number) => (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#ffd60a" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <line key={i} x1={cx + Math.cos(a) * (r + 1.8)} y1={cy + Math.sin(a) * (r + 1.8)} x2={cx + Math.cos(a) * (r + 3.6)} y2={cy + Math.sin(a) * (r + 3.6)} stroke="#ffd60a" strokeWidth="1.6" strokeLinecap="round" />
        );
      })}
    </g>
  );
  const moon = (cx: number, cy: number, r: number) => (
    <path d={`M${cx + r * 0.3} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.75} ${r * 1.55} a${r * 0.82} ${r * 0.82} 0 0 1 -${r * 0.75} -${r * 1.55}z`} fill="#f2f2f7" />
  );
  const cloud = (x: number, y: number, k: number, fill = "#f2f2f7") => (
    <path
      transform={`translate(${x} ${y}) scale(${k})`}
      d="M6 15h11a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.9 8.2 3.4 3.4 0 0 0 6 15z"
      fill={fill}
    />
  );
  return (
    // the soft shadow keeps white moons and clouds readable on the light styles
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 0.5px 1.2px rgb(0 0 0 / 0.3))" }}>
      {s === "clear" && (day ? sun(12, 12, 5) : moon(11, 12, 7))}
      {s === "partly" && (
        <>
          {day ? sun(9, 9, 4) : moon(8, 8, 5)}
          {cloud(1, 3, 1, "#ffffff")}
        </>
      )}
      {(s === "cloudy" || s === "fog") && (
        <>
          {cloud(-1, -1, 1.1, "#d1d1d6")}
          {s === "fog" && <path d="M4 20h16M6 22.5h12" stroke="#d1d1d6" strokeWidth="1.5" strokeLinecap="round" />}
        </>
      )}
      {(s === "rain" || s === "drizzle" || s === "storm" || s === "snow") && (
        <>
          {cloud(0, -3, 1, "#e5e5ea")}
          {s === "snow" ? (
            [6, 12, 18].map((x) => <circle key={x} cx={x} cy={19.5} r={1.4} fill="#fff" />)
          ) : s === "storm" ? (
            <path d="M12 14l-3 5h3l-1.5 4.5L15 17h-3l1.5-3z" fill="#ffd60a" />
          ) : (
            [7, 12, 17].map((x) => <line key={x} x1={x} y1={16} x2={x - 1.6} y2={21} stroke="#64d2ff" strokeWidth="1.7" strokeLinecap="round" />)
          )}
        </>
      )}
    </svg>
  );
}
