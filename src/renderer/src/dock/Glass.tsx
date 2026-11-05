// Liquid Glass: the screen behind the dock, bent through a lens-shaped edge in a shader -
// not a blur. Cards and frosted tiles get a frosted version of the same picture. The dock
// window is excluded from captures, so it never sees itself.
// The picture is a strip of the screen behind the glass, read by the helper (Grab.cs) and
// scaled down there - about seven times a second while things move, about once a second
// otherwise. (A continuous screen-capture stream used to do this; it cost a third of a CPU
// core and made the whole PC less smooth.) It only draws when the picture changes or
// something on the dock moves, and the canvas covers just the glass, not the whole dock
// window. Lite mode bends the wallpaper instead.
import { useEffect, useRef } from "react";
import type { DockInfo } from "@shared/types";

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const MAX = 24;
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uView;
uniform vec2 uOrigin;
uniform float uDpr;
uniform vec4 uCrop;
uniform float uTop;
uniform float uLeft;
uniform int uCount;
uniform vec4 uRects[${MAX}];
uniform vec4 uMeta[${MAX}];
uniform vec3 uTint;
uniform float uLodBias;
out vec4 outColor;

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// css is a point in the dock window; uCrop is the part of the display the texture holds
vec3 tex(vec2 css, float lod) {
  vec2 uv = (vec2(uLeft + css.x, uTop + css.y) - uCrop.xy) / uCrop.zw;
  uv = clamp(uv, vec2(0.0005), vec2(0.9995));
  return textureLod(uTex, uv, max(lod - uLodBias, 0.0)).rgb;
}

void main() {
  vec2 p = uOrigin + vec2(gl_FragCoord.x, uView.y * uDpr - gl_FragCoord.y) / uDpr;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec4 r = uRects[i];
    vec2 hs = r.zw * 0.5;
    vec2 c = r.xy + hs;
    float rad = min(uMeta[i].x, min(hs.x, hs.y));
    vec2 lp = p - c;
    float d = sdBox(lp, hs, rad);
    if (d > 1.0) continue;
    float alpha = clamp(0.5 - d, 0.0, 1.0) * uMeta[i].w;
    float kind = uMeta[i].y;
    vec2 e = vec2(0.75, 0.0);
    vec2 n = normalize(vec2(
      sdBox(lp + e.xy, hs, rad) - sdBox(lp - e.xy, hs, rad),
      sdBox(lp + e.yx, hs, rad) - sdBox(lp - e.yx, hs, rad)) + 1e-5);
    float inside = -d;
    vec3 col;
    if (kind < 0.5) {
      // the lens: a rounded bezel bends what lies beyond the edge into view
      float bezel = clamp(min(hs.x, hs.y) * 0.62, 6.0, 24.0);
      float t = clamp(1.0 - inside / bezel, 0.0, 1.0);
      float amt = pow(t, 2.4) * bezel * 1.25;
      vec2 q = p - lp * 0.03 + n * amt;
      float ca = 0.10 * amt + 0.25;
      col = vec3(tex(q + n * ca, 0.0).r, tex(q, 0.0).g, tex(q - n * ca, 0.0).b);
      col = mix(col, tex(q, 2.6), 0.22);
    } else {
      float lod = kind < 1.5 ? 4.6 : 3.4;
      vec3 acc = tex(p, lod) * 2.0;
      acc += tex(p + vec2(7.0, 0.0), lod);
      acc += tex(p - vec2(7.0, 0.0), lod);
      acc += tex(p + vec2(0.0, 7.0), lod);
      acc += tex(p - vec2(0.0, 7.0), lod);
      col = acc / 6.0;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.4);
    }
    col = mix(col, uTint, uMeta[i].z);
    // light catching the rim: brightest where the edge faces up and left
    float spec = max(0.0, dot(n, normalize(vec2(-0.5, -1.0))));
    float rim = smoothstep(1.6, 0.0, inside);
    float shine = pow(clamp(1.0 - inside / 12.0, 0.0, 1.0), 3.0) * (0.06 + 0.32 * spec);
    float k = kind < 0.5 ? 1.0 : 0.45;
    col += rim * (0.08 + 0.3 * spec) * k + shine * k;
    outColor = vec4(col * alpha, alpha);
    return;
  }
  outColor = vec4(0.0);
}`;

export type GlassMode = "liquid" | "frost" | "tiles" | "off";

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("no shader (context lost)");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

type Crop = { x: number; y: number; w: number; h: number };

export function Glass({ mode, info, light, live, onFail }: { mode: GlassMode; info: DockInfo | null; light: boolean; live: boolean; onFail?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ mode, info, light, onFail });
  current.current = { mode, info, light, onFail };

  useEffect(() => {
    if (mode === "off" || !info) return;
    const cv = canvas.current!;
    const gl = cv.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "low-power" });
    // no WebGL, or a GPU that gave up: the dock carries on with a solid plate instead of glass
    const fail = (why: string) => {
      console.warn("glass unavailable:", why);
      current.current.onFail?.();
    };
    if (!gl || gl.isContextLost()) return fail("no WebGL 2");
    const prog = gl.createProgram();
    try {
      if (!prog) throw new Error("no program");
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
    } catch (e) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return fail((e as Error).message);
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = { view: U("uView"), origin: U("uOrigin"), dpr: U("uDpr"), crop: U("uCrop"), top: U("uTop"), left: U("uLeft"), count: U("uCount"), rects: U("uRects"), meta: U("uMeta"), tint: U("uTint"), lodBias: U("uLodBias") };
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    let crop: Crop = { x: 0, y: 0, w: info.bounds.width, h: info.bounds.height };
    let lodBias = 0;
    let hasTexture = false;
    let dirty = true;
    let stopped = false;
    let raf = 0;
    let running = false;
    let idleFrames = 0;
    let lastSig = "";
    let lastActivity = performance.now();
    let box = { x: 0, y: 0, w: 0, h: 0 };

    // the loop runs only while something changes, then waits for the next kick
    // tail: how many quiet frames to keep watching for movement before the loop sleeps; a new
    // picture needs just one frame, something on the dock changing may start an animation
    let tail = 20;
    const kick = (frames = 20) => {
      tail = running && idleFrames < tail ? Math.max(tail, frames) : frames;
      idleFrames = 0;
      if (running || stopped) return;
      running = true;
      raf = requestAnimationFrame(draw);
    };

    const upload = (area: Crop, bias: number, src: TexImageSource | { w: number; h: number; data: Uint8Array }) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if ("w" in src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      crop = area;
      lodBias = bias;
      hasTexture = true;
      dirty = true;
      kick(2);
    };

    const useWallpaper = async () => {
      const wp = await window.vyse.invoke<{ url: string; crop: Crop } | null>("dock:wallpaperRegion");
      if (!wp || stopped) return;
      const img = new Image();
      img.onload = () => !stopped && upload(wp.crop, 0, img);
      img.src = wp.url;
    };

    // ---- live: strips of the screen from the helper
    // the liquid lens shows the screen sharp, so it reads at half resolution; frost and
    // tiles are blurred anyway and read at a quarter
    const scale = mode === "liquid" ? 0.5 : 0.25;
    // with nothing moving, the sharp lens looks again about once a second, the blurred kinds less
    const idleGap = mode === "liquid" ? 900 : 1500;
    const winTop = () => {
      const inf = current.current.info;
      return !inf || document.documentElement.dataset.edge === "top" ? 0 : inf.bounds.height - inf.windowHeight;
    };
    let need: { top: number; bottom: number } | null = null; // rows of the dock window the glass covers
    let have: { top: number; bottom: number } | null = null; // rows the texture holds
    let grabbing = false;
    let grabTimer: ReturnType<typeof setTimeout> | null = null;
    let grabDue = 0;
    let released = true;
    let noGlassSince = 0;
    const covered = () => !!need && !!have && need.top >= have.top && need.bottom <= have.bottom;

    const scheduleGrab = (delay: number) => {
      if (stopped || !live) return;
      const due = performance.now() + delay;
      if (grabTimer && grabDue <= due) return;
      if (grabTimer) clearTimeout(grabTimer);
      grabDue = due;
      grabTimer = setTimeout(() => {
        grabTimer = null;
        void grab();
      }, delay);
    };

    // no glass on screen for three seconds (an auto-hidden dock): stop reading the screen
    const releaseGrab = () => {
      need = null;
      if (grabTimer) clearTimeout(grabTimer);
      grabTimer = null;
      if (!released) {
        released = true;
        have = null;
        window.vyse.send("dock:grabRelease");
      }
    };

    const grab = async () => {
      if (stopped || grabbing || !need || document.hidden) return;
      // the draw loop may have gone to sleep since it last saw no glass
      if (noGlassSince && performance.now() - noGlassSince >= 3000) return releaseGrab();
      const want = need;
      grabbing = true;
      try {
        const g = await window.vyse.invoke<{ w: number; h: number; top: number; bottom: number; data: Uint8Array } | null>("dock:grab", { ...want, scale });
        if (stopped) return;
        if (g && g.data.byteLength === g.w * g.h * 4) {
          released = false;
          have = { top: g.top, bottom: g.bottom };
          upload({ x: 0, y: winTop() + g.top, w: innerWidth, h: g.bottom - g.top }, Math.log2(1 / scale), g);
        }
      } catch {
        // the helper restarting; the next round tries again
      } finally {
        grabbing = false;
      }
      if (stopped || !need) return;
      // the glass grew past the strip while that one was on its way: read again now
      scheduleGrab(!covered() ? 0 : performance.now() - lastActivity < 1500 ? 140 : idleGap);
    };

    // the draw loop says which rows of the dock window the glass covers now
    const setNeed = (top: number, bottom: number) => {
      const t = Math.max(0, Math.floor((top - 40) / 64) * 64);
      const b = Math.min(innerHeight, Math.ceil((bottom + 40) / 64) * 64);
      need = { top: t, bottom: Math.max(t + 1, b) };
      noGlassSince = 0;
      if (!live) {
        if (!hasTexture) void useWallpaper();
        return;
      }
      if (!covered()) scheduleGrab(0);
      else if (!grabTimer && !grabbing) scheduleGrab(140);
    };

    // nothing glassy on screen (an auto-hidden dock): stop reading after a while
    const noGlass = () => {
      if (!live) return;
      const now = performance.now();
      if (!noGlassSince) noGlassSince = now;
      if (now - noGlassSince >= 3000) releaseGrab();
    };

    const rects = new Float32Array(MAX * 4);
    const meta = new Float32Array(MAX * 4);

    const draw = () => {
      const { mode: m, info: inf, light: lt } = current.current;
      if (!inf) {
        running = false;
        return;
      }
      const els = document.querySelectorAll<HTMLElement>("[data-glass]");
      let n = 0;
      let sig = "";
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const el of els) {
        if (n >= MAX) break;
        const g = el.dataset.glass;
        let kind = -1;
        let tintA = 0;
        if (g === "dock" && m === "liquid") (kind = 0), (tintA = lt ? 0.12 : 0.2);
        else if (g === "dock" && m === "frost") (kind = 1), (tintA = lt ? 0.5 : 0.42);
        else if (g === "tile" && m === "tiles") (kind = 2), (tintA = lt ? 0.45 : 0.32);
        else if (g === "card") (kind = 1), (tintA = lt ? 0.62 : 0.55);
        if (kind < 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        let opacity = Number(cs.opacity);
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
        if (opacity < 0.01) continue;
        const radius = parseFloat(cs.borderTopLeftRadius) * (r.width / (el.offsetWidth || r.width));
        rects.set([r.left, r.top, r.width, r.height], n * 4);
        meta.set([radius, kind, tintA, opacity], n * 4);
        sig += `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)},${kind},${opacity.toFixed(2)};`;
        x0 = Math.min(x0, r.left);
        y0 = Math.min(y0, r.top);
        x1 = Math.max(x1, r.right);
        y1 = Math.max(y1, r.bottom);
        n++;
      }

      if (n) setNeed(y0, y1);
      else noGlass();

      // the canvas covers the glass's bounds, snapped to a grid so it rarely reallocates
      const dpr = window.devicePixelRatio;
      const snap = 32;
      const nb = { x: 0, y: 0, w: 1, h: 1 };
      if (n) {
        nb.x = Math.max(0, Math.floor(x0 / snap) * snap);
        nb.y = Math.max(0, Math.floor(y0 / snap) * snap);
        nb.w = Math.max(1, Math.min(innerWidth, Math.ceil(x1 / snap) * snap) - nb.x);
        nb.h = Math.max(1, Math.min(innerHeight, Math.ceil(y1 / snap) * snap) - nb.y);
      }
      if (nb.x !== box.x || nb.y !== box.y || nb.w !== box.w || nb.h !== box.h) {
        box = nb;
        cv.style.left = `${box.x}px`;
        cv.style.top = `${box.y}px`;
        cv.style.width = `${box.w}px`;
        cv.style.height = `${box.h}px`;
        dirty = true;
      }
      const W = Math.max(1, Math.round(box.w * dpr));
      const H = Math.max(1, Math.round(box.h * dpr));
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
        dirty = true;
      }

      if (dirty || sig !== lastSig) {
        idleFrames = 0;
        dirty = false;
        lastSig = sig;
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (n && hasTexture) {
          gl.uniform2f(u.view, box.w, box.h);
          gl.uniform2f(u.origin, box.x, box.y);
          gl.uniform1f(u.dpr, dpr);
          gl.uniform4f(u.crop, crop.x, crop.y, crop.w, crop.h);
          gl.uniform1f(u.top, winTop());
          gl.uniform1f(u.left, 0);
          gl.uniform1f(u.lodBias, lodBias);
          gl.uniform1i(u.count, n);
          gl.uniform4fv(u.rects, rects);
          gl.uniform4fv(u.meta, meta);
          gl.uniform3f(u.tint, lt ? 0.97 : 0.07, lt ? 0.97 : 0.07, lt ? 0.98 : 0.09);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      } else if (++idleFrames > tail) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    // anything that restyles the page may move a glass surface
    const mo = new MutationObserver(() => kick());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "data-glass"] });
    const onResize = () => kick();
    window.addEventListener("resize", onResize);
    // the pointer moving or a window changing: read the screen more often for a while
    const offActivity = window.vyse.on("glass:activity", () => {
      lastActivity = performance.now();
      if (need) scheduleGrab(140);
    });
    // a hidden dock (fullscreen game) stops reading the screen altogether
    const onVis = () => {
      if (document.hidden) {
        if (grabTimer) clearTimeout(grabTimer);
        grabTimer = null;
      } else kick();
    };
    document.addEventListener("visibilitychange", onVis);
    // the GPU resetting under us (a driver update, a crash): fall back rather than go see-through
    const onLost = () => !stopped && fail("context lost");
    cv.addEventListener("webglcontextlost", onLost);
    kick();
    return () => {
      stopped = true;
      cv.removeEventListener("webglcontextlost", onLost);
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener("resize", onResize);
      offActivity();
      if (grabTimer) clearTimeout(grabTimer);
      document.removeEventListener("visibilitychange", onVis);
      if (live && !released) window.vyse.send("dock:grabRelease");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [mode, live, info?.displayId, info?.windowHeight]);

  if (mode === "off") return null;
  return <canvas key={`${mode}|${live}|${info?.displayId}|${info?.windowHeight}`} ref={canvas} className="pointer-events-none absolute" style={{ left: 0, top: 0, width: 1, height: 1 }} />;
}
