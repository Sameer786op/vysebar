// Peek: hovering a window's preview shows that window full size on the desktop and every other
// window as a glass outline, the way the Windows taskbar does. It is DWM's own live preview, which
// Windows offers only through an unnamed export of dwmapi.dll (ordinal 113). Two things keep the
// dock and the preview you're pointing at in sight: the documented DWMWA_EXCLUDED_FROM_PEEK stops
// the dock fading to glass, and the export's "topmost window" argument draws it above the window
// being shown. Each needs the other: without the first the dock is glass however high it sits,
// and without the second the peeked window covers the preview card.
//
// DWM leaves a peek on even after the program that asked for it has gone, so this file makes
// sure one never outlives its reason: it ends when the pointer leaves the dock, when the window
// closes, after a minute, when VyseBar quits or the helper crashes, and once at every start in
// case an earlier helper died in the middle of one.
using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace VyseHost
{
    public static class Peek
    {
        [DllImport("dwmapi.dll", EntryPoint = "#113")]
        static extern int DwmpActivateLivePreview(int on, IntPtr hwnd, IntPtr topmost, int kind, IntPtr reserved);

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);

        const int DWMWA_EXCLUDED_FROM_PEEK = 12;

        const int KIND_WINDOW = 3;
        static readonly object gate = new object();
        static IntPtr current = IntPtr.Zero;
        static RECT area;
        static DateTime since;
        static Timer watch;

        /// shows `hwnd`, with `dock` kept in front, while the pointer stays inside `keepIn` (the
        /// dock window, in screen pixels)
        public static bool Show(IntPtr hwnd, IntPtr dock, RECT keepIn)
        {
            lock (gate)
            {
                // a minimised or hidden window (closed to the tray, or on another desktop) has
                // nothing to show, and peeking at it would only turn every other window to glass
                if (!Native.IsWindow(hwnd) || Native.IsIconic(hwnd) || !Native.IsWindowVisible(hwnd) || WindowTracker.IsCloaked(hwnd)) { EndLocked(); return false; }
                IntPtr top = IntPtr.Zero;
                if (Native.IsWindow(dock))
                {
                    int yes = 1;
                    DwmSetWindowAttribute(dock, DWMWA_EXCLUDED_FROM_PEEK, ref yes, 4);
                    top = dock;
                }
                int hr;
                // the last argument is a pointer on Windows 10 and 11, and must stay null
                try { hr = DwmpActivateLivePreview(1, hwnd, top, KIND_WINDOW, IntPtr.Zero); }
                catch { return false; } // not there on some future Windows: no peek, nothing else lost
                if (hr != 0) return false;
                current = hwnd;
                area = keepIn;
                since = DateTime.UtcNow;
                if (watch == null) watch = new Timer(Check, null, 150, 150);
                return true;
            }
        }

        public static void End()
        {
            lock (gate) EndLocked();
        }

        /// ends any peek, ours or one an earlier helper left behind
        public static void Reset()
        {
            lock (gate)
            {
                current = IntPtr.Zero;
                StopWatch();
                Off();
            }
        }

        static void EndLocked()
        {
            StopWatch();
            if (current == IntPtr.Zero) return;
            current = IntPtr.Zero;
            Off();
        }

        static void Off()
        {
            try { DwmpActivateLivePreview(0, IntPtr.Zero, IntPtr.Zero, KIND_WINDOW, IntPtr.Zero); }
            catch { }
        }

        static void StopWatch()
        {
            if (watch == null) return;
            watch.Dispose();
            watch = null;
        }

        // the safety net under the dock's own "stop": a lost mouse-leave can't leave a peek on
        static void Check(object state)
        {
            lock (gate)
            {
                if (current == IntPtr.Zero) return;
                POINT p;
                bool inside = GetCursorPos(out p) && p.x >= area.left && p.x < area.right && p.y >= area.top && p.y < area.bottom;
                if (!inside || !Native.IsWindow(current) || !Native.IsWindowVisible(current) || (DateTime.UtcNow - since).TotalSeconds > 60) EndLocked();
            }
        }
    }
}
