// Whatever is playing in any app (Spotify, a browser tab, Vyse Music...), the speakers and each app's volume.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Headphones, Music2, Pause, Play, SkipBack, SkipForward, Speaker, Volume1, Volume2, VolumeX } from "lucide-react";
import type { MediaState } from "@shared/types";
import { host, useNow, useTopic } from "../lib/state";
import { CardHeader, Empty, Slider } from "../components/ui";
import type { CardProps, WidgetDef } from "./types";

const stop = (e: React.MouseEvent) => e.stopPropagation();

interface Volume { volume: number; muted: boolean; device: string; id: string }
interface MixerApp { pid: number; name: string | null; exe: string | null; volume: number; muted: boolean; active: boolean }

const control = (action: string, seconds?: number) => void host("mediaControl", { action, seconds });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function useMedia() {
  const m = useTopic<MediaState | null>("media");
  const playing = m?.status === "playing";
  const now = useNow(playing ? 500 : 10_000);
  const has = !!m && !!m.title;
  let pos = m?.position ?? 0;
  if (playing && m?.updatedAt) pos += (now - m.updatedAt) / 1000;
  const dur = m?.duration ?? 0;
  return { m: has ? m : null, playing, pos: dur ? Math.min(dur, pos) : pos, dur };
}

function Artwork({ m, size, radius = 9 }: { m: MediaState | null; size: number; radius?: number }) {
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width: size, height: size, borderRadius: radius, background: "linear-gradient(150deg,#ff375f,#bf5af2)" }}>
      <AnimatePresence mode="popLayout">
        {m?.thumb ? (
          <motion.img key={m.thumb.slice(-40)} src={m.thumb} className="absolute inset-0 h-full w-full object-cover" initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-white/90"><Music2 size={size * 0.45} /></div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** three bars that dance while something plays */
export function Equalizer({ playing, color = "var(--accent)", size = 12 }: { playing: boolean; color?: string; size?: number }) {
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height: size }}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`w-[2.5px] rounded-full ${playing ? "eq-bar" : ""}`} style={{ background: color, height: playing ? "100%" : 3, animationDelay: `${i * -0.3}s` }} />
      ))}
    </span>
  );
}

function CtlButton({ onClick, children, size = 28, disabled, primary }: { onClick: () => void; children: React.ReactNode; size?: number; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={(e) => {
        stop(e);
        onClick();
      }}
      className="grid shrink-0 place-items-center rounded-full transition-all hover:bg-[var(--chip-hover)] active:scale-85 disabled:opacity-30"
      style={{ width: size, height: size, background: primary ? "var(--fg)" : undefined, color: primary ? "var(--card-solid)" : "var(--fg)" }}
    >
      {children}
    </button>
  );
}

// ---------- tiles ----------

function NowPlayingTile() {
  const { m, playing, pos, dur } = useMedia();
  if (!m) {
    return (
      <div className="flex h-full items-center gap-2 pl-[6px] pr-3.5" title="Play something in any app">
        <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]" style={{ background: "var(--chip)", color: "var(--fg2)" }}>
          <Music2 size={14} />
        </div>
        <span className="text-[12px] font-medium" style={{ color: "var(--fg2)" }}>Not playing</span>
      </div>
    );
  }
  return (
    <div className="relative flex h-full items-center gap-2.5 py-[5px] pl-[5px] pr-2" style={{ width: 236 }}>
      <Artwork m={m} size={32} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold">{m.title}</span>
        </span>
        <span className="truncate text-[10.5px]" style={{ color: "var(--fg2)" }}>{m.artist || m.appName}</span>
        {dur > 0 && (
          <div className="mt-[4px] h-[2.5px] overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
            <div className="h-full rounded-full" style={{ width: `${(pos / dur) * 100}%`, background: "var(--fg2)", transition: "width 0.5s linear" }} />
          </div>
        )}
      </div>
      <CtlButton onClick={() => control("toggle")}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-[1px]" />}</CtlButton>
      <CtlButton onClick={() => control("next")} disabled={!m.canNext}><SkipForward size={14} fill="currentColor" /></CtlButton>
    </div>
  );
}

function NowPlayingCompactTile() {
  const { m, playing } = useMedia();
  return (
    <div className="flex h-full items-center gap-2 pl-3 pr-1.5" style={{ maxWidth: 210 }}>
      <Equalizer playing={playing} />
      <span className="min-w-0 truncate text-[12px] font-semibold">{m ? `${m.title}${m.artist ? " · " + m.artist : ""}` : "Not Playing"}</span>
      <CtlButton onClick={() => control("toggle")} size={26}>{playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</CtlButton>
    </div>
  );
}

function MiniPlayerTile() {
  const { m, playing } = useMedia();
  return (
    <div className="group relative grid h-full place-items-center px-[5px]">
      <Artwork m={m} size={36} />
      <button
        onClick={(e) => {
          stop(e);
          control("toggle");
        }}
        className="absolute inset-[5px] grid place-items-center rounded-[9px] bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
      >
        {playing ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" />}
      </button>
    </div>
  );
}

function MusicBarTile() {
  const { m, playing } = useMedia();
  return (
    <div className="flex h-full items-center gap-1 pl-1.5 pr-3">
      <CtlButton onClick={() => control("prev")} size={26} disabled={!m?.canPrev}><SkipBack size={13} fill="currentColor" /></CtlButton>
      <CtlButton onClick={() => control("toggle")} size={30}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</CtlButton>
      <CtlButton onClick={() => control("next")} size={26} disabled={!m?.canNext}><SkipForward size={13} fill="currentColor" /></CtlButton>
      <div className="ml-1 flex min-w-0 max-w-[150px] flex-col leading-tight">
        <span className="truncate text-[12px] font-semibold">{m?.title ?? "Not Playing"}</span>
        {m?.artist && <span className="truncate text-[10.5px]" style={{ color: "var(--fg2)" }}>{m.artist}</span>}
      </div>
    </div>
  );
}

// ---------- the player card ----------

function NowPlayingCard(_: CardProps) {
  const { m, playing, pos, dur } = useMedia();
  const vol = useTopic<Volume>("volume");
  const [seek, setSeek] = useState<number | null>(null);
  if (!m) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <Artwork m={null} size={88} radius={18} />
        <div className="mt-3 text-[14px] font-semibold">Nothing is playing</div>
        <div className="mt-1 text-[12px]" style={{ color: "var(--fg2)" }}>Start music or a video in any app and it shows up here.</div>
      </div>
    );
  }
  return (
    <div className="relative -m-4 overflow-hidden p-4">
      {m.thumb && <img src={m.thumb} className="pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover opacity-30 blur-3xl" />}
      <div className="relative">
        <div className="flex gap-3.5">
          <motion.div animate={{ scale: playing ? 1 : 0.92 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="shadow-[0_10px_30px_rgb(0_0_0/0.35)]" style={{ borderRadius: 16 }}>
            <Artwork m={m} size={96} radius={16} />
          </motion.div>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>
              {m.appIcon && <img src={m.appIcon} className="h-3.5 w-3.5" />}
              {m.appName}
              <span className="ml-auto"><Equalizer playing={playing} /></span>
            </div>
            <div className="mt-1 line-clamp-2 text-[16px] font-semibold leading-snug">{m.title}</div>
            <div className="truncate text-[13px]" style={{ color: "var(--fg2)" }}>{m.artist}{m.album ? ` — ${m.album}` : ""}</div>
          </div>
        </div>
        {dur > 0 && (
          <div className="mt-4">
            <Slider value={seek ?? pos} max={dur} step={1} height={6} onChange={setSeek} onCommit={(v) => { setSeek(null); if (m.canSeek) control("seek", v); }} />
            <div className="tabular mt-1 flex justify-between text-[10.5px]" style={{ color: "var(--fg2)" }}>
              <span>{mmss(seek ?? pos)}</span>
              <span>-{mmss(Math.max(0, dur - (seek ?? pos)))}</span>
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center justify-center gap-5">
          <CtlButton onClick={() => control("prev")} size={40} disabled={!m.canPrev}><SkipBack size={20} fill="currentColor" /></CtlButton>
          <CtlButton onClick={() => control("toggle")} size={52} primary>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-[2px]" />}</CtlButton>
          <CtlButton onClick={() => control("next")} size={40} disabled={!m.canNext}><SkipForward size={20} fill="currentColor" /></CtlButton>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <button onClick={() => void host("setVolume", { muted: !vol?.muted })} style={{ color: "var(--fg2)" }}>{vol?.muted ? <VolumeX size={15} /> : <Volume1 size={15} />}</button>
          <Slider value={vol?.muted ? 0 : vol?.volume ?? 0} height={6} onCommit={(v) => void host("setVolume", { volume: v, muted: false })} />
          <Volume2 size={15} style={{ color: "var(--fg2)" }} />
        </div>
      </div>
    </div>
  );
}

// ---------- sound output ----------

const deviceIcon = (name: string, size = 15) => (/head|buds|airpods|wh-|wf-|earphone/i.test(name) ? <Headphones size={size} /> : <Speaker size={size} />);

function VolumeTile() {
  const vol = useTopic<Volume>("volume");
  return (
    <div className="flex h-full w-[160px] items-center px-3" onClick={stop}>
      <Slider value={vol?.muted ? 0 : vol?.volume ?? 0} onCommit={(v) => void host("setVolume", { volume: v, muted: false })} icon={vol?.muted || !vol?.volume ? <VolumeX size={14} /> : <Volume2 size={14} />} height={26} />
    </div>
  );
}

function AudioOutputTile() {
  const vol = useTopic<Volume>("volume");
  return (
    <div className="flex h-full items-center gap-2.5 px-3" style={{ maxWidth: 200 }}>
      <div className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-full" style={{ background: "var(--chip)" }}>{deviceIcon(vol?.device ?? "")}</div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12px] font-semibold">{vol?.device ?? "Speakers"}</span>
        <span className="tabular text-[10.5px]" style={{ color: "var(--fg2)" }}>{vol?.muted ? "Muted" : `${vol?.volume ?? 0}%`}</span>
      </div>
    </div>
  );
}

function AudioOutputCard(_: CardProps) {
  const vol = useTopic<Volume>("volume");
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [mixer, setMixer] = useState<(MixerApp & { icon?: string })[]>([]);
  useEffect(() => {
    let off = false;
    const load = async () => {
      const [d, mx] = await Promise.all([host<{ id: string; name: string }[]>("audioDevices"), host<MixerApp[]>("mixer")]);
      if (off) return;
      setDevices(d ?? []);
      const withIcons = await Promise.all((mx ?? []).map(async (a) => ({ ...a, icon: a.exe ? await window.vyse.invoke<string | undefined>("icon", a.exe, 32) : undefined })));
      if (!off) setMixer(withIcons);
    };
    void load();
    const t = setInterval(load, 3000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [vol?.id]);
  return (
    <div>
      <CardHeader title="Sound" right={<button onClick={() => window.vyse.invoke("open:url", "ms-settings:sound")} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Sound settings</button>} />
      <div className="flex items-center gap-2.5 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
        <button onClick={() => void host("setVolume", { muted: !vol?.muted })}>{vol?.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <Slider value={vol?.muted ? 0 : vol?.volume ?? 0} onCommit={(v) => void host("setVolume", { volume: v, muted: false })} height={8} />
        <span className="tabular w-[34px] text-right text-[12px] font-semibold">{vol?.volume ?? 0}%</span>
      </div>
      <div className="mt-3 text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>Output</div>
      <div className="mt-1 space-y-0.5">
        {devices.map((d) => (
          <button key={d.id} onClick={() => void host("setAudioDevice", { id: d.id })} className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--chip)]">
            <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: d.id === vol?.id ? "var(--accent)" : "var(--chip)", color: d.id === vol?.id ? "white" : "var(--fg)" }}>{deviceIcon(d.name, 14)}</span>
            <span className="flex-1 truncate text-[12.5px]">{d.name}</span>
            {d.id === vol?.id && <Check size={14} style={{ color: "var(--accent)" }} />}
          </button>
        ))}
      </div>
      {mixer.length > 0 && (
        <>
          <div className="mt-3 text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>Apps</div>
          <div className="mt-1.5 space-y-2">
            {mixer.map((a) => (
              <div key={a.pid} className="flex items-center gap-2.5">
                {a.icon ? <img src={a.icon} className="h-6 w-6" /> : <span className="h-6 w-6 rounded-md bg-[var(--chip)]" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-[11.5px] font-medium">{a.name ?? a.exe}{a.active && <Equalizer playing size={9} />}</div>
                  <Slider value={a.muted ? 0 : a.volume} height={6} className="mt-1" onCommit={(v) => void host("setAppVolume", { pid: a.pid, volume: v, muted: false }).then(() => setMixer((l) => l.map((x) => (x.pid === a.pid ? { ...x, volume: v, muted: false } : x))))} />
                </div>
                <button onClick={() => void host("setAppVolume", { pid: a.pid, muted: !a.muted }).then(() => setMixer((l) => l.map((x) => (x.pid === a.pid ? { ...x, muted: !a.muted } : x))))} style={{ color: a.muted ? "#ff453a" : "var(--fg2)" }}>
                  {a.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {!devices.length && <Empty>Looking for speakers...</Empty>}
    </div>
  );
}

export const mediaWidgets: WidgetDef[] = [
  { type: "nowPlaying", name: "Now Playing", category: "Media & Audio", description: "Artwork, title and controls for whatever is playing - Spotify, YouTube, any app.", Tile: NowPlayingTile, Card: NowPlayingCard, cardWidth: 340 },
  { type: "nowPlayingCompact", name: "Now Playing Compact", category: "Media & Audio", description: "The song on one line, with a dancing equalizer.", Tile: NowPlayingCompactTile, Card: NowPlayingCard, cardWidth: 340 },
  { type: "miniPlayer", name: "Mini Player", category: "Media & Audio", description: "Just the artwork; hover to pause.", Tile: MiniPlayerTile, Card: NowPlayingCard, cardWidth: 340 },
  { type: "musicBar", name: "Music Controls", category: "Media & Audio", description: "Previous, play and next with the song beside them.", Tile: MusicBarTile, Card: NowPlayingCard, cardWidth: 340 },
  { type: "volume", name: "Volume", category: "Media & Audio", description: "A volume slider on the bar; scroll over it to adjust.", Tile: VolumeTile },
  { type: "audioOutput", name: "Sound Output", category: "Media & Audio", description: "Switch speakers and headphones, and set each app's volume.", Tile: AudioOutputTile, Card: AudioOutputCard, cardWidth: 340 },
];
