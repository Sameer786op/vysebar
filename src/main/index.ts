import { app, session } from "electron";
import { host } from "./host";
import { flushAll, settings } from "./store";
import { registerTopicIpc } from "./topics";
import { importTaskbarPins, initApps } from "./apps";
import { applyLoginItem, registerIpc } from "./ipc";
import { initSystemTopics } from "./services/system";
import { initOnlineTopics } from "./services/online";
import { initLocalTopics } from "./services/local";
import { initAccountTopics } from "./services/accounts";
import { initAutomations } from "./services/automations";
import { initGoogle } from "./services/google";
import { openSettings } from "./windows";
import { applyEngineFlags, initMemoryTrim } from "./perf";
import { allDocks, initDocks } from "./docks";
import { initUpdates } from "./updater";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("app.vysebar");
  // the dock animates while you work in other apps; it must not be throttled as "hidden"
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  applyEngineFlags();
  // for development: lets tooling inspect and screenshot the dock page
  if (!app.isPackaged && process.env.VYSE_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.VYSE_DEBUG_PORT);

  app.on("second-instance", () => openSettings());

  // Windows shutting down, restarting or signing out doesn't quit apps the normal way: save
  // anything still waiting the moment Windows asks, before it ends the process
  app.on("browser-window-created", (_e, win) => {
    win.on("query-session-end", () => flushAll());
    win.on("session-end", () => flushAll());
  });
  app.on("will-quit", () => flushAll());

  app.whenReady().then(async () => {
    // nothing in VyseBar's pages needs a camera, microphone or screen (the glass reads the
    // screen through the helper), so every permission request is turned down
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    host.start();
    registerTopicIpc();
    registerIpc();
    initSystemTopics();
    initOnlineTopics();
    initLocalTopics();
    initAccountTopics();
    initGoogle();
    initApps();
    initAutomations();

    if (settings.value.firstRun) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5000);
        host.once("ready", () => {
          clearTimeout(t);
          resolve();
        });
      });
      const pins = await importTaskbarPins();
      settings.set({ pins, firstRun: false });
    }

    initDocks();
    initMemoryTrim(allDocks);
    applyLoginItem();
    initUpdates();
  });

  // put the Windows taskbar back before quitting, and wait for it
  let cleaned = false;
  app.on("before-quit", (e) => {
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
