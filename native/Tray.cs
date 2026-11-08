// The notification area. With the taskbar hidden, background apps' tray icons (Discord, Steam,
// OneDrive...) can't be reached, so VyseHost stands in as the tray: a hidden "Shell_TrayWnd"
// window kept ahead of Explorer's, which is the window Shell_NotifyIcon sends every icon to.
// Each message is read and then passed on to Explorer untouched, so Explorer's own tray stays
// complete and nothing is lost when VyseBar quits. Taskbar replacements such as RetroBar work
// the same way. It runs only while a tray widget is on screen.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

namespace VyseHost
{
    public static class Tray
    {
        delegate IntPtr WndProcD(IntPtr h, uint m, IntPtr w, IntPtr l);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct WNDCLASSEX
        {
            public int cbSize; public uint style; public WndProcD lpfnWndProc; public int cbClsExtra, cbWndExtra;
            public IntPtr hInstance, hIcon, hCursor, hbrBackground; public string lpszMenuName, lpszClassName; public IntPtr hIconSm;
        }
        [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
        [StructLayout(LayoutKind.Sequential)] struct COPYDATASTRUCT { public IntPtr dwData; public int cbData; public IntPtr lpData; }
        [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool fIcon; public int xHotspot, yHotspot; public IntPtr hbmMask, hbmColor; }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ushort RegisterClassEx(ref WNDCLASSEX c);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr p);
        [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string t);
        [DllImport("user32.dll")] static extern bool SendNotifyMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr result);
        [DllImport("user32.dll")] static extern bool InSendMessage();
        [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
        [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
        [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
        [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid, uint m, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern IntPtr SetTimer(IntPtr h, IntPtr id, uint ms, IntPtr fn);
        [DllImport("user32.dll")] static extern bool KillTimer(IntPtr h, IntPtr id);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
        [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
        [DllImport("user32.dll")] static extern IntPtr CopyIcon(IntPtr h);
        [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
        [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr h, out ICONINFO ii);
        [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
        [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
        [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
        delegate bool PropEnumEx(IntPtr h, IntPtr name, IntPtr data, IntPtr param);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int EnumPropsEx(IntPtr h, PropEnumEx cb, IntPtr param);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SetProp(IntPtr h, string name, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr h, string name);

        const uint WM_TIMER = 0x113, WM_COPYDATA = 0x4A, WM_COMMAND = 0x111, WM_USER = 0x400, WM_QUIT = 0x12, WM_CONTEXTMENU = 0x7B;
        const uint WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202, WM_LBUTTONDBLCLK = 0x203, WM_RBUTTONDOWN = 0x204, WM_RBUTTONUP = 0x205;
        const uint NIN_SELECT = WM_USER;
        const int NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIM_SETVERSION = 4;
        const int NIF_MESSAGE = 1, NIF_ICON = 2, NIF_TIP = 4, NIF_STATE = 8, NIF_GUID = 0x20;
        const int NIS_HIDDEN = 1;
        const int SIGNATURE = 0x34753423;
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOACTIVATE = 0x10;
        const uint WM_WINDOWPOSCHANGING = 0x46;
        const int SWP_SHOWWINDOW = 0x40;
        // the stand-in is never shown (see WndProc); when an app tries, the log says so
        static bool showTried;
        static DateTime showLogged = DateTime.MinValue;
        static readonly IntPtr TICK = new IntPtr(1), EMIT = new IntPtr(2);

        class Item
        {
            public string Key;
            public IntPtr Hwnd;
            public uint Uid, Callback, Version, Pid;
            public Guid Guid;
            public bool HasGuid, Hidden, Stale = true;
            public IntPtr Icon;
            public string Png, Tip = "", Exe, Name;
            public long Order;
            public DateTime LastLeft;
        }

        static readonly object Lock = new object();
        static readonly Dictionary<string, Item> items = new Dictionary<string, Item>();
        static readonly WndProcD proc = WndProc; // kept alive: Windows calls it for the window's life
        static Thread thread;
        static uint threadId;
        static IntPtr me, explorer;
        static uint taskbarCreated;
        static long order;
        static bool classMade;
        static DateTime ownBroadcastUntil, lastBroadcast, startedAt;
        static bool secondAsk;
        // an icon keeps its place when its app takes it down and puts it back (Electron apps do
        // that on every re-add, often with a new window)
        static readonly Dictionary<string, long> places = new Dictionary<string, long>();

        public static IntPtr Hwnd { get { return me; } }

        /// Explorer's real taskbar, skipping the stand-in
        public static IntPtr Explorer()
        {
            uint self = GetCurrentProcessId();
            IntPtr h = IntPtr.Zero;
            while ((h = FindWindowEx(IntPtr.Zero, h, "Shell_TrayWnd", null)) != IntPtr.Zero)
            {
                uint pid;
                Native.GetWindowThreadProcessId(h, out pid);
                if (h != me && pid != self) return h;
            }
            return IntPtr.Zero;
        }

        /// the TaskbarCreated that the tray sent itself, not Explorer restarting
        public static bool IsOwnBroadcast() { return DateTime.UtcNow < ownBroadcastUntil && Explorer() == explorer; }

        public static object Start()
        {
            lock (Lock)
            {
                if (thread != null) return true;
                ManualResetEvent made = new ManualResetEvent(false);
                thread = new Thread(delegate () { Run(made); });
                thread.IsBackground = true;
                thread.Start();
                made.WaitOne(3000);
            }
            return true;
        }

        public static object Stop()
        {
            Thread t;
            lock (Lock)
            {
                t = thread;
                thread = null;
                if (t == null) return true;
                PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            }
            t.Join(2000);
            return true;
        }

        static void Run(ManualResetEvent made)
        {
            threadId = Native.GetCurrentThreadId();
            IntPtr inst = GetModuleHandle(null);
            if (!classMade)
            {
                WNDCLASSEX wc = new WNDCLASSEX();
                wc.cbSize = Marshal.SizeOf(wc);
                wc.lpfnWndProc = proc;
                wc.hInstance = inst;
                wc.lpszClassName = "Shell_TrayWnd";
                classMade = RegisterClassEx(ref wc) != 0 || Marshal.GetLastWin32Error() == 1410;
            }
            taskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");
            explorer = Explorer();
            RECT r = new RECT();
            if (explorer != IntPtr.Zero) Native.GetWindowRect(explorer, out r);
            // hidden (no WS_VISIBLE) but where the taskbar is, for apps that ask where the tray sits
            me = CreateWindowEx(0x8 | 0x80, "Shell_TrayWnd", "", 0x80000000, r.left, r.top, r.right - r.left, r.bottom - r.top, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
            made.Set();
            if (me == IntPtr.Zero) { lock (Lock) thread = null; return; }
            CopyProps();
            startedAt = DateTime.UtcNow;
            secondAsk = false;
            Claim(true);
            SetTimer(me, TICK, 2000, IntPtr.Zero);

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            KillTimer(me, TICK);
            foreach (string name in props) RemoveProp(me, name);
            props.Clear();
            DestroyWindow(me);
            me = IntPtr.Zero;
            lock (Lock)
            {
                foreach (Item it in items.Values) if (it.Icon != IntPtr.Zero) DestroyIcon(it.Icon);
                items.Clear();
            }
        }

        // Apps reach the taskbar through properties on its window: taskbar badges and progress
        // (ITaskbarList) read "TaskbandHWND" there and fail without it. The stand-in carries
        // Explorer's values, all but the ones that point into Explorer's own memory
        static readonly HashSet<string> props = new HashSet<string>();

        static void CopyProps()
        {
            if (explorer == IntPtr.Zero) return;
            EnumPropsEx(explorer, delegate (IntPtr h, IntPtr name, IntPtr data, IntPtr p)
            {
                if (name.ToInt64() < 0x10000) return true;
                string n = Marshal.PtrToStringUni(name);
                if (n.StartsWith("Ole") || n.StartsWith("MSAA") || n.StartsWith("Ux")) return true;
                if (SetProp(me, n, data)) props.Add(n);
                return true;
            }, IntPtr.Zero);
        }

        // first in line for Shell_NotifyIcon; with announce, every app is asked to add its icons again
        static void Claim(bool announce)
        {
            SetWindowPos(me, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            if (!announce) return;
            ownBroadcastUntil = DateTime.UtcNow.AddSeconds(3);
            lastBroadcast = DateTime.UtcNow;
            SendNotifyMessage(new IntPtr(0xffff), taskbarCreated, IntPtr.Zero, IntPtr.Zero);
        }

        static IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l)
        {
            if (m == WM_WINDOWPOSCHANGING && l != IntPtr.Zero)
            {
                // An app that shows "the taskbar" by its class name finds this window first, as it
                // is in front of Explorer's. Shown, it would cover the dock in front of everything,
                // so it never shows: SWP_SHOWWINDOW comes out of WINDOWPOS.flags (after two
                // handles and four ints)
                int at = 2 * IntPtr.Size + 16;
                int flags = Marshal.ReadInt32(l, at);
                if ((flags & SWP_SHOWWINDOW) != 0)
                {
                    Marshal.WriteInt32(l, at, flags & ~SWP_SHOWWINDOW);
                    showTried = true;
                }
                return DefWindowProc(h, m, w, l);
            }
            if (m == WM_TIMER)
            {
                // an error must not escape into Windows from here: it would end the helper
                try
                {
                    if (w == TICK) Tick();
                    else if (w == EMIT) { KillTimer(me, EMIT); Program.Send("tray", List()); }
                }
                catch (Exception e) { Program.LogError("tray", e); }
                return IntPtr.Zero;
            }
            if (m == taskbarCreated)
            {
                // Explorer restarted and asked apps to re-add their icons to its new taskbar: the
                // next tick takes the lead back and asks again
                if (!IsOwnBroadcast()) explorer = IntPtr.Zero;
                return IntPtr.Zero;
            }
            bool ours = false;
            if (m == WM_COPYDATA && l != IntPtr.Zero)
            {
                try { ours = Read(l); } catch { }
            }
            if (m == WM_COPYDATA || m == WM_COMMAND || m >= WM_USER)
            {
                IntPtr ex = Explorer();
                if (ex == IntPtr.Zero) return ours ? new IntPtr(1) : IntPtr.Zero;
                if (!InSendMessage()) { Native.PostMessage(ex, m, w, l); return IntPtr.Zero; }
                IntPtr result;
                SendMessageTimeout(ex, m, w, l, 0x2 /* SMTO_ABORTIFHUNG */, 4000, out result);
                // Explorer turns down a second add of an icon it already has; the app's call worked
                return ours && result == IntPtr.Zero ? new IntPtr(1) : result;
            }
            return DefWindowProc(h, m, w, l);
        }

        // one Shell_NotifyIcon call: SHELLTRAYDATA { signature, message, NOTIFYICONDATA (32-bit layout) }
        static bool Read(IntPtr l)
        {
            COPYDATASTRUCT cd = (COPYDATASTRUCT)Marshal.PtrToStructure(l, typeof(COPYDATASTRUCT));
            if (cd.dwData.ToInt64() != 1 || cd.cbData < 8 + 288 || cd.lpData == IntPtr.Zero) return false;
            IntPtr p = cd.lpData;
            if (Marshal.ReadInt32(p, 0) != SIGNATURE) return false;
            int msg = Marshal.ReadInt32(p, 4);
            IntPtr n = p + 8;
            int size = cd.cbData - 8;
            IntPtr hwnd = new IntPtr((long)Marshal.ReadInt32(n, 4));
            uint uid = (uint)Marshal.ReadInt32(n, 8);
            int flags = Marshal.ReadInt32(n, 12);
            bool hasGuid = (flags & NIF_GUID) != 0 && size >= 952;
            Guid guid = Guid.Empty;
            if (hasGuid)
            {
                byte[] g = new byte[16];
                Marshal.Copy(n + 936, g, 0, 16);
                guid = new Guid(g);
            }
            string key = hasGuid ? "g" + guid.ToString("N") : "h" + hwnd.ToInt64().ToString("x") + "_" + uid;

            lock (Lock)
            {
                Item it;
                items.TryGetValue(key, out it);
                if (msg == NIM_DELETE)
                {
                    if (it == null) return false;
                    if (it.Icon != IntPtr.Zero) DestroyIcon(it.Icon);
                    items.Remove(key);
                    QueueEmit();
                    return true;
                }
                if (msg == NIM_SETVERSION)
                {
                    if (it == null) return false;
                    it.Version = (uint)Marshal.ReadInt32(n, 800);
                    return it.Version <= 4;
                }
                if (msg != NIM_ADD && msg != NIM_MODIFY) return false;
                if (it == null)
                {
                    if (msg == NIM_MODIFY) return false;
                    it = new Item();
                    it.Key = key;
                    items[key] = it;
                }
                if (hwnd != IntPtr.Zero && hwnd != it.Hwnd)
                {
                    it.Hwnd = hwnd;
                    uint pid;
                    Native.GetWindowThreadProcessId(hwnd, out pid);
                    it.Pid = pid;
                    it.Exe = WindowTracker.ExeOf(pid);
                    it.Name = null;
                }
                if (it.Order == 0)
                {
                    string place = (it.Exe ?? key).ToLowerInvariant() + "|" + (hasGuid ? guid.ToString("N") : uid.ToString());
                    long o;
                    if (!places.TryGetValue(place, out o)) places[place] = o = ++order;
                    it.Order = o;
                }
                it.Uid = uid;
                it.HasGuid = hasGuid;
                it.Guid = guid;
                if ((flags & NIF_MESSAGE) != 0) it.Callback = (uint)Marshal.ReadInt32(n, 16);
                if ((flags & NIF_ICON) != 0)
                {
                    // the app may free its icon as soon as this call returns: keep a copy
                    IntPtr icon = new IntPtr((long)Marshal.ReadInt32(n, 20));
                    if (it.Icon != IntPtr.Zero) DestroyIcon(it.Icon);
                    it.Icon = icon == IntPtr.Zero ? IntPtr.Zero : CopyIcon(icon);
                    it.Stale = true;
                }
                if ((flags & NIF_TIP) != 0)
                {
                    char[] tip = new char[128];
                    Marshal.Copy(n + 24, tip, 0, 128);
                    string t = new string(tip);
                    int z = t.IndexOf('\0');
                    it.Tip = (z >= 0 ? t.Substring(0, z) : t).Trim();
                }
                if ((flags & NIF_STATE) != 0)
                {
                    int state = Marshal.ReadInt32(n, 280), mask = Marshal.ReadInt32(n, 284);
                    if ((mask & NIS_HIDDEN) != 0) it.Hidden = (state & NIS_HIDDEN) != 0;
                }
                QueueEmit();
                return true;
            }
        }

        static void QueueEmit() { SetTimer(me, EMIT, 250, IntPtr.Zero); }

        static void Tick()
        {
            bool changed = false;
            lock (Lock)
            {
                List<string> gone = new List<string>();
                foreach (Item it in items.Values) if (it.Hwnd != IntPtr.Zero && !Native.IsWindow(it.Hwnd)) gone.Add(it.Key);
                foreach (string k in gone)
                {
                    if (items[k].Icon != IntPtr.Zero) DestroyIcon(items[k].Icon);
                    items.Remove(k);
                    changed = true;
                }
            }
            IntPtr ex = Explorer();
            if (ex != explorer && ex != IntPtr.Zero)
            {
                // a new Explorer: sit in front of it again and have the apps re-add their icons
                explorer = ex;
                CopyProps();
                Claim(true);
            }
            else
            {
                CopyProps();
                if (FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Shell_TrayWnd", null) != me)
                {
                    // Explorer got in front (it does when the taskbar's state changes): icons added
                    // meanwhile went to it alone, so the apps are asked again, at most once a minute
                    Claim((DateTime.UtcNow - lastBroadcast).TotalSeconds > 60 || (DateTime.UtcNow - startedAt).TotalSeconds < 20);
                }
                else if (!secondAsk && (DateTime.UtcNow - startedAt).TotalSeconds >= 5)
                {
                    // slow apps answer a second ask that arrives once start-up has settled
                    secondAsk = true;
                    Claim(true);
                }
            }
            // shown all the same (a way around WndProc): hidden again within two seconds
            if (Native.IsWindowVisible(me))
            {
                Native.ShowWindow(me, 0 /* SW_HIDE */);
                showTried = true;
            }
            if (showTried)
            {
                showTried = false;
                if ((DateTime.UtcNow - showLogged).TotalMinutes >= 10)
                {
                    showLogged = DateTime.UtcNow;
                    Program.Log("an app tried to show the taskbar where VyseBar stands in for it, which would have covered the dock: kept hidden");
                }
            }
            if (changed) QueueEmit();
        }

        // Windows' own icons (volume, network, power...) have widgets of their own on the dock
        static bool IsSystem(Item it)
        {
            if (!it.HasGuid || it.Exe == null || !it.Exe.EndsWith("\\explorer.exe", StringComparison.OrdinalIgnoreCase)) return false;
            return it.Guid.ToString().EndsWith("-23e3-4229-82c1-e41cb67d5b9c", StringComparison.OrdinalIgnoreCase);
        }

        public static object List()
        {
            Dictionary<string, bool> promoted = Promoted();
            List<Item> list;
            lock (Lock) list = new List<Item>(items.Values);
            list.Sort(delegate (Item a, Item b) { return a.Order.CompareTo(b.Order); });
            List<object> outList = new List<object>();
            foreach (Item it in list)
            {
                if (it.Hidden || it.Icon == IntPtr.Zero || IsSystem(it)) continue;
                lock (Lock)
                {
                    if (it.Stale)
                    {
                        try { it.Png = IconPng(it.Icon); } catch { it.Png = null; }
                        it.Stale = false;
                    }
                }
                if (it.Png == null) continue;
                if (it.Name == null) it.Name = NameOf(it.Exe);
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["key"] = it.Key;
                d["tip"] = it.Tip;
                d["name"] = it.Name;
                d["icon"] = it.Png;
                d["exe"] = it.Exe;
                bool pin;
                d["pinned"] = promoted.TryGetValue(MatchKey(it.Exe, it.HasGuid, it.Guid, it.Uid), out pin) && pin;
                outList.Add(d);
            }
            return outList;
        }

        static string NameOf(string exe)
        {
            if (exe == null) return "";
            try
            {
                string desc = FileVersionInfo.GetVersionInfo(exe).FileDescription;
                if (!string.IsNullOrWhiteSpace(desc)) return desc.Trim();
            }
            catch { }
            return Path.GetFileNameWithoutExtension(exe);
        }

        /// a left click opens most apps; a right click asks for the app's own menu, at the pointer
        public static object Click(string key, string button)
        {
            Item it;
            lock (Lock) items.TryGetValue(key ?? "", out it);
            if (it == null || it.Callback == 0 || !Native.IsWindow(it.Hwnd)) return false;
            POINT p;
            GetCursorPos(out p);
            // an empty input makes this process the last-input one, which may hand the foreground
            // on: the app can then bring its window or menu to the front
            INPUT[] input = new INPUT[1];
            input[0].type = Native.INPUT_MOUSE;
            Native.SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
            AllowSetForegroundWindow(it.Pid);

            bool v4 = it.Version >= 4;
            // version 4 icons take the pointer in wParam and (event, id) in lParam; older ones (id, event)
            IntPtr wp = new IntPtr(v4 ? ((p.y & 0xffff) << 16) | (p.x & 0xffff) : unchecked((int)it.Uid));
            Action<uint> send = delegate (uint ev)
            {
                SendNotifyMessage(it.Hwnd, it.Callback, wp, new IntPtr(unchecked((int)(v4 ? ev | (it.Uid << 16) : ev))));
            };
            if (button == "right")
            {
                send(WM_RBUTTONDOWN);
                send(WM_RBUTTONUP);
                if (v4) send(WM_CONTEXTMENU);
            }
            else
            {
                bool dbl = (DateTime.UtcNow - it.LastLeft).TotalMilliseconds <= GetDoubleClickTime();
                send(dbl ? WM_LBUTTONDBLCLK : WM_LBUTTONDOWN);
                send(WM_LBUTTONUP);
                if (v4) send(NIN_SELECT);
                it.LastLeft = dbl ? DateTime.MinValue : DateTime.UtcNow;
            }
            return true;
        }

        // Windows remembers which icons sit on the taskbar and which in the overflow
        static Dictionary<string, bool> promotedCache;
        static DateTime promotedAt;

        static Dictionary<string, bool> Promoted()
        {
            if (promotedCache != null && (DateTime.UtcNow - promotedAt).TotalSeconds < 10) return promotedCache;
            Dictionary<string, bool> d = new Dictionary<string, bool>();
            try
            {
                using (RegistryKey root = Registry.CurrentUser.OpenSubKey(@"Control Panel\NotifyIconSettings"))
                {
                    if (root != null)
                    {
                        foreach (string name in root.GetSubKeyNames())
                        {
                            using (RegistryKey k = root.OpenSubKey(name))
                            {
                                if (k == null) continue;
                                string exe = ExpandKnownFolder(k.GetValue("ExecutablePath") as string);
                                if (exe == null) continue;
                                object g = k.GetValue("IconGuid"), uid = k.GetValue("UID"), pr = k.GetValue("IsPromoted");
                                Guid guid = Guid.Empty;
                                bool hasGuid = g is string && Guid.TryParse((string)g, out guid);
                                d[MatchKey(exe, hasGuid, guid, uid == null ? 0 : Convert.ToUInt32(uid))] = pr != null && Convert.ToInt32(pr) == 1;
                            }
                        }
                    }
                }
            }
            catch { }
            promotedCache = d;
            promotedAt = DateTime.UtcNow;
            return d;
        }

        static string MatchKey(string exe, bool hasGuid, Guid guid, uint uid)
        {
            return (exe ?? "").ToLowerInvariant() + "|" + (hasGuid ? guid.ToString("N") : uid.ToString());
        }

        // "{6D809377-...}\App\app.exe": a known folder, then the rest of the path
        static string ExpandKnownFolder(string path)
        {
            if (string.IsNullOrEmpty(path) || path[0] != '{') return path;
            int end = path.IndexOf('}');
            Guid id;
            if (end < 0 || !Guid.TryParse(path.Substring(0, end + 1), out id)) return path;
            IntPtr p;
            if (SHGetKnownFolderPath(ref id, 0, IntPtr.Zero, out p) != 0) return path;
            string folder = Marshal.PtrToStringUni(p);
            Marshal.FreeCoTaskMem(p);
            return folder + path.Substring(end + 1);
        }

        static string IconPng(IntPtr icon)
        {
            ICONINFO ii;
            if (!GetIconInfo(icon, out ii)) return null;
            try
            {
                if (ii.hbmColor == IntPtr.Zero) return null;
                BITMAP bm = new BITMAP();
                Native.GetObject(ii.hbmColor, Marshal.SizeOf(bm), ref bm);
                int w = bm.bmWidth, h = Math.Abs(bm.bmHeight);
                if (w <= 0 || h <= 0 || w > 256 || h > 256) return null;
                byte[] bits = Bits(ii.hbmColor, w, h);
                bool hasAlpha = false;
                for (int i = 3; i < bits.Length; i += 4) if (bits[i] != 0) { hasAlpha = true; break; }
                if (!hasAlpha)
                {
                    // an icon without alpha uses its mask: white there means see-through
                    byte[] mask = ii.hbmMask != IntPtr.Zero ? Bits(ii.hbmMask, w, h) : null;
                    for (int i = 0; i < bits.Length; i += 4) bits[i + 3] = mask != null && mask[i] != 0 ? (byte)0 : (byte)255;
                }
                using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                {
                    BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                    for (int y = 0; y < h; y++) Marshal.Copy(bits, y * w * 4, data.Scan0 + y * data.Stride, w * 4);
                    bmp.UnlockBits(data);
                    using (MemoryStream ms = new MemoryStream())
                    {
                        bmp.Save(ms, ImageFormat.Png);
                        return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                    }
                }
            }
            finally
            {
                if (ii.hbmColor != IntPtr.Zero) Native.DeleteObject(ii.hbmColor);
                if (ii.hbmMask != IntPtr.Zero) Native.DeleteObject(ii.hbmMask);
            }
        }

        static byte[] Bits(IntPtr hbmp, int w, int h)
        {
            BITMAPINFOHEADER bmi = new BITMAPINFOHEADER();
            bmi.biSize = Marshal.SizeOf(bmi);
            bmi.biWidth = w;
            bmi.biHeight = -h;
            bmi.biPlanes = 1;
            bmi.biBitCount = 32;
            byte[] bits = new byte[w * h * 4];
            IntPtr dc = Native.CreateCompatibleDC(IntPtr.Zero);
            Native.GetDIBits(dc, hbmp, 0, (uint)h, bits, ref bmi, 0);
            Native.DeleteDC(dc);
            return bits;
        }
    }
}
