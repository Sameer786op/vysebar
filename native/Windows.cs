// Open windows, the foreground app, fullscreen detection, the Windows taskbar and the appbar
// that reserves the dock's strip of the screen.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace VyseHost
{
    // a hidden top-level window: receives shell hook messages and the TaskbarCreated broadcast
    class HostWindow : NativeWindow
    {
        public static uint ShellHookMsg, TaskbarCreatedMsg;

        public HostWindow()
        {
            CreateParams cp = new CreateParams();
            cp.Caption = "VyseHost";
            cp.ExStyle = (int)Native.WS_EX_TOOLWINDOW;
            cp.Style = unchecked((int)0x80000000); // WS_POPUP, never shown
            CreateHandle(cp);
            ShellHookMsg = Native.RegisterWindowMessage("SHELLHOOK");
            TaskbarCreatedMsg = Native.RegisterWindowMessage("TaskbarCreated");
            Native.RegisterShellHookWindow(Handle);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == (int)ShellHookMsg)
            {
                int code = m.WParam.ToInt32();
                if (code == Native.HSHELL_FLASH) WindowTracker.SetFlashing(m.LParam, true);
                else if (code == Native.HSHELL_WINDOWACTIVATED || code == Native.HSHELL_RUDEAPPACTIVATED) WindowTracker.SetFlashing(m.LParam, false);
            }
            else if (m.Msg == (int)TaskbarCreatedMsg && !Tray.IsOwnBroadcast())
            {
                // Explorer restarted: appbars must register again and its new taskbar must hide again
                AppBars.ReRegister();
                Taskbar.ReHide();
                Program.Send("explorerRestarted", null);
            }
            base.WndProc(ref m);
        }
    }

    public static class WindowTracker
    {
        static HostWindow host;
        static Native.WinEventDelegate hookProc;
        static readonly List<IntPtr> hooks = new List<IntPtr>();
        static bool dirty = true;
        static string lastJson = "";
        static readonly HashSet<long> flashing = new HashSet<long>();
        public static IntPtr LastExternal = IntPtr.Zero;
        static readonly Dictionary<uint, string> exeCache = new Dictionary<uint, string>();
        static string lastFullscreen = "";
        static readonly System.Web.Script.Serialization.JavaScriptSerializer Json = new System.Web.Script.Serialization.JavaScriptSerializer();

        public static void Start()
        {
            host = new HostWindow();
            hookProc = OnWinEvent;
            uint flags = Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS;
            hooks.Add(Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, hookProc, 0, 0, flags));
            hooks.Add(Native.SetWinEventHook(Native.EVENT_SYSTEM_MINIMIZESTART, Native.EVENT_SYSTEM_MINIMIZEEND, IntPtr.Zero, hookProc, 0, 0, flags));
            hooks.Add(Native.SetWinEventHook(Native.EVENT_OBJECT_CREATE, Native.EVENT_OBJECT_HIDE, IntPtr.Zero, hookProc, 0, 0, flags));
            hooks.Add(Native.SetWinEventHook(Native.EVENT_OBJECT_NAMECHANGE, Native.EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, hookProc, 0, 0, flags));
            hooks.Add(Native.SetWinEventHook(Native.EVENT_OBJECT_CLOAKED, Native.EVENT_OBJECT_UNCLOAKED, IntPtr.Zero, hookProc, 0, 0, flags));

            Timer fast = new Timer();
            fast.Interval = 80;
            fast.Tick += delegate
            {
                try { if (dirty) { dirty = false; Emit(); } }
                catch (Exception e) { Program.LogError("window list", e); }
            };
            fast.Start();

            Timer slow = new Timer();
            slow.Interval = 500;
            slow.Tick += delegate
            {
                try { CheckFullscreen(); Taskbar.Watchdog(); }
                catch (Exception e) { Program.LogError("fullscreen check", e); }
            };
            slow.Start();

            Timer refresh = new Timer();
            refresh.Interval = 3000;
            refresh.Tick += delegate { dirty = true; };
            refresh.Start();
        }

        static void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            if (idObject != 0 || idChild != 0) return; // OBJID_WINDOW, CHILDID_SELF only
            try
            {
                if (ev == Native.EVENT_SYSTEM_FOREGROUND)
                {
                    OnForeground(hwnd);
                    dirty = true;
                    return;
                }
                if (ev == Native.EVENT_OBJECT_NAMECHANGE && !IsAppWindow(hwnd)) return;
            }
            catch (Exception e) { Program.LogError("window event", e); }
            dirty = true;
        }

        static void OnForeground(IntPtr hwnd)
        {
            uint pid;
            Native.GetWindowThreadProcessId(hwnd, out pid);
            if (pid == Program.ParentPid) return;
            string cls = ClassOf(hwnd);
            if (cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return;
            flashing.Remove(hwnd.ToInt64());
            bool isApp = IsAppWindow(hwnd);
            if (isApp) LastExternal = hwnd;
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["hwnd"] = hwnd.ToInt64();
            d["pid"] = (long)pid;
            d["exe"] = ExeOf(pid);
            d["title"] = TitleOf(hwnd);
            d["cls"] = cls;
            d["app"] = isApp;
            Program.Send("foreground", d);
        }

        public static void SetFlashing(IntPtr hwnd, bool on)
        {
            if (on) flashing.Add(hwnd.ToInt64()); else flashing.Remove(hwnd.ToInt64());
            dirty = true;
        }

        public static string ClassOf(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(256);
            Native.GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        public static string TitleOf(IntPtr h)
        {
            int len = Native.GetWindowTextLength(h);
            if (len <= 0) return "";
            StringBuilder sb = new StringBuilder(len + 1);
            Native.GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }

        public static string ExeOf(uint pid)
        {
            string cached;
            lock (exeCache) { if (exeCache.TryGetValue(pid, out cached)) return cached; }
            string path = null;
            IntPtr hp = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hp != IntPtr.Zero)
            {
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (Native.QueryFullProcessImageName(hp, 0, sb, ref size)) path = sb.ToString();
                Native.CloseHandle(hp);
            }
            if (path != null) lock (exeCache) { if (exeCache.Count > 2000) exeCache.Clear(); exeCache[pid] = path; }
            return path;
        }

        static string PackageAumid(uint pid)
        {
            IntPtr hp = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hp == IntPtr.Zero) return null;
            try
            {
                int len = 512;
                StringBuilder sb = new StringBuilder(len);
                return Native.GetApplicationUserModelId(hp, ref len, sb) == 0 ? sb.ToString() : null;
            }
            catch { return null; }
            finally { Native.CloseHandle(hp); }
        }

        public static string WindowAumid(IntPtr h)
        {
            Guid iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            try
            {
                if (Native.SHGetPropertyStoreForWindow(h, ref iid, out store) != 0) return null;
                string s = Native.ReadString(store, Native.PKEY_AppUserModel_ID);
                Marshal.ReleaseComObject(store);
                return string.IsNullOrEmpty(s) ? null : s;
            }
            catch { return null; }
        }

        internal static bool IsCloaked(IntPtr h)
        {
            int v;
            return Native.DwmGetWindowAttribute(h, Native.DWMWA_CLOAKED, out v, 4) == 0 && v != 0;
        }

        // the same test Alt+Tab uses, near enough
        public static bool IsAppWindow(IntPtr h)
        {
            if (!Native.IsWindowVisible(h)) return false;
            long ex = Native.GetWindowLongPtr(h, Native.GWL_EXSTYLE).ToInt64();
            IntPtr owner = Native.GetWindow(h, Native.GW_OWNER);
            bool appWindow = (ex & Native.WS_EX_APPWINDOW) != 0;
            if (!appWindow)
            {
                if ((ex & Native.WS_EX_TOOLWINDOW) != 0) return false;
                if (owner != IntPtr.Zero && Native.IsWindowVisible(owner)) return false;
                if ((ex & Native.WS_EX_NOACTIVATE) != 0) return false;
            }
            if (IsCloaked(h)) return false;
            if (Native.GetWindowTextLength(h) == 0) return false;
            string cls = ClassOf(h);
            if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd"
                || cls == "Windows.UI.Core.CoreWindow" || cls == "XamlExplorerHostIslandWindow") return false;
            return true;
        }

        public static List<Dictionary<string, object>> List()
        {
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            IntPtr fg = Native.GetForegroundWindow();
            Native.EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                if (!IsAppWindow(h)) return true;
                uint pid;
                Native.GetWindowThreadProcessId(h, out pid);
                if (pid == Program.ParentPid) return true;
                string exe = ExeOf(pid);
                string aumid = WindowAumid(h);
                string cls = ClassOf(h);
                if (cls == "ApplicationFrameWindow")
                {
                    // a UWP app lives in a child window owned by the app's own process
                    uint childPid = 0;
                    Native.EnumChildWindows(h, delegate (IntPtr c, IntPtr l2)
                    {
                        uint p;
                        Native.GetWindowThreadProcessId(c, out p);
                        if (p != pid) { childPid = p; return false; }
                        return true;
                    }, IntPtr.Zero);
                    if (childPid == 0) return true; // a frame with no app inside is a suspended ghost
                    exe = ExeOf(childPid);
                    if (aumid == null) aumid = PackageAumid(childPid);
                }
                else if (aumid == null && exe != null && exe.IndexOf("\\WindowsApps\\", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    aumid = PackageAumid(pid);
                }
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["hwnd"] = h.ToInt64();
                d["pid"] = (long)pid;
                d["title"] = TitleOf(h);
                d["exe"] = exe;
                d["aumid"] = aumid;
                d["minimized"] = Native.IsIconic(h);
                d["active"] = h == fg;
                d["flashing"] = flashing.Contains(h.ToInt64());
                RECT wr;
                if (Native.GetWindowRect(h, out wr))
                {
                    d["x"] = wr.left;
                    d["y"] = wr.top;
                    d["w"] = wr.right - wr.left;
                    d["h"] = wr.bottom - wr.top;
                }
                list.Add(d);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        static void Emit()
        {
            List<Dictionary<string, object>> list = List();
            string json = Json.Serialize(list);
            if (json == lastJson) return;
            lastJson = json;
            Program.Send("windows", list);
        }

        public static void Invalidate() { dirty = true; lastJson = ""; }

        // fullscreen = the foreground window covers its whole monitor (a game, a video, F11)
        static void CheckFullscreen()
        {
            IntPtr fg = Native.GetForegroundWindow();
            string key = "";
            Dictionary<string, object> data = null;
            if (fg != IntPtr.Zero && fg != Native.GetShellWindow())
            {
                string cls = ClassOf(fg);
                uint pid;
                Native.GetWindowThreadProcessId(fg, out pid);
                if (pid != Program.ParentPid && cls != "Progman" && cls != "WorkerW" && cls != "Shell_TrayWnd"
                    && cls != "Windows.UI.Core.CoreWindow" && cls != "XamlExplorerHostIslandWindow")
                {
                    RECT r;
                    Native.GetWindowRect(fg, out r);
                    IntPtr mon = Native.MonitorFromWindow(fg, Native.MONITOR_DEFAULTTONEAREST);
                    MONITORINFO mi = new MONITORINFO();
                    mi.cbSize = Marshal.SizeOf(mi);
                    if (Native.GetMonitorInfo(mon, ref mi))
                    {
                        RECT m = mi.rcMonitor;
                        if (r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom)
                        {
                            key = m.left + "," + m.top + "," + m.right + "," + m.bottom;
                            data = new Dictionary<string, object>();
                            data["x"] = m.left; data["y"] = m.top; data["width"] = m.right - m.left; data["height"] = m.bottom - m.top;
                        }
                    }
                }
            }
            if (key == lastFullscreen) return;
            lastFullscreen = key;
            Program.Send("fullscreen", data);
        }

        // SetForegroundWindow only works for the process that made the last input; an empty
        // mouse input makes this process that one, with no visible effect (the PowerToys trick)
        public static void ForceForeground(IntPtr h)
        {
            INPUT[] input = new INPUT[1];
            input[0].type = Native.INPUT_MOUSE;
            Native.SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
            // BringWindowToTop and AttachThreadInput wait on the other window's thread: with an app
            // that has stopped answering they would hang here too, so it is only asked to come up
            bool hung = Native.IsHungAppWindow(h);
            if (Native.SetForegroundWindow(h)) { if (!hung) Native.BringWindowToTop(h); return; }
            IntPtr fg = Native.GetForegroundWindow();
            if (hung || (fg != IntPtr.Zero && Native.IsHungAppWindow(fg))) return;
            uint pid;
            uint fgThread = Native.GetWindowThreadProcessId(fg, out pid);
            uint cur = Native.GetCurrentThreadId();
            Native.AttachThreadInput(cur, fgThread, true);
            Native.SetForegroundWindow(h);
            Native.BringWindowToTop(h);
            Native.AttachThreadInput(cur, fgThread, false);
        }

        public static object Activate(IntPtr h, bool toggle)
        {
            if (!Native.IsWindow(h)) return false;
            if (Native.IsIconic(h))
            {
                Native.ShowWindowAsync(h, Native.SW_RESTORE);
                ForceForeground(h);
                return "restored";
            }
            // the dock never takes focus, so a click on the active app finds it still in front
            if (toggle && h == Native.GetForegroundWindow())
            {
                Native.ShowWindowAsync(h, Native.SW_MINIMIZE);
                return "minimized";
            }
            ForceForeground(h);
            return "activated";
        }
    }

    // Hides the Windows taskbar while VyseBar runs. The original auto-hide state is written to
    // disk first, so a crash, a kill or a power cut still gets the taskbar back on next start.
    public static class Taskbar
    {
        static bool hidden;
        static string StateFile { get { return Path.Combine(Program.DataDir, "taskbar-state.txt"); } }

        static List<IntPtr> Bars()
        {
            List<IntPtr> bars = new List<IntPtr>();
            IntPtr main = Tray.Explorer();
            if (main != IntPtr.Zero) bars.Add(main);
            Native.EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                if (WindowTracker.ClassOf(h) == "Shell_SecondaryTrayWnd") bars.Add(h);
                return true;
            }, IntPtr.Zero);
            return bars;
        }

        static int GetState(IntPtr bar)
        {
            APPBARDATA abd = new APPBARDATA();
            abd.cbSize = Marshal.SizeOf(abd);
            abd.hWnd = bar;
            return (int)Native.SHAppBarMessage(Native.ABM_GETSTATE, ref abd).ToUInt32();
        }

        static void SetState(IntPtr bar, int state)
        {
            APPBARDATA abd = new APPBARDATA();
            abd.cbSize = Marshal.SizeOf(abd);
            abd.hWnd = bar;
            abd.lParam = new IntPtr(state);
            Native.SHAppBarMessage(Native.ABM_SETSTATE, ref abd);
        }

        /// autoHideOnly leaves Windows' taskbar sliding up at the screen edge; otherwise it is hidden
        public static void Hide(bool autoHideOnly)
        {
            IntPtr main = Tray.Explorer();
            if (main == IntPtr.Zero) return;
            if (!File.Exists(StateFile))
            {
                File.WriteAllText(StateFile, GetState(main).ToString());
            }
            // auto-hide hands the taskbar's strip back to the windows; hiding stops it sliding up
            SetState(main, Native.ABS_AUTOHIDE | Native.ABS_ALWAYSONTOP);
            if (autoHideOnly)
            {
                if (hidden) foreach (IntPtr bar in Bars()) Native.ShowWindowAsync(bar, Native.SW_SHOWNA);
                hidden = false;
                return;
            }
            // Explorer's windows: ShowWindowAsync leaves the request with Explorer, where ShowWindow
            // would wait for it (for ever, if Explorer has stopped answering)
            foreach (IntPtr bar in Bars()) Native.ShowWindowAsync(bar, Native.SW_HIDE);
            hidden = true;
        }

        public static void Restore()
        {
            bool wasHidden = hidden;
            hidden = false;
            IntPtr main = Tray.Explorer();
            if (File.Exists(StateFile))
            {
                int state;
                if (main != IntPtr.Zero && int.TryParse(File.ReadAllText(StateFile).Trim(), out state)) SetState(main, state);
                try { File.Delete(StateFile); } catch { }
                wasHidden = true;
            }
            if (wasHidden) foreach (IntPtr bar in Bars()) Native.ShowWindowAsync(bar, Native.SW_SHOWNA);
        }

        public static void RecoverFromCrash()
        {
            if (File.Exists(StateFile)) Restore();
        }

        public static void ReHide() { if (hidden) Hide(false); }

        public static bool IsHidden { get { return hidden; } }

        // Explorer shows its taskbar again on some events (Start, display changes); hide it again
        public static void Watchdog()
        {
            if (!hidden) return;
            foreach (IntPtr bar in Bars())
            {
                if (Native.IsWindowVisible(bar)) Native.ShowWindowAsync(bar, Native.SW_HIDE);
            }
        }
    }

    // One appbar per dock: Windows keeps maximized windows out of the strip it reserves.
    class AppBarWindow : NativeWindow
    {
        public uint CallbackMsg;
        public bool Registered;
        public uint Edge;
        public RECT Monitor;
        public int Thickness;

        public AppBarWindow()
        {
            CreateParams cp = new CreateParams();
            cp.Caption = "VyseBarAppBar";
            cp.ExStyle = (int)Native.WS_EX_TOOLWINDOW;
            cp.Style = unchecked((int)0x80000000);
            CreateHandle(cp);
            CallbackMsg = Native.RegisterWindowMessage("VyseBarAppBarMsg");
        }

        APPBARDATA Data()
        {
            APPBARDATA abd = new APPBARDATA();
            abd.cbSize = Marshal.SizeOf(abd);
            abd.hWnd = Handle;
            return abd;
        }

        public void Apply()
        {
            APPBARDATA abd = Data();
            if (!Registered)
            {
                abd.uCallbackMessage = CallbackMsg;
                Native.SHAppBarMessage(Native.ABM_NEW, ref abd);
                Registered = true;
            }
            abd.uEdge = Edge;
            abd.rc = Monitor;
            if (Edge == Native.ABE_BOTTOM) abd.rc.top = Monitor.bottom - Thickness; else abd.rc.bottom = Monitor.top + Thickness;
            Native.SHAppBarMessage(Native.ABM_QUERYPOS, ref abd);
            if (Edge == Native.ABE_BOTTOM) abd.rc.top = abd.rc.bottom - Thickness; else abd.rc.bottom = abd.rc.top + Thickness;
            Native.SHAppBarMessage(Native.ABM_SETPOS, ref abd);
        }

        public void Remove()
        {
            if (!Registered) return;
            APPBARDATA abd = Data();
            Native.SHAppBarMessage(Native.ABM_REMOVE, ref abd);
            Registered = false;
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == (int)CallbackMsg && m.WParam.ToInt32() == (int)Native.ABN_POSCHANGED && Registered)
            {
                Apply();
            }
            base.WndProc(ref m);
        }
    }

    public static class AppBars
    {
        static readonly Dictionary<string, AppBarWindow> bars = new Dictionary<string, AppBarWindow>();

        public static void Set(string id, bool top, RECT monitor, int thickness)
        {
            Program.OnUi(delegate
            {
                AppBarWindow bar;
                if (!bars.TryGetValue(id, out bar)) { bar = new AppBarWindow(); bars[id] = bar; }
                bar.Edge = top ? Native.ABE_TOP : Native.ABE_BOTTOM;
                bar.Monitor = monitor;
                bar.Thickness = thickness;
                bar.Apply();
            });
        }

        public static void Remove(string id)
        {
            Program.OnUi(delegate
            {
                AppBarWindow bar;
                if (!bars.TryGetValue(id, out bar)) return;
                bar.Remove();
                bar.DestroyHandle();
                bars.Remove(id);
            });
        }

        public static void RemoveAll()
        {
            foreach (AppBarWindow bar in bars.Values) { try { bar.Remove(); } catch { } }
        }

        public static void ReRegister()
        {
            foreach (AppBarWindow bar in bars.Values) { bar.Registered = false; bar.Apply(); }
        }
    }
}
