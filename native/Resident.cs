// Keeping the dock quick on a PC that is short of memory or busy. Windows takes memory from the
// processes it thinks are idle and gives it to the busy ones; with little memory free (a game
// holding most of it) what it takes goes to disk, and the next hover or click on the dock waits
// while Windows reads it back, sometimes for seconds. A taskbar can't wait like that, so in
// Smooth mode main asks for the dock's own processes (main, the dock pages, the graphics process
// and this helper) to get:
//   - a floor of memory Windows leaves them however short it gets,
//   - a place ahead of ordinary apps for the CPU (main and the dock pages; Chromium already puts
//     its graphics process there),
//   - no efficiency throttling (Windows slows processes without a window of their own in front).
// Lite mode, for PCs with little memory, asks for none of it and releases what was set.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VyseHost
{
    static class Resident
    {
        [StructLayout(LayoutKind.Sequential)] struct Throttle { public uint Version, ControlMask, StateMask; }
        [StructLayout(LayoutKind.Sequential)] struct LUID { public uint Low; public int High; }
        [StructLayout(LayoutKind.Sequential)] struct TOKEN_PRIVILEGES { public uint Count; public LUID Luid; public uint Attributes; }

        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessWorkingSetSizeEx(IntPtr h, UIntPtr min, UIntPtr max, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessWorkingSetSizeEx(IntPtr h, out UIntPtr min, out UIntPtr max, out uint flags);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetPriorityClass(IntPtr h, uint cls);
        [DllImport("kernel32.dll")] static extern uint GetPriorityClass(IntPtr h);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessInformation(IntPtr h, int cls, ref Throttle info, int size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int cls, ref Throttle info, int size);
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValue(string system, string name, out LUID luid);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES state, int len, IntPtr prev, IntPtr retLen);

        const uint PROCESS_SET_QUOTA = 0x0100, PROCESS_SET_INFORMATION = 0x0200, PROCESS_QUERY_INFORMATION = 0x0400;
        const uint HARDWS_MIN_ENABLE = 1, HARDWS_MIN_DISABLE = 2, HARDWS_MAX_DISABLE = 8;
        const uint NORMAL = 0x20, ABOVE_NORMAL = 0x8000;
        const int ProcessPowerThrottling = 4;
        const uint EXECUTION_SPEED = 1;
        static bool privileged;

        /// procs: [{pid, mb, above}] (above: true puts a normal process ahead, false puts one VyseBar
        /// put ahead back, absent leaves it); self: MB for the helper; release: undo all of it
        public static object Apply(Dictionary<string, object> a)
        {
            if (!privileged)
            {
                privileged = true;
                // a floor above what a process has in RAM now needs this one (every user has it)
                Privilege("SeIncreaseWorkingSetPrivilege");
            }
            bool release = Program.Bool(a, "release", false);
            Dictionary<string, object> result = new Dictionary<string, object>();
            object raw;
            if (a.TryGetValue("procs", out raw) && raw is System.Collections.IEnumerable)
            {
                foreach (object o in (System.Collections.IEnumerable)raw)
                {
                    Dictionary<string, object> p = o as Dictionary<string, object>;
                    if (p == null) continue;
                    int pid = (int)Program.Long(p, "pid", 0);
                    if (pid <= 0) continue;
                    int above = !p.ContainsKey("above") || p["above"] == null ? 0 : Program.Bool(p, "above", false) && !release ? 1 : -1;
                    result[pid.ToString()] = One(pid, release ? 0 : (int)Program.Long(p, "mb", 0), above, release);
                }
            }
            long self = Program.Long(a, "self", 0);
            if (self > 0 || release)
            {
                using (Process me = Process.GetCurrentProcess()) result["helper"] = One(me.Id, release ? 0 : (int)self, 0, release);
            }
            return result;
        }

        static string One(int pid, int mb, int above, bool release)
        {
            IntPtr h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return "no access (" + Marshal.GetLastWin32Error() + ")";
            try
            {
                List<string> said = new List<string>();
                UIntPtr min, max;
                uint flags;
                bool got = GetProcessWorkingSetSizeEx(h, out min, out max, out flags);
                if (mb > 0)
                {
                    ulong want = (ulong)mb * 1048576;
                    if (got && (flags & HARDWS_MIN_ENABLE) != 0 && (ulong)min == want) said.Add("memory kept " + mb + " MB");
                    else if (SetProcessWorkingSetSizeEx(h, new UIntPtr(want), new UIntPtr(want * 4), HARDWS_MIN_ENABLE | HARDWS_MAX_DISABLE)) said.Add("memory kept " + mb + " MB");
                    else said.Add("memory not kept (" + Marshal.GetLastWin32Error() + ")");
                }
                else if (got && (flags & HARDWS_MIN_ENABLE) != 0)
                {
                    // back to Windows' own defaults
                    SetProcessWorkingSetSizeEx(h, new UIntPtr(204800), new UIntPtr(1413120), HARDWS_MIN_DISABLE | HARDWS_MAX_DISABLE);
                    said.Add("memory released");
                }

                uint cls = GetPriorityClass(h);
                if (above > 0 && cls == NORMAL) said.Add(SetPriorityClass(h, ABOVE_NORMAL) ? "ahead for the CPU" : "not ahead (" + Marshal.GetLastWin32Error() + ")");
                else if (above > 0 && cls == ABOVE_NORMAL) said.Add("ahead for the CPU");
                else if (above < 0 && cls == ABOVE_NORMAL && SetPriorityClass(h, NORMAL)) said.Add("back to normal for the CPU");

                // efficiency throttling: off (or back to Windows' choice), the rest left as it is
                Throttle t = new Throttle { Version = 1 };
                if (!GetProcessInformation(h, ProcessPowerThrottling, ref t, Marshal.SizeOf(typeof(Throttle)))) t = new Throttle { Version = 1 };
                t.Version = 1;
                if (release) t.ControlMask &= ~EXECUTION_SPEED;
                else t.ControlMask |= EXECUTION_SPEED;
                t.StateMask &= ~EXECUTION_SPEED;
                if (SetProcessInformation(h, ProcessPowerThrottling, ref t, Marshal.SizeOf(typeof(Throttle)))) said.Add(release ? "throttling Windows' choice" : "never throttled");
                else said.Add("throttling unchanged (" + Marshal.GetLastWin32Error() + ")");
                return string.Join(", ", said.ToArray());
            }
            finally { CloseHandle(h); }
        }

        static void Privilege(string name)
        {
            IntPtr token;
            if (!OpenProcessToken(GetCurrentProcess(), 0x20 /* ADJUST_PRIVILEGES */ | 0x8 /* QUERY */, out token)) return;
            try
            {
                LUID luid;
                if (!LookupPrivilegeValue(null, name, out luid)) return;
                TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES { Count = 1, Luid = luid, Attributes = 2 /* ENABLED */ };
                AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
            }
            finally { CloseHandle(token); }
        }
    }
}
