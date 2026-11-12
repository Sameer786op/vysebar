import { app, Menu, powerMonitor, session } from "electron";
import { host } from "./host";
import { flushAll, settings } from "./store";
import { registerTopicIpc } from "./topics";
import { importTaskbarPins, initApps } from "./apps";
import { applyLoginItem, LOGIN_FLAG, registerIpc } from "./ipc";
import { initSystemTopics } from "./services/system";
import { initOnlineTopics } from "./services/online";
import { initLocalTopics } from "./services/local";
import { initAccountTopics } from "./services/accounts";
import { initAutomations } from "./services/automations";
import { initGoogle } from "./services/google";
import { openSettings } from "./windows";
import { applyEngineFlags, initMemoryTrim, memoryNote } from "./perf";
import { allDocks, freshDocks, initDocks } from "./docks";
import { initUpdates } from "./updater";
import { initLog, log, logNow } from "./log";

initLog();

if (!app.requestSingleInstanceLock()) {
  log("another VyseBar is already running: this one steps aside");
  app.quit();
} else {
  app.setAppUserModelId("app.vysebar");
  // the dock animates while you work in other apps; it must not be throttled as "hidden"
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  applyEngineFlags();
  // for development: lets tooling inspect and screenshot the dock page
  if (!app.isPackaged && process.env.VYSE_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.VYSE_DEBUG_PORT);

  // opening VyseBar again while it runs shows Settings, and starts the dock afresh: it's what
  // you reach for when the dock has stopped working. Windows starting it at sign-in after you
  // already had, or a restart after an update or a hang, is not you asking for anything
  app.on("second-instance", (_e, argv) => {
    const flag = argv.find((a) => a === LOGIN_FLAG || a === "--updated" || a === "--recovered");
    if (flag) return log(`started again (${flag}) while running: nothing to open`);
    void freshDocks("VyseBar was opened again while it ran");
    openSettings();
  });
  // no application menu: its keys (reload, zoom, developer tools) would reach a dock card that
  // has the keyboard, and VyseBar's windows have no menu bar
  Menu.setApplicationMenu(null);

  // Windows shutting down, restarting or signing out doesn't quit apps the normal way: save
  // anything still waiting the moment Windows asks, before it ends the process
  app.on("browser-window-created", (_e, win) => {
    win.on("query-session-end", () => flushAll());
    win.on("session-end", () => {
      logNow("Windows is signing out or shutting down");
      flushAll();
    });
  });
  app.on("will-quit", () => flushAll());

  // one part failing to start (a widget's feed, the updater) must not cost the whole dock
  const step = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      log(`starting ${name} failed: ${(e as Error)?.stack ?? String(e)}`.slice(0, 1500));
    }
  };

  app.whenReady().then(async () => {
    // nothing in VyseBar's pages needs a camera, microphone or screen (the glass reads the
    // screen through the helper), so every permission request is turned down
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    step("the helper", () => host.start());
    step("the feeds", registerTopicIpc);
    step("the commands", registerIpc);
    step("system feeds", initSystemTopics);
    step("online feeds", initOnlineTopics);
    step("local feeds", initLocalTopics);
    step("accounts", initAccountTopics);
    step("Google", initGoogle);
    step("apps", initApps);
    step("automations", initAutomations);

    if (settings.value.firstRun) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5000);
        host.once("ready", () => {
          clearTimeout(t);
          resolve();
        });
      });
      // the taskbar's pins are a bonus: the dock comes up with or without them
      const pins = await importTaskbarPins().catch((e) => {
        log(`importing the taskbar's pins failed: ${(e as Error)?.message ?? e}`);
        return settings.value.pins;
      });
      settings.set({ pins, firstRun: false });
    }

    initDocks();
    log(`ready: ${allDocks().length} dock${allDocks().length === 1 ? "" : "s"}`);
    step("memory trim", () => initMemoryTrim(allDocks));
    step("start with Windows", () => applyLoginItem());
    step("updates", initUpdates);
    watchMainThread();
  });

  // put the Windows taskbar back before quitting, and wait for it
  let cleaned = false;
  let deadline: NodeJS.Timeout | null = null;
  app.on("before-quit", (e) => {
    // whatever happens on the way out (a page that doesn't close), VyseBar is gone within a
    // few seconds of Quit
    deadline ??= setTimeout(() => {
      logNow("quitting took too long: leaving now");
      flushAll();
      host.stop();
      app.exit(0);
    }, 6000);
    if (cleaned) return;
    e.preventDefault();
    flushAll();
    void Promise.race([host.try("restoreTaskbar"), new Promise((r) => setTimeout(r, 1500))]).then(() => {
      cleaned = true;
      host.stop();
      app.quit();
    });
  });

  app.on("window-all-closed", () => {
    /* the dock is the app; Settings closing doesn't quit it */
  });
}

// VyseBar's own thread being held up shows as a dock that doesn't answer (and a pointer that
// stutters): the log says when and for how long, so a freeze can be traced afterwards
function watchMainThread(): void {
  const EVERY = 250;
  let last = Date.now();
  let worst = 0;
  let reportedAt = 0;
  powerMonitor.on("resume", () => (last = Date.now()));
  setInterval(() => {
    const now = Date.now();
    const late = now - last - EVERY;
    last = now;
    // half a second is a hover or click you notice; minutes late is a PC that slept
    if (late >= 500 && late <= 120_000) worst = Math.max(worst, late);
    // at most a line a minute; one held back goes in once the minute is over
    if (!worst || now - reportedAt < 60_000) return;
    reportedAt = now;
    log(`VyseBar's main thread was held up ${(worst / 1000).toFixed(1)} s${memoryNote()}`);
    worst = 0;
  }, EVERY);
}
