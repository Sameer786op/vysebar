// For main's check that the dock really gets the pointer (src/main/docks.ts): what is under a
// point of the screen, and whether something else has the mouse just then (a button held for a
// drag, a menu, a window being moved, touch or pen). Plus the screen turning off and on, which
// needs no sleep, and sleep itself, after which main checks the dock over.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace VyseHost
{
    public static class Pointer
    {
        [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

        [StructLayout(LayoutKind.Sequential)]
        struct GUITHREADINFO
        {
            public int cbSize;
            public int flags;
            public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
            public RECT rcCaret;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct CURSORINFO
        {
            public int cbSize;
            public int flags;
            public IntPtr hCursor;
            public POINT pt;
        }

        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
        [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
        [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr h, out uint key, out byte alpha, out uint flags);

        const uint GA_ROOT = 2;
        const int GUI_INMOVESIZE = 0x2, GUI_INMENUMODE = 0x4, GUI_SYSTEMMENUMODE = 0x8, GUI_POPUPMENUMODE = 0x10;
        const int CURSOR_SUPPRESSED = 0x2;
        const long WS_EX_TOPMOST = 0x8, WS_EX_LAYERED = 0x80000;
        const uint LWA_ALPHA = 0x2;

        static bool Down(int vk) { return GetAsyncKeyState(vk) < 0; }

        /// x, y in physical pixels. Only window classes and program names come back, never titles.
        public static Dictionary<string, object> At(int x, int y)
        {
            POINT p;
            p.X = x;
            p.Y = y;
            IntPtr h = WindowFromPoint(p);
            IntPtr root = h == IntPtr.Zero ? IntPtr.Zero : GetAncestor(h, GA_ROOT);
            if (root == IntPtr.Zero) root = h;
            uint pid = 0;
            if (root != IntPtr.Zero) Native.GetWindowThreadProcessId(root, out pid);
            long ex = root == IntPtr.Zero ? 0 : Native.GetWindowLongPtr(root, Native.GWL_EXSTYLE).ToInt64();
            bool ours = pid != 0 && pid == Program.ParentPid;

            Dictionary<string, object> d = new Dictionary<string, object>();
            d["hwnd"] = root.ToInt64();
            d["ours"] = ours;
            d["cls"] = root == IntPtr.Zero ? "" : WindowTracker.ClassOf(root);
            d["topmost"] = (ex & WS_EX_TOPMOST) != 0;
            if ((ex & WS_EX_LAYERED) != 0)
            {
                uint key, flags;
                byte alpha;
                if (GetLayeredWindowAttributes(root, out key, out alpha, out flags) && (flags & LWA_ALPHA) != 0) d["alpha"] = (int)alpha;
            }
            if (pid != 0 && !ours)
            {
                string exe = WindowTracker.ExeOf(pid);
                d["exe"] = exe == null ? "" : Path.GetFileName(exe);
            }
            d["buttons"] = Down(0x01) || Down(0x02) || Down(0x04) || Down(0x05) || Down(0x06);
            GUITHREADINFO gi = new GUITHREADINFO();
            gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
            d["busy"] = GetGUIThreadInfo(0, ref gi)
                && ((gi.flags & (GUI_INMOVESIZE | GUI_INMENUMODE | GUI_SYSTEMMENUMODE | GUI_POPUPMENUMODE)) != 0 || gi.hwndCapture != IntPtr.Zero);
            CURSORINFO ci = new CURSORINFO();
            ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
            d["touch"] = GetCursorInfo(ref ci) && (ci.flags & CURSOR_SUPPRESSED) != 0;
            return d;
        }

        [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int cls, out int value, int size, out int returned);

        static string Flags(IntPtr h)
        {
            long ex = Native.GetWindowLongPtr(h, Native.GWL_EXSTYLE).ToInt64();
            List<string> f = new List<string>();
            if ((ex & WS_EX_TOPMOST) != 0) f.Add("topmost");
            if ((ex & 0x20) != 0) f.Add("click-through");
            if ((ex & WS_EX_LAYERED) != 0)
            {
                uint key, flags;
                byte alpha;
                if (GetLayeredWindowAttributes(h, out key, out alpha, out flags) && (flags & LWA_ALPHA) != 0) f.Add("opacity " + alpha);
                else f.Add("layered");
            }
            if ((ex & 0x08000000) != 0) f.Add("no-activate");
            if (!IsWindowEnabled(h)) f.Add("DISABLED");
            return string.Join(",", f.ToArray());
        }

        static string Who(IntPtr h)
        {
            uint pid;
            Native.GetWindowThreadProcessId(h, out pid);
            string exe = pid == Program.ParentPid ? "VyseBar" : pid == (uint)System.Diagnostics.Process.GetCurrentProcess().Id ? "VyseHost" : Path.GetFileName(WindowTracker.ExeOf(pid) ?? "?");
            return WindowTracker.ClassOf(h) + " of " + exe;
        }

        /// an app running as administrator: Windows keeps its input from apps that aren't
        static string Elevated(uint pid)
        {
            IntPtr p = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (p == IntPtr.Zero) return "unknown";
            try
            {
                IntPtr token;
                if (!OpenProcessToken(p, 0x8 /* TOKEN_QUERY */, out token)) return "unknown";
                try
                {
                    int elevated, n;
                    return GetTokenInformation(token, 20 /* TokenElevation */, out elevated, 4, out n) ? (elevated != 0 ? "yes" : "no") : "unknown";
                }
                finally { CloseHandle(token); }
            }
            finally { CloseHandle(p); }
        }

        /// The dock's own window as Windows has it, for main's log when the dock seems not to take
        /// the pointer: its styles and place, what is stacked above it at the point (classes and
        /// program names only, never titles), the app in front and whether it runs elevated, and
        /// whether a window of the dock's thread holds the mouse. Only reads; sends nothing.
        public static Dictionary<string, object> DockWin(IntPtr dock, int x, int y)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            if (dock == IntPtr.Zero || !Native.IsWindow(dock)) { d["gone"] = true; return d; }
            RECT r;
            Native.GetWindowRect(dock, out r);
            d["rect"] = r.left + "," + r.top + " " + (r.right - r.left) + "x" + (r.bottom - r.top);
            d["flags"] = Flags(dock);
            d["visible"] = Native.IsWindowVisible(dock);
            int cloaked;
            d["cloaked"] = DwmGetWindowAttribute(dock, 14 /* DWMWA_CLOAKED */, out cloaked, 4) == 0 && cloaked != 0;
            List<string> above = new List<string>();
            int count = 0;
            for (IntPtr h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero && h != dock && count < 400; h = Native.GetWindow(h, 2 /* GW_HWNDNEXT */), count++)
            {
                if (!Native.IsWindowVisible(h)) continue;
                int c;
                if (DwmGetWindowAttribute(h, 14, out c, 4) == 0 && c != 0) continue;
                RECT w;
                Native.GetWindowRect(h, out w);
                if (x < w.left || x >= w.right || y < w.top || y >= w.bottom) continue;
                above.Add(Who(h) + " [" + Flags(h) + "]");
                if (above.Count >= 6) break;
            }
            d["above"] = above;
            IntPtr fg = Native.GetForegroundWindow();
            if (fg != IntPtr.Zero)
            {
                uint pid;
                Native.GetWindowThreadProcessId(fg, out pid);
                d["front"] = Who(fg) + (pid == Program.ParentPid ? "" : ", elevated: " + Elevated(pid));
            }
            uint dockPid;
            uint tid = Native.GetWindowThreadProcessId(dock, out dockPid);
            GUITHREADINFO gi = new GUITHREADINFO();
            gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
            if (GetGUIThreadInfo(tid, ref gi) && gi.hwndCapture != IntPtr.Zero) d["capture"] = WindowTracker.ClassOf(gi.hwndCapture);
            GUITHREADINFO fgi = new GUITHREADINFO();
            fgi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
            if (GetGUIThreadInfo(0, ref fgi) && fgi.hwndCapture != IntPtr.Zero) d["frontCapture"] = Who(fgi.hwndCapture);
            return d;
        }
    }

    // The screen going off and on (Windows does that without sleeping), and sleep as Windows
    // tells windows about it. A hidden window of its own on the helper's window thread.
    class PowerWatch : NativeWindow
    {
        [DllImport("user32.dll")] static extern IntPtr RegisterPowerSettingNotification(IntPtr h, ref Guid setting, int flags);

        [StructLayout(LayoutKind.Sequential)]
        struct POWERBROADCAST_SETTING
        {
            public Guid PowerSetting;
            public int DataLength;
            public int Data;
        }

        static readonly Guid ConsoleDisplayState = new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");
        const int WM_POWERBROADCAST = 0x0218, PBT_APMSUSPEND = 0x4, PBT_APMRESUMEAUTOMATIC = 0x12, PBT_POWERSETTINGCHANGE = 0x8013;
        static PowerWatch me;
        int last = -1;

        public static void Start()
        {
            try
            {
                me = new PowerWatch();
                CreateParams cp = new CreateParams();
                cp.Caption = "VyseBarPower";
                cp.ExStyle = (int)Native.WS_EX_TOOLWINDOW;
                cp.Style = unchecked((int)0x80000000);
                me.CreateHandle(cp);
                Guid g = ConsoleDisplayState;
                // Windows answers at once with how the screen is now, then on every change
                RegisterPowerSettingNotification(me.Handle, ref g, 0);
            }
            catch (Exception e) { Program.Log("power watch: " + e.Message); }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_POWERBROADCAST)
            {
                long what = m.WParam.ToInt64();
                if (what == PBT_POWERSETTINGCHANGE && m.LParam != IntPtr.Zero)
                {
                    POWERBROADCAST_SETTING s = (POWERBROADCAST_SETTING)Marshal.PtrToStructure(m.LParam, typeof(POWERBROADCAST_SETTING));
                    // 0 off, 1 on, 2 dimmed
                    if (s.PowerSetting == ConsoleDisplayState && s.Data != last)
                    {
                        last = s.Data;
                        Program.Send("screenPower", s.Data);
                    }
                }
                else if (what == PBT_APMSUSPEND) Program.Send("power", "suspend");
                else if (what == PBT_APMRESUMEAUTOMATIC) Program.Send("power", "resume");
            }
            base.WndProc(ref m);
        }
    }
}
