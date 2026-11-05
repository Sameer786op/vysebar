// The notification area on the dock. With the taskbar hidden, this is the only way to reach the
// tray icons of apps running in the background. Icons Windows keeps on the taskbar sit on the
// tile and the rest (Windows' overflow) open from the chevron. Clicks reach the app just as they
// would from the taskbar: left opens, right asks for the app's own menu.
import { ChevronDown, ChevronUp, Cloud, Gamepad2, MessageCircle } from "lucide-react";
import { host, useTopic } from "../lib/state";
import { CardHeader, Empty } from "../components/ui";
import { useDock, type CardProps, type TileProps, type WidgetDef } from "./types";

export interface TrayIcon {
  key: string;
  tip: string;
  name: string;
  icon: string;
  exe: string | null;
  pinned: boolean;
}

const muted = { color: "var(--fg2)" };
const ON_TILE = 6;
const label = (t: TrayIcon) => t.tip.split(/\r?\n/)[0].trim() || t.name;

function send(t: TrayIcon, button: "left" | "right") {
  void host("trayClick", { key: t.key, button });
}

/** the tile shows what Windows pins to the taskbar, or the first few when nothing is pinned */
function onTile(all: TrayIcon[]): TrayIcon[] {
  const pinned = all.filter((t) => t.pinned);
  return (pinned.length ? pinned : all.slice(0, 3)).slice(0, ON_TILE);
}

function TrayButton({ t, before }: { t: TrayIcon; before?: () => void }) {
  return (
    <button
      title={t.tip || t.name}
      onClick={(e) => {
        e.stopPropagation();
        before?.();
        send(t, "left");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        before?.();
        send(t, "right");
      }}
      className="grid h-[28px] w-[26px] shrink-0 place-items-center rounded-[8px] transition-colors hover:bg-[var(--tile-hover)]"
    >
      <img src={t.icon} alt="" draggable={false} className="h-[16px] w-[16px]" />
    </button>
  );
}

function TrayTile({ preview }: TileProps) {
  const { edge } = useDock();
  const list = useTopic<TrayIcon[]>(preview ? null : "tray");
  const Chevron = edge === "top" ? ChevronDown : ChevronUp;
  if (preview) {
    return (
      <div className="flex h-full items-center gap-0.5 px-1.5">
        {[MessageCircle, Cloud, Gamepad2].map((I, i) => (
          <span key={i} className="grid h-[28px] w-[26px] place-items-center"><I size={15} /></span>
        ))}
        <span className="grid h-[28px] w-[20px] place-items-center" style={muted}><Chevron size={14} /></span>
      </div>
    );
  }
  const all = list ?? [];
  const shown = onTile(all);
  const more = all.length - shown.length;
  return (
    <div className="flex h-full items-center gap-0.5 px-1.5">
      {shown.map((t) => <TrayButton key={t.key} t={t} />)}
      <span title={more > 0 ? `${more} more in the tray` : "All tray icons"} className="flex h-[28px] items-center gap-[1px] rounded-[8px] px-1" style={muted}>
        <Chevron size={14} />
        {more > 0 && <span className="text-[10.5px] font-semibold tabular-nums">{more}</span>}
      </span>
    </div>
  );
}

function TrayCard({ close }: CardProps) {
  const list = useTopic<TrayIcon[]>("tray") ?? [];
  return (
    <div>
      <CardHeader title="System Tray" sub={list.length ? `${list.length} ${list.length === 1 ? "app" : "apps"} in the background` : "Apps running in the background"} />
      {list.length === 0 ? (
        <Empty>No tray icons right now</Empty>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {list.map((t) => (
            <button
              key={t.key}
              title={t.tip || t.name}
              onClick={() => {
                close();
                send(t, "left");
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                close();
                send(t, "right");
              }}
              className="flex min-w-0 flex-col items-center gap-1.5 rounded-[12px] px-1 pb-2 pt-2.5 transition-colors hover:bg-[var(--chip-hover)]"
              style={{ background: "var(--chip)" }}
            >
              <img src={t.icon} alt="" draggable={false} className="h-[20px] w-[20px]" />
              <span className="w-full truncate text-center text-[10.5px] leading-tight" style={muted}>{label(t)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 text-[11px]" style={muted}>Click to open · right-click for the app's menu</div>
    </div>
  );
}

export const trayWidgets: WidgetDef[] = [
  {
    type: "tray", name: "System Tray", category: "System", single: true,
    description: "Tray icons of apps running in the background (Discord, OneDrive, Steam...). Click to open, right-click for the app's menu.",
    Tile: TrayTile, Card: TrayCard, cardWidth: 330,
  },
];
