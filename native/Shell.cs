// Icons, the Start menu's app list, the Recycle Bin, theme, radios, brightness, network and
// keyboard layout: everything the shell knows that Electron can't reach.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;
using Windows.Devices.Radios;

namespace VyseHost
{
    // Shell COM objects want a single-threaded apartment; this thread is one, with a queue
    // A shell extension can hang inside a call (a thumbnail of a file on a sleeping network
    // drive, a folder that doesn't answer): then that thread is left to it, its caller gets an
    // error, and a fresh thread takes the rest of the queue, so icons and menus never stop.
    public static class Sta
    {
        class Job { public Action Run, Fail; }

        class Worker
        {
            public readonly BlockingCollection<Job> Queue = new BlockingCollection<Job>();
            public volatile Job Busy;
            public int Since;
        }

        const int StuckMs = 15000;
        static readonly object gate = new object();
        static Worker current;
        static Timer watch;

        public static Task<T> Run<T>(Func<T> fn)
        {
            TaskCompletionSource<T> tcs = new TaskCompletionSource<T>();
            Job job = new Job();
            job.Run = delegate
            {
                try { tcs.TrySetResult(fn()); }
                catch (Exception e) { tcs.TrySetException(e); }
            };
            job.Fail = delegate { tcs.TrySetException(new TimeoutException("the shell didn't answer")); };
            lock (gate)
            {
                if (current == null) current = Start();
                current.Queue.Add(job);
            }
            return tcs.Task;
        }

        static Worker Start()
        {
            Worker w = new Worker();
            Thread t = new Thread(delegate ()
            {
                foreach (Job j in w.Queue.GetConsumingEnumerable())
                {
                    w.Since = Environment.TickCount;
                    w.Busy = j;
                    j.Run();
                    w.Busy = null;
                }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
            if (watch == null) watch = new Timer(Check, null, 2000, 2000);
            return w;
        }

        static void Check(object state)
        {
            Job stuck;
            lock (gate)
            {
                Worker w = current;
                if (w == null) return;
                stuck = w.Busy;
                if (stuck == null || unchecked(Environment.TickCount - w.Since) < StuckMs) return;
                current = Start();
                w.Queue.CompleteAdding();
                Job next;
                while (w.Queue.TryTake(out next)) current.Queue.Add(next);
            }
            stuck.Fail();
            Program.Log("shell: a call took over " + StuckMs / 1000 + " s; the rest go on without it");
        }
    }

    public static class Shell
    {
        const int SIIGBF_BIGGERSIZEOK = 1, SIIGBF_ICONONLY = 4;

        // path can be a file, a folder, an .exe, a .lnk, or "shell:AppsFolder\<AUMID>"
        public static string Icon(string path, int size, bool thumbnail)
        {
            Guid iid = typeof(IShellItemImageFactory).GUID;
            IShellItemImageFactory factory;
            int hr = Native.SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out factory);
            if (hr != 0 || factory == null) return null;
            try
            {
                SIZE sz = new SIZE();
                sz.cx = size; sz.cy = size;
                IntPtr hbmp;
                int flags = thumbnail ? SIIGBF_BIGGERSIZEOK : (SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK);
                if (factory.GetImage(sz, flags, out hbmp) != 0 || hbmp == IntPtr.Zero) return null;
                try { return "data:image/png;base64," + Convert.ToBase64String(BitmapToPng(hbmp)); }
                finally { Native.DeleteObject(hbmp); }
            }
            finally { Marshal.ReleaseComObject(factory); }
        }

        static byte[] BitmapToPng(IntPtr hbmp)
        {
            BITMAP bm = new BITMAP();
            Native.GetObject(hbmp, Marshal.SizeOf(bm), ref bm);
            int w = bm.bmWidth, h = Math.Abs(bm.bmHeight);
            BITMAPINFOHEADER bmi = new BITMAPINFOHEADER();
            bmi.biSize = Marshal.SizeOf(bmi);
            bmi.biWidth = w;
            bmi.biHeight = -h; // top-down rows
            bmi.biPlanes = 1;
            bmi.biBitCount = 32;
            byte[] bits = new byte[w * h * 4];
            IntPtr dc = Native.CreateCompatibleDC(IntPtr.Zero);
            Native.GetDIBits(dc, hbmp, 0, (uint)h, bits, ref bmi, 0);
            Native.DeleteDC(dc);

            bool hasAlpha = false;
            for (int i = 3; i < bits.Length; i += 4) if (bits[i] != 0) { hasAlpha = true; break; }
            if (!hasAlpha) for (int i = 3; i < bits.Length; i += 4) bits[i] = 255;

            using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb))
            {
                BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
                for (int y = 0; y < h; y++) Marshal.Copy(bits, y * w * 4, data.Scan0 + y * data.Stride, w * 4);
                bmp.UnlockBits(data);
                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return ms.ToArray();
                }
            }
        }

        public static string FileAumid(string path)
        {
            Guid iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            try
            {
                if (Native.SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0, ref iid, out store) != 0) return null;
                string s = Native.ReadString(store, Native.PKEY_AppUserModel_ID);
                Marshal.ReleaseComObject(store);
                return string.IsNullOrEmpty(s) ? null : s;
            }
            catch { return null; }
        }

        // every app in Start: the same list as shell:AppsFolder
        public static object StartApps()
        {
            List<object> list = new List<object>();
            Type t = Type.GetTypeFromProgID("Shell.Application");
            dynamic shell = Activator.CreateInstance(t);
            dynamic folder = shell.NameSpace("shell:AppsFolder");
            foreach (dynamic item in folder.Items())
            {
                string name = item.Name;
                string path = item.Path;
                if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(path)) continue;
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["name"] = name;
                d["id"] = path;
                list.Add(d);
            }
            Marshal.ReleaseComObject(shell);
            return list;
        }

        public static object RecycleBin()
        {
            SHQUERYRBINFO info = new SHQUERYRBINFO();
            info.cbSize = Marshal.SizeOf(info);
            Native.SHQueryRecycleBin(null, ref info);
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["items"] = info.i64NumItems;
            d["bytes"] = info.i64Size;
            return d;
        }

        public static object EmptyRecycleBin()
        {
            Native.SHEmptyRecycleBin(IntPtr.Zero, null, 0x1 | 0x2 | 0x4);
            return RecycleBin();
        }

        const string PersonalizeKey = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

        public static object Theme()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(PersonalizeKey))
            {
                object apps = k == null ? null : k.GetValue("AppsUseLightTheme");
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["dark"] = apps != null && Convert.ToInt32(apps) == 0;
                return d;
            }
        }

        public static object SetTheme(bool dark)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(PersonalizeKey))
            {
                k.SetValue("AppsUseLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
                k.SetValue("SystemUsesLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
            }
            IntPtr r;
            Native.SendMessageTimeout(new IntPtr(0xffff), Native.WM_SETTINGCHANGE, IntPtr.Zero, "ImmersiveColorSet", 2, 200, out r);
            return Theme();
        }

        public static async Task<object> Radios()
        {
            List<object> list = new List<object>();
            try { await Radio.RequestAccessAsync(); } catch { }
            IReadOnlyList<Radio> radios = await Radio.GetRadiosAsync();
            foreach (Radio r in radios)
            {
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["kind"] = r.Kind.ToString().ToLowerInvariant();
                d["name"] = r.Name;
                d["on"] = r.State == RadioState.On;
                d["state"] = r.State.ToString().ToLowerInvariant();
                list.Add(d);
            }
            return list;
        }

        public static async Task<object> SetRadio(string kind, bool on)
        {
            try { await Radio.RequestAccessAsync(); } catch { }
            IReadOnlyList<Radio> radios = await Radio.GetRadiosAsync();
            foreach (Radio r in radios)
            {
                if (r.Kind.ToString().ToLowerInvariant() == kind)
                    await r.SetStateAsync(on ? RadioState.On : RadioState.Off);
            }
            return await Radios();
        }

        // laptop panels only; external monitors answer through DDC, which this does not speak
        public static object Brightness()
        {
            try
            {
                using (ManagementObjectSearcher s = new ManagementObjectSearcher("root\\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness"))
                {
                    foreach (ManagementObject o in s.Get()) return Convert.ToInt32(o["CurrentBrightness"]);
                }
            }
            catch { }
            return null;
        }

        public static object SetBrightness(int level)
        {
            using (ManagementObjectSearcher s = new ManagementObjectSearcher("root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods"))
            {
                foreach (ManagementObject o in s.Get())
                    o.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)Math.Max(0, Math.Min(100, level)) });
            }
            return level;
        }

        public static object Network()
        {
            long rx = 0, tx = 0;
            bool up = false;
            string kind = null;
            foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                string desc = (ni.Description ?? "").ToLowerInvariant();
                if (desc.Contains("virtual") || desc.Contains("hyper-v") || desc.Contains("vpn") || desc.Contains("pseudo")) continue;
                try
                {
                    IPInterfaceStatistics st = ni.GetIPStatistics();
                    rx += st.BytesReceived;
                    tx += st.BytesSent;
                }
                catch { }
                if (ni.GetIPProperties().GatewayAddresses.Count > 0)
                {
                    up = true;
                    if (kind == null) kind = ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? "wifi" : "ethernet";
                }
            }
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["rx"] = rx;
            d["tx"] = tx;
            d["connected"] = up;
            d["kind"] = kind;
            return d;
        }

        public static object Keyboard()
        {
            IntPtr fg = WindowTracker.LastExternal != IntPtr.Zero ? WindowTracker.LastExternal : Native.GetForegroundWindow();
            uint pid;
            uint tid = Native.GetWindowThreadProcessId(fg, out pid);
            int lang = Native.GetKeyboardLayout(tid).ToInt32() & 0xffff;
            Dictionary<string, object> d = new Dictionary<string, object>();
            try
            {
                CultureInfo c = new CultureInfo(lang);
                d["code"] = c.TwoLetterISOLanguageName.ToUpperInvariant();
                d["name"] = c.DisplayName;
            }
            catch { d["code"] = "??"; d["name"] = "Unknown"; }
            List<object> all = new List<object>();
            foreach (System.Windows.Forms.InputLanguage il in System.Windows.Forms.InputLanguage.InstalledInputLanguages)
            {
                Dictionary<string, object> x = new Dictionary<string, object>();
                x["code"] = il.Culture.TwoLetterISOLanguageName.ToUpperInvariant();
                x["name"] = il.Culture.DisplayName + " - " + il.LayoutName;
                x["id"] = il.Handle.ToInt64();
                all.Add(x);
            }
            d["all"] = all;
            return d;
        }

        public static object NextKeyboard(long hkl)
        {
            IntPtr fg = WindowTracker.LastExternal != IntPtr.Zero ? WindowTracker.LastExternal : Native.GetForegroundWindow();
            // HKL_NEXT is 1; a specific layout is its handle
            Native.PostMessage(fg, Native.WM_INPUTLANGCHANGEREQUEST, IntPtr.Zero, new IntPtr(hkl == 0 ? 1 : hkl));
            Thread.Sleep(120);
            return Keyboard();
        }
    }
}
