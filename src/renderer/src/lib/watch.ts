// The dock's page tells VyseBar's log when it was held up (a script running long, or its memory
// coming back from disk on a PC short of it) and when one of its scripts failed, so a dock that
// stopped for a moment can be explained afterwards. At most a line a minute of each; an error
// goes with its kind and first words only, paths and links taken out.
let started = false;

export function watchPage(): void {
  if (started) return;
  started = true;
  let worst = 0;
  let sentAt = 0;
  let timer = 0;
  const flush = () => {
    timer = 0;
    if (!worst) return;
    sentAt = Date.now();
    window.vyse.send("dock:slow", Math.round(worst));
    worst = 0;
  };
  try {
    new PerformanceObserver((list) => {
      // the page's first seconds are its scripts loading, not the dock held up
      for (const e of list.getEntries()) if (e.duration >= 300 && e.startTime > 10_000) worst = Math.max(worst, e.duration);
      if (worst && !timer) timer = window.setTimeout(flush, Math.max(0, 60_000 - (Date.now() - sentAt)));
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* no long-task timing in this engine */
  }

  let errAt = 0;
  const report = (what: string) => {
    // Chromium's note about a resize observer is no error of the dock's
    if (/ResizeObserver loop/.test(what) || Date.now() - errAt < 60_000) return;
    errAt = Date.now();
    const clean = what
      .replace(/[A-Za-z]:\\[^\s'"]*/g, "<path>")
      .replace(/\b(file|https?|data|blob):\S+/g, "<link>")
      .slice(0, 200);
    window.vyse.send("dock:error", clean);
  };
  addEventListener("error", (e) => report(`${(e.error as Error | undefined)?.name ?? "Error"}: ${e.message}`));
  addEventListener("unhandledrejection", (e) => report(`unhandled ${(e.reason as Error | undefined)?.name ?? "rejection"}: ${(e.reason as Error | undefined)?.message ?? String(e.reason)}`));
}
