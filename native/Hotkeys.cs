// Win+1...9 and Win+0 open the dock's apps, the way the Windows taskbar's keys open its own.
// With Explorer's taskbar hidden, Windows still answers those keys with Explorer's pinned apps
// in Explorer's order, which isn't what the dock shows; a low-level keyboard hook takes them
// first and tells the dock which slot was asked for.
//
// The hook runs on a thread of its own that does nothing else, so nothing the helper is busy
// with can ever hold up a keystroke anywhere on the PC. It looks at a key and returns at once.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace VyseHost
{
    public static class Hotkeys
    {
        delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr extra; }

        [StructLayout(LayoutKind.Sequential)]
        struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }

        [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
        [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
        [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);

        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
        const uint WM_QUIT = 0x12;
        const uint VK_LWIN = 0x5B, VK_RWIN = 0x5C;
        const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
        // an unassigned key: pressed while Win is down it tells Windows that Win wasn't tapped on
        // its own, so letting go of Win doesn't open Start
        const ushort VK_MASK = 0xE8;

        static readonly object gate = new object();
        static Thread thread;
        static uint threadId;
        static HookProc proc; // held here: Windows keeps calling it, the GC mustn't collect it
        static bool lwin, rwin;
        static readonly HashSet<uint> held = new HashSet<uint>();

        public static void Enable(bool on)
        {
            lock (gate)
            {
                if (on) Start(); else Stop();
            }
        }

        static void Start()
        {
            if (thread != null) return;
            ManualResetEvent ready = new ManualResetEvent(false);
            thread = new Thread(delegate ()
            {
                threadId = GetCurrentThreadId();
                proc = Hook;
                IntPtr h = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
                ready.Set();
                MSG m;
                while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
                if (h != IntPtr.Zero) UnhookWindowsHookEx(h);
            });
            thread.IsBackground = true;
            thread.Priority = ThreadPriority.Highest;
            thread.Start();
            ready.WaitOne(2000);
        }

        static void Stop()
        {
            if (thread == null) return;
            PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            thread.Join(1000);
            thread = null;
            lwin = rwin = false;
            held.Clear();
        }

        static bool Down(int vk) { return GetAsyncKeyState(vk) < 0; }

        static IntPtr Hook(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code < 0) return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            int msg = wParam.ToInt32();
            bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            bool up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            // keys typed by other programs (a macro tool's Win+1) count like real ones; our own
            // mask key is neither Win nor a digit, so it passes straight through below
            if (k.vkCode == VK_LWIN) { if (down) lwin = true; else if (up) lwin = false; }
            else if (k.vkCode == VK_RWIN) { if (down) rwin = true; else if (up) rwin = false; }
            else if (k.vkCode >= 0x30 && k.vkCode <= 0x39)
            {
                if (up && held.Remove(k.vkCode)) return new IntPtr(1);
                if (down && (lwin || rwin))
                {
                    // holding the key repeats it: one press, one action
                    if (held.Add(k.vkCode))
                    {
                        Mask();
                        int index = k.vkCode == 0x30 ? 9 : (int)k.vkCode - 0x31;
                        bool shift = Down(VK_SHIFT), ctrl = Down(VK_CONTROL), alt = Down(VK_MENU);
                        // the Windows taskbar's set: Win+n opens or switches, +Shift a new window,
                        // +Ctrl the app's last window, +Alt its jump list
                        string mode = shift ? "new" : alt ? "menu" : ctrl ? "last" : "open";
                        ThreadPool.QueueUserWorkItem(delegate
                        {
                            Dictionary<string, object> d = new Dictionary<string, object>();
                            d["index"] = index;
                            d["mode"] = mode;
                            Program.Send("hotkey", d);
                        });
                    }
                    return new IntPtr(1);
                }
            }
            return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        static void Mask()
        {
            INPUT[] inputs = new INPUT[2];
            inputs[0].type = Native.INPUT_KEYBOARD;
            inputs[0].u.ki.wVk = VK_MASK;
            inputs[1].type = Native.INPUT_KEYBOARD;
            inputs[1].u.ki.wVk = VK_MASK;
            inputs[1].u.ki.dwFlags = Native.KEYEVENTF_KEYUP;
            Native.SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
        }
    }
}
