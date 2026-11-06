// The accent colour taken from the cover of what's playing: the most vivid colour that covers
// a fair part of it, toned so white text and controls stay readable on it.
import { useEffect, useState } from "react";
import type { MediaState } from "@shared/types";
import { useTopic } from "./state";

const cache = new Map<string, string | null>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

function vivid(img: HTMLImageElement): string | null {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, 32, 32);
  const px = g.getImageData(0, 0, 32, 32).data;
  // hue buckets of 15°, each weighted by how colourful its pixels are
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s < 0.25 || l < 0.12 || l > 0.9) continue;
    const w = s * (1 - Math.abs(l - 0.5) * 1.4);
    const b = buckets[Math.floor(h / 15) % 24];
    b.w += w;
    b.h += h * w;
    b.s += s * w;
    b.l += l * w;
  }
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  // a mostly grey or black-and-white cover has no colour worth taking
  if (best.w < 6) return null;
  const s = Math.min(0.85, Math.max(0.5, best.s / best.w));
  const l = Math.min(0.58, Math.max(0.46, best.l / best.w));
  return hsl(best.h / best.w, s, l);
}

/** the cover's colour while something with a cover is playing (or paused); null otherwise */
export function useAlbumColor(enabled: boolean): string | null {
  const media = useTopic<MediaState | null>(enabled ? "media" : null);
  const thumb = enabled && media && media.status !== "closed" && media.status !== "stopped" ? media.thumb : null;
  const [color, setColor] = useState<string | null>(thumb ? (cache.get(thumb) ?? null) : null);
  useEffect(() => {
    if (!thumb) return setColor(null);
    if (cache.has(thumb)) return setColor(cache.get(thumb)!);
    let off = false;
    const img = new Image();
    img.onload = () => {
      let c: string | null = null;
      try {
        c = vivid(img);
      } catch {
        /* a cover from another site that the canvas can't read */
      }
      if (cache.size > 50) cache.clear();
      cache.set(thumb, c);
      if (!off) setColor(c);
    };
    img.onerror = () => !off && setColor(null);
    img.src = thumb;
    return () => {
      off = true;
    };
  }, [thumb]);
  return color;
}
