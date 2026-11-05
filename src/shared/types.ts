// Types shared by the main process and the windows.

export type DockStyle = "black" | "white" | "glass" | "ios" | "midnight" | "clear";
export type ClearTiles = "black" | "white" | "frosted";

export interface WidgetInstance {
  uid: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface Pin {
  id: string;
  name: string;
  /** a file, folder, .exe or .lnk */
  path?: string;
  /** an app from Start (packaged apps have a "!" in it) */
  aumid?: string;
  /** the .exe a shortcut points at, to match running windows */
  exe?: string;
  args?: string;
  /** apps grouped together, iPhone style */
  group?: { name: string; items: Pin[] };
}

export interface City {
  name: string;
  country?: string;
  lat: number;
  lon: number;
  tz?: string;
  /** how an automatic city was found, and when */
  from?: "windows" | "ip" | "timezone";
  at?: number;
}

/** the Google account signed in to VyseBar: only the name, email and photo */
export interface GoogleProfile {
  name: string;
  givenName: string;
  email: string;
  /** a data URL, cached on this PC */
  photo: string | null;
  /** false when Google stopped accepting the saved sign-in (revoked); the profile stays cached */
  valid: boolean;
}

export interface WorldClock {
  name: string;
  tz: string;
}

export interface IcsCalendar {
  id: string;
  name: string;
  url: string;
  color: string;
}

export interface Settings {
  style: DockStyle;
  clearTiles: ClearTiles;
  accent: string;
  edge: "bottom" | "top";
  fullWidth: boolean;
  size: number;
  spacing: number;
  distance: number;
  autoHide: boolean;
  floatOver: boolean;
  displays: "primary" | "all";
  lock: boolean;
  labels: boolean;
  previews: boolean;
  /** hovering a window preview shows that window full size, as on the Windows taskbar */
  peek: boolean;
  hideTaskbar: boolean;
  /** how the Windows taskbar gets out of the way while VyseBar runs */
  taskbarMode: "hidden" | "autohide";
  /** Win+1...9 open the dock's apps (while it replaces the taskbar), as on the Windows taskbar */
  winKeys: boolean;
  /** lite trades live glass and some animation for memory; auto picks lite on low-end PCs */
  performance: "auto" | "smooth" | "lite";
  clock24: boolean;
  clockSeconds: boolean;
  launchAtStartup: boolean;
  units: "c" | "f";
  city: City | null;
  /** the weather follows this PC around: Windows location, else the IP address's city */
  cityAuto: boolean;
  worldClocks: WorldClock[];
  quietHours: { on: boolean; from: string; to: string };
  sounds: { on: boolean; tone: "glass" | "chime" | "pop" | "bell" };
  automations: {
    eventReminders: boolean;
    pauseMusicForEvents: boolean;
    aiLimits: boolean;
    batteryLow: boolean;
    storageLow: boolean;
  };
  startTile: "windows" | "vyse" | "custom" | "google";
  startImage: string | null;
  /** your own Google Cloud OAuth client (Desktop app), for "Sign in with Google" */
  google: { clientId: string; clientSecret: string };
  widgets: WidgetInstance[];
  pins: Pin[];
  accounts: {
    githubUser?: string;
    githubToken?: string;
    finnhubKey?: string;
    stripeKey?: string;
    claudeLimit?: number;
  };
  /** keys for the account widgets, by provider id (see shared/accounts.ts) */
  providers: Record<string, Record<string, string>>;
  calendars: IcsCalendar[];
  tickers: string[];
  crypto: string;
  revenueGoal: number;
  firstRun: boolean;
}

export interface WinInfo {
  hwnd: number;
  pid: number;
  title: string;
  exe: string | null;
  aumid: string | null;
  minimized: boolean;
  active: boolean;
  flashing: boolean;
}

export interface AppItem {
  key: string;
  name: string;
  icon?: string;
  pinned: boolean;
  pin?: Pin;
  windows: WinInfo[];
  active: boolean;
  flashing: boolean;
}

export interface MediaState {
  app: string;
  appName?: string;
  appIcon?: string;
  title: string;
  artist: string;
  album: string;
  thumb: string | null;
  status: "playing" | "paused" | "stopped" | "closed" | "opened" | "changing";
  canNext: boolean;
  canPrev: boolean;
  canSeek: boolean;
  position?: number;
  duration?: number;
  updatedAt?: number;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  due?: number;
}

export interface Note {
  id: string;
  text: string;
  updatedAt: number;
}

export interface CalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  location?: string;
  source: string;
  color: string;
  kind?: "event" | "renewal" | "payout" | "limit" | "due";
}

export interface TimerState {
  /** epoch ms it ends at while running */
  endsAt: number | null;
  /** ms left while paused */
  remaining: number;
  duration: number;
  presets: number[];
}

export interface PomodoroState {
  phase: "focus" | "short" | "long";
  round: number;
  rounds: number;
  endsAt: number | null;
  remaining: number;
  focusMin: number;
  shortMin: number;
  longMin: number;
  completedToday: number;
  day: string;
}

export interface StopwatchState {
  startedAt: number | null;
  elapsed: number;
  laps: number[];
}

export interface Data {
  todos: Todo[];
  notes: Note[];
  events: CalEvent[];
  timer: TimerState;
  pomodoro: PomodoroState;
  stopwatch: StopwatchState;
  /** the currency converter's last pair and amount */
  currency?: { from: string; to: string; amount: number };
}

export interface Toast {
  id: string;
  title: string;
  body?: string;
  icon?: string;
  tone?: boolean;
  accent?: string;
  ttl?: number;
  /** a button on the toast that calls this IPC handler */
  action?: { label: string; invoke: string };
}

export interface UpdateState {
  /** off: a development build, which has no release to compare with */
  status: "off" | "idle" | "checking" | "latest" | "downloading" | "ready" | "error";
  /** the version running now */
  version: string;
  /** the version found on GitHub */
  next?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
}

export interface DockInfo {
  displayId: number;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  windowHeight: number;
}

export const DEFAULT_WIDGETS: WidgetInstance[] = [
  { uid: "apps", type: "apps" },
  { uid: "media", type: "nowPlaying" },
  { uid: "stats", type: "systemStats" },
  { uid: "cal", type: "calendar" },
  { uid: "weather", type: "weather" },
  { uid: "toggles", type: "quickToggles" },
  { uid: "tray", type: "tray" },
  { uid: "today", type: "dateClock" },
];

export const DEFAULT_SETTINGS: Settings = {
  style: "glass",
  clearTiles: "frosted",
  accent: "#0a84ff",
  edge: "bottom",
  fullWidth: false,
  size: 48,
  spacing: 4,
  distance: 8,
  autoHide: false,
  floatOver: false,
  displays: "primary",
  lock: false,
  labels: true,
  previews: true,
  peek: true,
  hideTaskbar: true,
  taskbarMode: "hidden",
  winKeys: true,
  performance: "auto",
  clock24: false,
  clockSeconds: false,
  launchAtStartup: false,
  units: "c",
  city: null,
  cityAuto: true,
  worldClocks: [
    { name: "New York", tz: "America/New_York" },
    { name: "London", tz: "Europe/London" },
    { name: "Tokyo", tz: "Asia/Tokyo" },
  ],
  quietHours: { on: false, from: "22:00", to: "08:00" },
  sounds: { on: true, tone: "glass" },
  automations: { eventReminders: true, pauseMusicForEvents: true, aiLimits: true, batteryLow: true, storageLow: true },
  startTile: "windows",
  startImage: null,
  google: { clientId: "", clientSecret: "" },
  widgets: DEFAULT_WIDGETS,
  pins: [],
  accounts: {},
  calendars: [],
  tickers: ["AAPL", "NVDA", "MSFT"],
  crypto: "bitcoin",
  revenueGoal: 1000,
  providers: {},
  firstRun: true,
};

export const DEFAULT_DATA: Data = {
  todos: [],
  notes: [],
  events: [],
  timer: { endsAt: null, remaining: 5 * 60_000, duration: 5 * 60_000, presets: [60_000, 5 * 60_000, 10 * 60_000, 25 * 60_000] },
  pomodoro: {
    phase: "focus",
    round: 1,
    rounds: 4,
    endsAt: null,
    remaining: 25 * 60_000,
    focusMin: 25,
    shortMin: 5,
    longMin: 15,
    completedToday: 0,
    day: "",
  },
  stopwatch: { startedAt: null, elapsed: 0, laps: [] },
};

export const ACCENTS = ["#0a84ff", "#5e5ce6", "#bf5af2", "#ff375f", "#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#8e8e93"];
