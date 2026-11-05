// The widget picker: every widget live, on a strip of your own dock style; click to add or remove.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, KeyRound, Plus, Search } from "lucide-react";
import type { WidgetInstance } from "@shared/types";
import { providerById } from "@shared/accounts";
import { setSettings, uid, useSettings } from "../lib/state";
import { CATEGORIES, DockContext, type Category, type DockApi, type WidgetDef } from "../widgets/types";
import { WIDGETS } from "../widgets/registry";
import { lookOf } from "../dock/Dock";

const previewApi: DockApi = {
  edge: "bottom",
  preview: true,
  light: false,
  openCard: () => {},
  hoverCard: () => {},
  closeCard: () => {},
  cardUid: null,
  openMenu: () => {},
  justDragged: () => false,
  markDragged: () => {},
  tile: 44,
};

export function useWallpaper(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void window.vyse.invoke<string | null>("dock:wallpaper").then(setUrl);
  }, []);
  return url;
}

/** one widget on a slice of dock, over the wallpaper */
export function TilePreview({ def, wallpaper, height = 104 }: { def: WidgetDef; wallpaper: string | null; height?: number }) {
  const s = useSettings();
  const look = lookOf(s);
  const glassy = look.glass !== "off";
  const inst = useMemo<WidgetInstance>(() => ({ uid: "preview-" + def.type, type: def.type }), [def.type]);
  return (
    <div
      className="relative grid place-items-center overflow-hidden rounded-[14px]"
      style={{ height, background: wallpaper ? `center/cover url(${wallpaper})` : "linear-gradient(135deg,#3a4f7a,#7a4f8a)" }}
    >
      <div className={look.light ? "theme-light" : "theme-dark"} style={{ "--tile": look.tile } as React.CSSProperties}>
        <div
          className="pointer-events-none flex items-center rounded-[16px] p-[4px]"
          style={{
            background: glassy ? (look.light ? "rgb(255 255 255 / 0.35)" : "rgb(30 30 34 / 0.35)") : look.plate,
            backdropFilter: glassy ? "blur(18px) saturate(1.6)" : undefined,
            boxShadow: look.shadow === "none" ? undefined : `${look.shadow}, inset 0 0 0 1px ${look.border}`,
            color: "var(--fg)",
          }}
        >
          <div
            className="overflow-hidden"
            style={{
              height: 44,
              borderRadius: 13,
              background: def.plain ? undefined : look.glass === "tiles" ? "rgb(30 30 34 / 0.35)" : look.rest,
              backdropFilter: look.glass === "tiles" && !def.plain ? "blur(18px) saturate(1.6)" : undefined,
            }}
          >
            <DockContext.Provider value={{ ...previewApi, light: look.light }}>
              <def.Tile inst={inst} preview />
            </DockContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Picker() {
  const s = useSettings();
  const [cat, setCat] = useState<Category | "All">("All");
  const [q, setQ] = useState("");
  const wallpaper = useWallpaper();
  useEffect(() => {
    document.documentElement.classList.add("theme-dark");
    document.title = "Widgets";
  }, []);

  const inDock = (type: string) => s.widgets.filter((w) => w.type === type);
  const toggle = (def: WidgetDef) => {
    const have = inDock(def.type);
    if (have.length) setSettings({ widgets: s.widgets.filter((w) => w.type !== def.type) });
    else setSettings({ widgets: [...s.widgets, { uid: uid(), type: def.type }] });
  };

  const list = WIDGETS.filter((w) => (cat === "All" || w.category === cat) && (!q.trim() || `${w.name} ${w.description} ${w.category}`.toLowerCase().includes(q.trim().toLowerCase())));
  const counts = new Map(CATEGORIES.map((c) => [c, WIDGETS.filter((w) => w.category === c).length]));

  return (
    <div className="flex h-full" style={{ color: "var(--fg)", background: "rgb(24 24 28 / 0.55)" }}>
      <aside className="flex w-[230px] shrink-0 flex-col border-r pt-[52px]" style={{ borderColor: "var(--line)", background: "rgb(0 0 0 / 0.18)" }}>
        <div className="px-4 [-webkit-app-region:drag]">
          <div className="text-[20px] font-bold">Widgets</div>
          <div className="mt-0.5 text-[12px]" style={{ color: "var(--fg2)" }}>{s.widgets.length} on your dock</div>
        </div>
        <div className="mx-3 mt-4 flex items-center gap-2 rounded-[10px] px-2.5 py-1.5" style={{ background: "var(--chip)" }}>
          <Search size={14} style={{ color: "var(--fg2)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg3)]" />
        </div>
        <nav className="thin-scroll mt-3 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-[7px] text-left text-[13px] transition-colors"
              style={{ background: cat === c ? "var(--accent)" : undefined, color: cat === c ? "white" : "var(--fg)" }}
            >
              <span>{c}</span>
              <span className="text-[11px] opacity-60">{c === "All" ? WIDGETS.length : counts.get(c)}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col pt-[52px]">
        <div className="flex items-end justify-between px-6 pb-3 [-webkit-app-region:drag]">
          <div>
            <div className="text-[18px] font-semibold">{cat === "All" ? "All widgets" : cat}</div>
            <div className="text-[12px]" style={{ color: "var(--fg2)" }}>Click a widget to add it to the dock. Drag tiles on the dock to reorder, or off it to remove.</div>
          </div>
        </div>
        <div className="thin-scroll flex-1 overflow-y-auto px-6 pb-8">
          <motion.div layout className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
            <AnimatePresence initial={false}>
              {list.map((def) => {
                const added = inDock(def.type).length > 0;
                const needsAccount = def.account && !accountSet(def, s);
                return (
                  <motion.button
                    layout
                    key={def.type}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    whileHover={{ y: -2 }}
                    onClick={() => toggle(def)}
                    className="group rounded-[18px] p-2 text-left transition-colors"
                    style={{ background: added ? "rgb(10 132 255 / 0.12)" : "var(--chip)", outline: added ? "1.5px solid var(--accent)" : "1px solid transparent" }}
                  >
                    <TilePreview def={def} wallpaper={wallpaper} />
                    <div className="flex items-start gap-2 px-1.5 pb-1 pt-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                          {def.name}
                          {needsAccount && <span title={providerById(def.account!) ? `Connect ${providerById(def.account!)!.name} from its card or Settings › Accounts` : `Needs your ${def.account} in Settings › Accounts`}><KeyRound size={12} style={{ color: "#ff9f0a" }} /></span>}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug" style={{ color: "var(--fg2)" }}>{def.description}</div>
                      </div>
                      <span className="mt-0.5 grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full transition-colors" style={{ background: added ? "var(--accent)" : "var(--chip-hover)", color: added ? "white" : "var(--fg)" }}>
                        {added ? <Check size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={2.5} />}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </motion.div>
          {!list.length && <div className="py-16 text-center text-[13px]" style={{ color: "var(--fg2)" }}>No widgets match “{q}”</div>}
        </div>
      </main>
    </div>
  );
}

function accountSet(def: WidgetDef, s: ReturnType<typeof useSettings>): boolean {
  const a = s.accounts;
  const spec = def.account ? providerById(def.account) : undefined;
  if (spec) return spec.fields.every((f) => s.providers[spec.id]?.[f.key]);
  if (def.account === "GitHub token") return !!a.githubToken;
  if (def.account?.startsWith("GitHub")) return !!a.githubUser;
  if (def.account?.startsWith("Stripe")) return !!a.stripeKey;
  if (def.account?.startsWith("Finnhub")) return !!a.finnhubKey;
  return true;
}
