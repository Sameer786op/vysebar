# VyseBar

A smart dock for Windows 10 and 11 that replaces the taskbar. Your apps sit on the left, live
widgets sit on the right, and every widget opens a card with more detail when you click it. It
runs on 32-bit and low-end PCs too, in a lite mode that idles at about 50 MB of RAM.

## Install

Download the installer for your Windows from the
[latest release](https://github.com/Sameer786op/vysebar/releases/latest):

| Installer | For |
| --- | --- |
| `VyseBar-Setup-<version>-x64.exe` | 64-bit Windows 10 or 11 (almost every PC from the last decade) |
| `VyseBar-Setup-<version>-ia32.exe` | 32-bit Windows 10 |

Not sure? **Settings → System → About → System type** says "64-bit" or "32-bit". Both install
for your user only (no admin prompt), add Start menu and desktop shortcuts and start VyseBar when
they finish.

The installer isn't code-signed, so SmartScreen may say "Windows protected your PC". Click
**More info → Run anyway**.

You only install once. VyseBar updates itself from this repository's releases: it checks a little
after it starts and every few hours, downloads a new version in the background and installs it
(a few seconds, then it's back). An update found when your PC starts goes in straight away; one
found later waits for **Restart now** on its alert, **Settings → General**, or the next start.
Your settings, widgets and pins are kept in `%APPDATA%\VyseBar` and an update never touches them.

When VyseBar is running, the Windows taskbar is hidden (or set to auto-hide, if you pick that in
**Settings → Dock**). It comes back when you quit VyseBar, and also if VyseBar crashes or is
killed: the small native helper notices and restores it.

## Using it

- **Apps.** Start, your pinned apps, then anything else that's running. Click to open or switch,
  click again to minimise; middle-click or Shift-click opens a new window, and Ctrl-click steps
  through an app's windows. Hover a running app for window previews: rest on one to peek at that
  window full size (the others turn to glass, as on the taskbar), and middle-click one to close
  it. Right-click to pin, unpin, group pins into a folder, close windows or end
  the task. Drag tiles to reorder them, drag a pin off the dock to unpin it, and drop files on
  the apps to pin them. Dragging a file over an open app brings its window up so you can drop it
  there.
- **Folder stacks.** A folder pinned to the dock fans out as a stack of what's inside when you
  click it: open a file from there, or go into a subfolder without leaving the stack.
  Shift-click opens the folder in File Explorer instead. The **Folder** widget does the same on
  the widget side of the dock, and you can add as many as you like.
- **Jump lists.** Right-click an app for what the taskbar's jump list shows: its recent files
  (opened in that app), its own lists (a browser's recently closed tabs) and its Tasks, such as
  **New Incognito window** or a messaging app's chats. File Explorer lists your Quick access
  folders.
- **Taskbar keys.** While VyseBar replaces the taskbar, **Win+1** to **Win+9** (and **Win+0**)
  open the apps on the dock in the order you see them: open, switch to, or minimise if it's
  already in front, and each press moves on to the app's next window. Add **Shift** for a new
  window, **Ctrl** for the window you used last, or **Alt** for its right-click menu. Without this,
  Windows would open its own taskbar's pins, in its own order. **Win+T** works as on the taskbar
  too: it highlights the first app, and pressing it again or the arrow keys move along the dock;
  **Up** (**Down** on a dock at the top) or **Tab** goes into the app's window previews to pick
  one, **Enter** opens what's highlighted and **Esc** lets go. **Settings → Dock → Taskbar keys** turns
  these off.
- **Alt+T** opens the To-do card from any app, ready to type into; press it again to close it.
  **Settings → Dock** turns it off.
- **Moving and sizing.** Drag the dock by an empty spot to the top or bottom of the screen.
  **Settings → Dock** has Small, Medium and Large sizes and a slider in between. If you add more
  widgets than fit, the dock shrinks to stay on screen.
- **More than one screen.** **Settings → Dock → Show on** puts the dock on the main display, on
  every display, or picks **Follow pointer**: one dock that moves to another screen when you hold
  the pointer against that screen's bottom (or top) edge for a moment. It remembers the screen it
  went to, by name and place, after a restart.
- **System tray.** The System Tray widget brings back the icons of apps running in the
  background (Discord, Steam, OneDrive...), which the hidden taskbar would otherwise lock away.
  Icons Windows keeps on the taskbar sit on the dock; the chevron opens all of them. Click opens
  the app, right-click opens its own menu. Windows' own icons (volume, network, battery) are left
  out, since the dock has widgets for those.
- **Auto-hide.** The dock comes back when the pointer touches the screen edge, and also when you
  press the Windows key, until Start or Search closes. With **Stay up on the desktop** (on unless
  you turn it off) it doesn't hide at all while no window is open on its screen. After the PC
  sleeps or is locked, the dock is put back in place instead of leaving an empty strip.
- **Widgets.** Click a widget for its card, right-click it for quick actions. Drag to reorder.
  Right-click the dock → **Widgets...** opens the picker, where you can drag in any of well over
  100 widgets. Its **Your apps** tab lists every app installed on the PC, so any of them can be a
  widget tile of its own.
- **Looks.** **Settings → Appearance → Match the album art** lets the accent colour take the
  cover's colour while music plays and gives yours back when it stops. The Wallpaper Gallery card
  can change the wallpaper by itself every day or every week, to the picture of the day or a
  random one of the last eight.
- **Text from screenshots.** Hover a picture in the Recent Screenshots card for **Copy text**,
  or right-click the tile to copy the text of the latest one. Windows' own OCR reads it, in the
  languages you have installed, and nothing leaves the PC.
- **Sign in with Google.** **Settings → Accounts → Google** puts your name and photo on the
  dock: your photo on the Start button (Appearance → Start button switches it back) and a
  "Good evening, Alex" greeting on the clock and calendar card. VyseBar asks Google only for
  your name, email address and photo. Google lets an app sign in only with its own OAuth client,
  so the first time you make a free one in Google Cloud (a Desktop app client; the page lists the
  four steps with links) and paste its ID and secret. The sign-in opens in your browser, and the
  saved sign-in is encrypted for your Windows account.
- **Gmail and Search Console.** These two widgets use the same Google sign-in and ask, from their
  card, for read-only access of their own (Gmail: message headers only, never the mail itself).
  Turn on the **Gmail API** or the **Google Search Console API** in your Cloud project first; the
  card links to it. While your OAuth app is in Testing, Google ends this access after seven days,
  so either allow it again from the card or publish the app (**Google Auth Platform → Audience →
  Publish app**). A published app you haven't had verified shows a warning at sign-in: choose
  **Advanced → Go to** your app's name.
- **Weather where you are.** With **Settings → Clock & Weather → Use my location** on (the
  default), the weather follows the PC: Windows location when Location is on for desktop apps
  (rounded to about a kilometre), otherwise the city of your internet connection's IP address,
  checked every three hours. Picking a city yourself turns it off.
- **Settings.** Right-click the dock → **Dock Settings...**, or launch VyseBar a second time.
  The same menu moves the dock to the top or bottom, toggles auto-hide and lock, and has
  **Quit VyseBar**.
- **Everything you change is kept.** Settings, pins, widgets, their order and what you type into
  cards are saved as you go: a text box saves a moment after you stop typing and again when its
  card or window closes, sliders save while you drag, and Windows shutting down, restarting or
  signing out still gets the last change written. Saves are crash-proof: the new file is flushed
  to disk before it replaces the old one, the version before stays as `settings.json.bak`, and a
  file a power cut damaged falls back to that copy instead of resetting VyseBar (the damaged one
  is kept as `settings.json.broken-...`).

### Widgets

| Category | Widgets |
| --- | --- |
| Clocks | Clock, Today, Date, Day Number, 7 Days, Flip Clock, Segment Clock, Analog Classic / Dark / Minimal, Clock & Weather, World Clock(s), World Time |
| Weather | Weather, Weather Details, Weather Status, Today's Forecast, Hourly, Forecast, Sunrise & Sunset |
| Productivity | Calendar, Day Timeline, Todos, Notes, Timer, Stopwatch, Pomodoro, Screen Time, Currency |
| System | System Tray, System Stats, CPU, Memory, Network, Storage (the tile shows any drive you pick), Battery, Temperature, Quick Toggles (pick which switches sit on the tile: Wi-Fi, Bluetooth, airplane, dark mode, mute, microphone, Do not disturb, energy saver, keep awake, mobile hotspot, Ethernet, camera, desktop icons; the card has all of them plus sound, brightness and display mode), Bluetooth (paired devices and their battery levels), Microphone (one click mutes it; right-click for its level and input), Brightness, Light / Dark, Keyboard Language, Recycle Bin, Day / Month / Year Progress |
| Media & Audio | Now Playing (+ Compact), Mini Player, Music Controls, Volume, Sound Output (with per-app mixer) |
| Apps & Files | App (any installed app as a tile), Folder (a stack of what's inside), Search, Commands, Downloads, Recent Screenshots (with Copy text), Recently Opened, Screenshot, Show Desktop, Task View |
| AI | Claude Usage, Claude This Week (from Claude Code's local logs), ChatGPT Codex limits (from Codex's local logs, with a chart of the last day), Gemini CLI and OpenCode tokens (from their local logs, no key needed), Cursor Usage and GLM Usage (plan limits with a chart of the last day), Grok and DeepSeek Balance |
| Developer | GitHub Activity, GitHub Overview, GitHub Notifications, Linear Issues, LeetCode, Supabase (API requests) |
| Finance & Stocks | Total Revenue, Crypto, Stock, Stock Chart, Watchlist, and Revenue + Chart widgets for Stripe, Polar, Lemon Squeezy, Paddle, Gumroad, Shopify and Dodo Payments |
| Analytics | Plausible and DataFast (visitors), Dub (link clicks), Search Console (clicks, impressions and position from Google) |
| Social | YouTube, Instagram, X and TikTok followers |
| Online & Mail | Gmail (unread mail), Wallpaper Gallery (Bing's picture of the day, one click to set it, or a new one every day or week), Resend (emails sent) |

Calendars come from ICS addresses (Google, Outlook and iCloud all publish one), added in
**Settings → Calendars**.

Widgets for a service of yours need its key or token. Open the widget's card and paste it there,
or use **Settings → Accounts**; each one says which key to create and links to the page where you
make it. Keys stay in VyseBar's settings file on this PC and only go to the service they belong
to. The account widgets follow each service's public API docs but haven't been tried with real
accounts yet (LeetCode, which needs no key, has), so a reading may need a fix once you connect one.

### Styles

Liquid Glass (live, refracting the desktop behind it), iOS (bright frosted glass), Black, White,
Midnight and Clear (just the tiles). The dock can sit at the bottom or the top, float or span the
full width, auto-hide, and show on one display or all of them.

In Smooth mode the glass styles read the strip of screen behind the dock. They read it through
Windows' Magnification API, which can leave VyseBar's own windows out, so the glass never shows
the dock inside itself while the dock still appears in screenshots and screen shares, like the
taskbar. On a PC where that API doesn't answer, VyseBar falls back to its old way: Windows is
asked to keep the dock out of screen captures (otherwise the glass would refract itself), and
screen shares show an empty strip where the dock is. `vysebar.log` says which one is in use;
Black, White, Midnight and Lite mode always show in captures.

### Performance: Smooth and Lite

**Settings → General → Performance** has three choices:

- **Smooth**: live glass that refracts whatever is behind the dock, and animated gauges. The
  glass reads only the strip of screen behind it, scaled down, about seven times a second while
  things move and about once a second otherwise. It never runs a screen-capture stream, which
  would cost a third of a CPU core and keep Windows from using its fast paths for games and video.
- **Lite**: glass made from your wallpaper picture instead of a live capture, gauges that jump
  instead of gliding, fast feeds (CPU, network, volume) polled half as often, and a smaller
  JavaScript engine. Everything else works the same.
- **Auto** (the default): Lite on 32-bit Windows or a PC with 4 GB of RAM or less, Smooth
  otherwise.

Either way VyseBar hands memory back to Windows whenever it's idle or a fullscreen game or video
takes over (Smooth keeps the graphics process warm, so the first hover after a break doesn't
stutter). Measured on a 16-core PC, counting every VyseBar process (private working set, what
Task Manager shows):

| Build and mode | Shortly after start | Idle | Idle CPU |
| --- | --- | --- | --- |
| 64-bit, Smooth, live glass | about 175 MB | about 175-190 MB | about 0.1% |
| 64-bit, Lite | about 35 MB | about 50 MB | under 0.2% |
| 32-bit (Auto picks Lite) | about 35-55 MB | about 40-50 MB | about 0.1% |

The 32-bit build uses Electron 43, the last version with 32-bit Windows support. 32-bit Windows
only exists as Windows 10, so there the dock uses a solid background in place of Windows 11's
Mica.

### Automations

Toasts for timers and Pomodoro phases, reminders before calendar events, pausing music when an
event starts, Claude usage alerts, low battery and nearly-full drives. Quiet hours silence the
sounds.

## Building from source

Requirements: Windows 10/11 and Node.js 20+. The native helper is compiled with the C# compiler
that ships with Windows (.NET Framework 4.8), so no .NET SDK is needed.

```bash
npm install
npm run dev        # run with hot reload (hides the taskbar while it runs)
npm run typecheck
npm run icons      # regenerate build/icon.png and build/icon.ico
npm run dist:win   # build release/VyseBar-Setup-<version>-x64.exe
npm run dist:win32 # build release/VyseBar-Setup-<version>-ia32.exe (packs Electron 43)
npm run dist:all   # both
```

The native helper is built for "Any CPU", so the same `VyseHost.exe` runs as 64-bit or 32-bit
to match Windows.

### Releasing an update

Installed copies update themselves from this repository's GitHub releases (`src/main/updater.ts`,
electron-updater). To ship one:

1. Raise `version` in `package.json`.
2. `npm run dist:all`. Besides the two installers this writes `latest.yml` (64-bit) and
   `ia32.yml` (32-bit), which say what the newest version is, and a `.blockmap` per installer,
   which lets an update download only the parts that changed.
3. Make a release tagged `v<version>` with all six files:

```bash
v=$(node -p "require('./package.json').version")
gh release create "v$v" --title "VyseBar $v" --notes "What changed" \
  release/VyseBar-Setup-$v-x64.exe release/VyseBar-Setup-$v-x64.exe.blockmap release/latest.yml \
  release/VyseBar-Setup-$v-ia32.exe release/VyseBar-Setup-$v-ia32.exe.blockmap release/ia32.yml
```

### Layout

- `src/main`: Electron main process. Dock windows and appbars (`docks.ts`), apps and pins
  (`apps.ts`), updates (`updater.ts`), IPC, settings store, memory trimming and Lite mode
  (`perf.ts`), and the data feeds in `services/` (system, local, online, accounts,
  automations, and the calendar-file reader `ics.ts`).
- `src/preload`: the `window.vyse` bridge.
- `src/shared`: types, and the list of account services (`accounts.ts`) that the fetchers, the
  Accounts page and the connect forms all read.
- `src/renderer`: React UI. `dock/` (dock, apps, cards, glass), `widgets/` (every widget and its
  card), `windows/` (Settings and the widget picker).
- `native`: VyseHost, the C# helper that talks to Windows: window tracking, taskbar hiding,
  Core Audio, media sessions, radios, brightness, power, temperature, the microphone, desktop
  icons, the wallpaper, Quick access, jump-list recent files (`JumpLists.cs`) and tasks
  (`JumpTasks.cs`), Win+1...9, Win+T and Alt+T (`Hotkeys.cs`), peek (`Peek.cs`), the
  notification area (`Tray.cs`), the strip of screen behind the live glass (`Grab.cs`), window
  previews (`Thumbs.cs`), Bluetooth batteries, Do not disturb, energy saver, the hotspot, the
  camera switch and Ethernet (`Devices.cs`), text from screenshots (`Ocr.cs`), memory
  trimming, and the watchdog that starts VyseBar again if it stops answering (`Watchdog.cs`).
  It speaks JSON lines over stdio. Anything slow runs
  there rather than in Electron's main process, because that process also passes the mouse
  through the dock: when it stalls, the whole pointer stutters.
- `scripts`: helper and icon build scripts.

The tray widget works the way other taskbar replacements (RetroBar) do: while it is on screen,
VyseHost keeps a hidden window of the taskbar's class (`Shell_TrayWnd`) in front of Explorer's,
which is where apps send their tray icons. Every message is passed on to Explorer unchanged, and
the window carries a copy of the real taskbar's window properties, which apps' taskbar badges and
progress bars (ITaskbarList) depend on. When the widget goes away, or VyseBar quits, the stand-in
goes too and Explorer's tray is complete.

Unread badges on app icons were looked at and left out: with the taskbar hidden, Windows stops
publishing its buttons (and their badges) to accessibility tools, and the remaining way in
(taking over the taskbar's ITaskbarList messages) would only see apps started after VyseBar and
could break features apps rely on.

VyseBar puts itself right when part of it stops answering. A dock page that hasn't answered for
30 seconds is reloaded. The helper is asked every 10 seconds and started again after three
misses. The helper in turn asks VyseBar's own window thread every 5 seconds, and after about 45
seconds without an answer it ends VyseBar, puts the taskbar back and starts VyseBar again. Quit
always finishes within a few seconds.

Settings and data live in `%APPDATA%\VyseBar`. So does `vysebar.log`, a short record of when
VyseBar started, quit, updated or crashed, and of anything it had to put right by itself (no
window titles, file names or anything you typed). It helps when the dock didn't come up after
signing in or stopped answering. It keeps itself under 256 KB.
