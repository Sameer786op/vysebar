// How a dock tells that its page has stopped hearing the pointer, and what to try about it.
// Kept apart from Electron so the rules can be checked on their own; docks.ts says why it's
// needed and carries the repairs out.

/** the page said it heard the pointer this recently: all is well */
export const HEARD_MS = 500;
/** moves over a dock window unheard by its page for this long... */
export const DEAF_MS = 700;
/** ...and at least this many of them (one jump of the pointer is not enough) make a deaf dock */
export const DEAF_MOVES = 5;
/** a pause in the moves this long starts the count again */
export const PAUSE_MS = 1000;
/** a repair followed by the dock going deaf again within this long didn't hold: the next goes further */
export const HOLD_MS = 15_000;

export interface Deaf {
  since: number;
  last: number;
  moves: number;
}

/** one pointer move over a dock window: carries the run of moves its page hasn't heard, and says when it has gone on long enough to act */
export function noteMove(deaf: Deaf | null, now: number, heardAt: number): { deaf: Deaf | null; act: boolean } {
  if (now - heardAt < HEARD_MS) return { deaf: null, act: false };
  const d = deaf && now - deaf.last < PAUSE_MS ? deaf : { since: now, last: now, moves: 0 };
  d.moves++;
  d.last = now;
  if (now - d.since < DEAF_MS || d.moves < DEAF_MOVES) return { deaf: d, act: false };
  return { deaf: null, act: true };
}

/** what the helper found under the pointer (see native/Pointer.cs) */
export interface PointInfo {
  hwnd: number;
  /** the window belongs to VyseBar */
  ours: boolean;
  cls: string;
  /** the program's file name, for another app's window */
  exe?: string;
  topmost: boolean;
  /** a see-through window's opacity, 0-255, when Windows knows it */
  alpha?: number;
  /** a mouse button is held: a drag somewhere else has the mouse */
  buttons: boolean;
  /** the app in front has the mouse: a menu, a window being moved or sized */
  busy: boolean;
  /**
   * Windows isn't drawing the pointer: touch or pen (which mouse hooks never see), or the
   * pointer hidden while typing. It stays set until the mouse moves again, so it only ever
   * holds back the one repair touch could set off by mistake (see docks.ts)
   */
  touch: boolean;
}

export type Verdict =
  /** nothing is wrong: a held button, a menu */
  | "busy"
  /** the dock window itself is under the pointer, yet its page heard nothing */
  | "dock"
  /** another VyseBar window (Settings, a drop-down list) is on top there */
  | "ours"
  /** Windows' own UI, a menu, a tooltip or the like: meant to be on top for now */
  | "system"
  /** another app's always-on-top window sits over the dock and takes its clicks */
  | "covered"
  /** only windows that can't be above an always-on-top dock: the dock isn't taking the pointer where it should */
  | "missing";

/** window classes that are on top for a moment on purpose: the dock never pushes in front of them */
const SYSTEM = new Set([
  "#32768", // menus
  "tooltips_class32",
  "SysDragImage",
  "IME",
  "MSCTFIME UI",
  "Windows.UI.Core.CoreWindow", // Start, Search, the notification centre
  "XamlExplorerHostIslandWindow", // Task View, Snap layouts, Widgets
  "Xaml_WindowedPopupClass", // Windows 11 context menus
  "TopLevelWindowForOverflowXamlIsland", // the tray's overflow
  "NotifyIconOverflowWindow",
  "Shell_InputSwitchTopLevelWindow",
  "ForegroundStaging",
  "MultitaskingViewFrame", // Alt+Tab
  "TaskListThumbnailWnd",
]);

export const coverName = (at: PointInfo): string => `${at.cls || "a window"} of ${at.exe || "another app"}`;

/** skipped: covers this function has stopped pushing in front of, for now */
export function judgePoint(at: PointInfo, dockHwnd: number, skipped: (name: string) => boolean = () => false): Verdict {
  if (at.buttons || at.busy) return "busy";
  if (at.ours) return at.hwnd === dockHwnd ? "dock" : "ours";
  if (SYSTEM.has(at.cls)) return "system";
  if (!at.hwnd || !at.topmost) return "missing";
  if (skipped(coverName(at))) return "system";
  return "covered";
}

export type Repair =
  | "none"
  /** a new mouse hook */
  | "rearm"
  /** the dock in front of the always-on-top windows again */
  | "raise"
  /** the same, taking it out of always-on-top for an instant first */
  | "raiseHard"
  /** the dock's own mouse and window state put back */
  | "reapply"
  /** a new dock window */
  | "recreate"
  /** VyseBar restarting itself */
  | "relaunch"
  /** out of ideas this time */
  | "stop";

/**
 * taking: the dock had taken the mouse (the pointer is on its plate, a card, a menu or a toast);
 * otherwise it was click-through and only the hook can tell its page. verdict: what the helper
 * found under the pointer (null when it wasn't asked or didn't answer). step: 1 for a first
 * try, one more each time the last repair didn't hold.
 */
export function chooseRepair(taking: boolean, verdict: Verdict | null, step: number): Repair {
  if (!taking) {
    // main's own pointer watch keeps a click-through dock taking clicks without the hook, so
    // this never goes as far as a restart
    if (verdict === "busy") return "none";
    return step <= 1 ? "rearm" : step === 2 ? "recreate" : "stop";
  }
  switch (verdict) {
    case "busy":
    case "ours":
    case "system":
      return "none";
    case "covered":
      return step <= 1 ? "raise" : step === 2 ? "raiseHard" : "stop";
    case "dock":
      return step <= 1 ? "recreate" : step === 2 ? "relaunch" : "stop";
    case "missing":
      return step <= 1 ? "reapply" : step === 2 ? "recreate" : step === 3 ? "relaunch" : "stop";
    default:
      // the helper didn't answer
      return step <= 1 ? "reapply" : step === 2 ? "recreate" : "stop";
  }
}

/** counts repairs that didn't hold */
export class Ladder {
  step = 0;
  at = 0;
  next(now: number): number {
    this.step = this.at && now - this.at < HOLD_MS ? this.step + 1 : 1;
    this.at = now;
    return this.step;
  }
}
