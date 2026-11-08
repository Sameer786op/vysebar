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
