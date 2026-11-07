// VyseBar's window thread must keep answering. One that stops for good (a script stuck in a
// loop, a deadlock) leaves a dock that can't be used, quit or closed from itself, and nothing
// inside VyseBar can put that right. So the helper, which runs outside VyseBar's process tree,
// asks it every few seconds; after most of a minute with no answer it writes that down, ends
// the stuck VyseBar, puts the taskbar back and starts VyseBar again.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace VyseHost
{
    public static class Watchdog
    {
        delegate bool EnumProc(IntPtr h, IntPtr l);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);

        const uint WM_NULL = 0, SMTO_BLOCK = 1, SMTO_ABORTIFHUNG = 2;
        const int Every = 5000;
        static string exe, args, cwd;
        static int limit = 45;
        static Thread thread;

        /// main says how to start VyseBar again (its own command line) and how long counts as stuck
        public static object Arm(string exePath, string arguments, string dir, int seconds)
        {
            if (string.IsNullOrEmpty(exePath) || Program.ParentPid == 0) return false;
            exe = exePath;
            args = arguments ?? "";
            cwd = dir;
            limit = Math.Max(20, seconds);
            if (thread == null)
            {
                thread = new Thread(Loop);
                thread.IsBackground = true;
                thread.Start();
            }
            return true;
        }

        // one of VyseBar's own windows (a dock or Settings): all of them belong to its window thread
        static IntPtr Window()
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (pid != Program.ParentPid) return true;
                StringBuilder sb = new StringBuilder(64);
                GetClassName(h, sb, sb.Capacity);
                if (sb.ToString() != "Chrome_WidgetWin_1") return true;
                found = h;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        static void Loop()
        {
            int missed = 0;
            bool answeredOnce = false;
            while (true)
            {
                Thread.Sleep(Every);
                try
                {
                    IntPtr h = Window();
                    if (h == IntPtr.Zero) { missed = 0; continue; }
                    IntPtr r;
                    // a thread that is only slow answers within the wait; one that hasn't looked at its
                    // messages for 5 s counts as not answering straight away
                    bool answered = Native.SendMessageTimeout(h, WM_NULL, IntPtr.Zero, IntPtr.Zero, SMTO_BLOCK | SMTO_ABORTIFHUNG, 5000, out r) != IntPtr.Zero;
                    if (answered) { missed = 0; answeredOnce = true; continue; }
                    // misses are counted, not clock time: a PC that slept in between doesn't add up
                    if (!answeredOnce || ++missed * Every < limit * 1000) continue;
                    Recover(missed * Every / 1000);
                    return;
                }
                catch (Exception e) { Program.LogError("watchdog", e); }
            }
        }

        static void Recover(int seconds)
        {
            Program.Diary("VyseBar stopped answering for about " + seconds + " s: restarting it");
            // stdin closing as VyseBar ends must not run the usual shutdown: this finishes up
            Program.BeginRecovery();
            try
            {
                Process p = Process.GetProcessById((int)Program.ParentPid);
                p.Kill();
                p.WaitForExit(10000);
            }
            catch { }
            Program.Cleanup();
            try
            {
                // not inherited from the stuck VyseBar: its crash handler's pipe is gone with it
                Environment.SetEnvironmentVariable("CHROME_CRASHPAD_PIPE_NAME", null);
                ProcessStartInfo si = new ProcessStartInfo(exe, args);
                si.UseShellExecute = true;
                if (!string.IsNullOrEmpty(cwd) && Directory.Exists(cwd)) si.WorkingDirectory = cwd;
                Process.Start(si);
            }
            catch (Exception e) { Program.Diary("could not start VyseBar again: " + e.GetType().Name); }
            Environment.Exit(0);
        }
    }
}
