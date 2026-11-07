using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;

namespace VyseHost
{
    public static class Commands
    {
        public static async Task<object> Run(string cmd, Dictionary<string, object> a)
        {
            switch (cmd)
            {
                case "ping": return "pong";
                // the window thread answering, for main's check that the helper isn't stuck
                case "uiPing": return Program.OnUiSync(delegate { return (object)"pong"; }, 4000);
                // VyseBar's own command line, so a VyseBar that has stopped answering can be started again
                case "watchdog": return Watchdog.Arm(Program.Str(a, "exe"), Program.Str(a, "args"), Program.Str(a, "cwd"), (int)Program.Long(a, "seconds", 45));
                // opens a program the way Explorer does: one that must run as administrator asks for it
                case "open":
                    {
                        ProcessStartInfo si = new ProcessStartInfo(Program.Str(a, "path"), Program.Str(a, "args") ?? "");
                        si.UseShellExecute = true;
                        string dir = Program.Str(a, "cwd");
                        if (!string.IsNullOrEmpty(dir)) si.WorkingDirectory = dir;
                        Process.Start(si);
                        return true;
                    }

                // windows
                case "windows": return Program.OnUiSync(delegate { return (object)WindowTracker.List(); });
                case "activate": return WindowTracker.Activate(Program.Hwnd(a), Program.Bool(a, "toggle", true));
                case "minimize": Native.ShowWindowAsync(Program.Hwnd(a), Native.SW_MINIMIZE); return true;
                case "maximize": Native.ShowWindowAsync(Program.Hwnd(a), Native.SW_MAXIMIZE); return true;
                case "restore": Native.ShowWindowAsync(Program.Hwnd(a), Native.SW_RESTORE); return true;
                case "close": Native.PostMessage(Program.Hwnd(a), Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero); return true;
                case "kill":
                    try { Process.GetProcessById((int)Program.Long(a, "pid", 0)).Kill(); return true; }
                    catch { return false; }
                case "refreshWindows": WindowTracker.Invalidate(); return true;

                // taskbar and appbar
                case "hideTaskbar":
                    {
                        bool autoOnly = Program.Str(a, "mode") == "autohide";
                        return Program.OnUiSync(delegate { Taskbar.Hide(autoOnly); return (object)true; });
                    }
                case "restoreTaskbar": return Program.OnUiSync(delegate { Taskbar.Restore(); return (object)true; });
                case "appbar":
                    {
                        RECT r = new RECT();
                        r.left = (int)Program.Long(a, "x", 0);
                        r.top = (int)Program.Long(a, "y", 0);
                        r.right = r.left + (int)Program.Long(a, "width", 0);
                        r.bottom = r.top + (int)Program.Long(a, "height", 0);
                        AppBars.Set(Program.Str(a, "id"), Program.Bool(a, "top", false), r, (int)Program.Long(a, "thickness", 0));
                        return true;
                    }
                case "removeAppbar": AppBars.Remove(Program.Str(a, "id")); return true;

                // keyboard shortcuts the dock stands in for
                case "start": Native.Keys(Native.VK_LWIN); return true;
                case "winx": Native.Keys(Native.VK_LWIN, Native.VK_X); return true;
                case "showDesktop": Native.Keys(Native.VK_LWIN, Native.VK_D); return true;
                case "taskView": Native.Keys(Native.VK_LWIN, Native.VK_TAB); return true;
                case "actionCenter": Native.Keys(Native.VK_LWIN, Native.VK_N); return true;
                case "quickSettings": Native.Keys(Native.VK_LWIN, Native.VK_A); return true;
                case "snip": Native.Keys(Native.VK_LWIN, Native.VK_SHIFT, Native.VK_S); return true;
                case "trim":
                    {
                        int n = 0;
                        object raw;
                        if (a.TryGetValue("pids", out raw) && raw is System.Collections.IEnumerable)
                            foreach (object pid in (System.Collections.IEnumerable)raw)
                                if (Native.TrimProcess(Convert.ToUInt32(pid))) n++;
                        GC.Collect();
                        Native.EmptyWorkingSet(Native.GetCurrentProcess());
                        return n;
                    }
                // more switches and readings (Extras.cs)
                case "temperature": return Extras.Temperature();
                case "location": return await Location.Get();
                case "winKeys": Hotkeys.Enable(Program.Bool(a, "on", false)); return true;
                case "keys": Hotkeys.Configure(Program.Bool(a, "win", false), Program.Bool(a, "altT", false)); return true;
                case "navEnd": Hotkeys.EndNav(); return true;
                case "peek":
                    {
                        if (!Program.Bool(a, "on", false)) { Peek.End(); return true; }
                        RECT keep = new RECT();
                        keep.left = (int)Program.Long(a, "x", 0);
                        keep.top = (int)Program.Long(a, "y", 0);
                        keep.right = keep.left + (int)Program.Long(a, "w", 0);
                        keep.bottom = keep.top + (int)Program.Long(a, "h", 0);
                        return Peek.Show(Program.Hwnd(a), new IntPtr(Program.Long(a, "top", 0)), keep);
                    }
                case "keepAwake":
                    {
                        object on = a.ContainsKey("on") ? a["on"] : null;
                        return Program.OnUiSync(delegate { return Extras.KeepAwake(on); });
                    }
                case "mic": return Extras.Mic(a.ContainsKey("mute") ? a["mute"] : null);
                case "micState": return Audio.Mic();
                case "setMic": return Audio.SetMic(Program.Num(a, "volume", -1), a.ContainsKey("muted") ? a["muted"] : null);
                case "micDevices": return Audio.Devices(1);
                case "energySaver": return Devices.EnergySaver(a.ContainsKey("on") ? a["on"] : null);
                case "dnd": return Devices.DoNotDisturb(a.ContainsKey("on") ? a["on"] : null);
                case "camera": return await Devices.Camera(a.ContainsKey("on") ? a["on"] : null);
                case "hotspot": return await Devices.Hotspot(a.ContainsKey("on") ? a["on"] : null);
                case "ethernet": return Devices.Ethernet();
                case "bluetooth": return await Devices.Bluetooth();
                case "ocr": return await Ocr.Read(Program.Str(a, "path"));
                case "desktopIcons":
                    {
                        object show = a.ContainsKey("show") ? a["show"] : null;
                        return Program.OnUiSync(delegate { return Extras.DesktopIcons(show); });
                    }
                case "displayMode": Native.Keys(Native.VK_LWIN, (ushort)0x50); return true;
                case "setWallpaper": return Extras.SetWallpaper(Program.Str(a, "path"));
                // Shell.Application wants a single-threaded apartment; the shell's own one, never the
                // window thread (a network folder in Quick access can take a long time to answer)
                case "quickAccess": return await Sta.Run(delegate { return Extras.QuickAccess(); });
                case "lock": return Native.LockWorkStation();
                case "sleep": return Program.OnUiSync(delegate { return (object)System.Windows.Forms.Application.SetSuspendState(System.Windows.Forms.PowerState.Suspend, false, false); });

                // the picture behind the live glass (Grab.cs)
                case "grab":
                    return Grab.Strip((int)Program.Long(a, "x", 0), (int)Program.Long(a, "y", 0), (int)Program.Long(a, "w", 0), (int)Program.Long(a, "h", 0),
                        (int)Program.Long(a, "ow", 0), (int)Program.Long(a, "oh", 0));
                case "grabRelease": return Grab.Release();
                // whether those reads leave VyseBar's own windows out (then the dock can show in screen shares)
                case "grabMode": return Grab.Mode(Program.Bool(a, "allow", false));
                // window previews (Thumbs.cs)
                case "thumbs":
                    {
                        List<IntPtr> hwnds = new List<IntPtr>();
                        object raw;
                        if (a.TryGetValue("hwnds", out raw) && raw is System.Collections.IEnumerable && !(raw is string))
                            foreach (object h in (System.Collections.IEnumerable)raw) if (h != null) hwnds.Add(new IntPtr(Convert.ToInt64(h)));
                        return Thumbs.Get(hwnds, (int)Program.Long(a, "w", 400), (int)Program.Long(a, "h", 250));
                    }

                // the notification area (Tray.cs)
                case "trayStart": Tray.Start(); return Tray.List();
                case "trayStop": return Tray.Stop();
                case "trayList": return Tray.List();
                case "trayClick": return Tray.Click(Program.Str(a, "key"), Program.Str(a, "button"));

                // recent files in an app's right-click menu (JumpLists.cs)
                case "jumpList":
                    {
                        List<string> ids = new List<string>();
                        object raw;
                        if (a.TryGetValue("ids", out raw) && raw is System.Collections.IEnumerable && !(raw is string))
                            foreach (object id in (System.Collections.IEnumerable)raw) if (id != null) ids.Add(Convert.ToString(id));
                        return await JumpLists.Get(ids, Program.Str(a, "exe"), Program.Str(a, "lnk"));
                    }
                case "jumpOpen": return await JumpLists.Open(Program.Str(a, "path"), Program.Str(a, "appId"), Program.Str(a, "exe"));
                case "jumpWarm": JumpLists.Warm(); return true;
                case "jumpTask":
                    {
                        string listId = Program.Str(a, "listId");
                        int list = (int)Program.Long(a, "list", -1), index = (int)Program.Long(a, "index", -1);
                        return await Sta.Run(delegate { return JumpTasks.Open(listId, list, index); });
                    }

                // media and audio
                case "media": return await Media.Snapshot();
                case "mediaStart": await Media.Start(); return await Media.Snapshot();
                case "mediaControl": return await Media.Control(Program.Str(a, "action"), Program.Num(a, "seconds", 0));
                case "volume": return Audio.Get();
                case "setVolume": return Audio.Set(Program.Num(a, "volume", -1), a.ContainsKey("muted") ? a["muted"] : null);
                case "audioDevices": return Audio.Devices();
                case "setAudioDevice": return Audio.SetDefault(Program.Str(a, "id"));
                case "mixer": return Audio.Mixer();
                case "setAppVolume": return Audio.SetApp((uint)Program.Long(a, "pid", 0), Program.Num(a, "volume", -1), a.ContainsKey("muted") ? a["muted"] : null);

                // shell
                case "icon":
                    {
                        string path = Program.Str(a, "path");
                        int size = (int)Program.Long(a, "size", 64);
                        bool thumb = Program.Bool(a, "thumbnail", false);
                        return await Sta.Run(delegate { return Shell.Icon(path, size, thumb); });
                    }
                case "fileAumid":
                    {
                        string path = Program.Str(a, "path");
                        return await Sta.Run(delegate { return Shell.FileAumid(path); });
                    }
                case "startApps": return await Sta.Run(delegate { return Shell.StartApps(); });
                case "exeName":
                    try
                    {
                        FileVersionInfo fv = FileVersionInfo.GetVersionInfo(Program.Str(a, "path"));
                        return string.IsNullOrEmpty(fv.FileDescription) ? fv.ProductName : fv.FileDescription;
                    }
                    catch { return null; }
                case "recycleBin": return Shell.RecycleBin();
                case "emptyRecycleBin": return Shell.EmptyRecycleBin();
                case "theme": return Shell.Theme();
                case "setTheme": return Shell.SetTheme(Program.Bool(a, "dark", true));
                case "radios": return await Shell.Radios();
                case "setRadio": return await Shell.SetRadio(Program.Str(a, "kind"), Program.Bool(a, "on", true));
                case "brightness": return Shell.Brightness();
                case "setBrightness": return Shell.SetBrightness((int)Program.Long(a, "level", 50));
                case "network": return Shell.Network();
                case "keyboard": return Program.OnUiSync(delegate { return Shell.Keyboard(); });
                case "nextKeyboard": return Shell.NextKeyboard(Program.Long(a, "id", 0));

                case "quit": Program.Shutdown(); return true;
            }
            throw new Exception("unknown command: " + cmd);
        }
    }
}
