// More switches and readings for the dock: temperature, keep awake, the microphone, desktop
// icons, the wallpaper and File Explorer's Quick access folders.
using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;

namespace VyseHost
{
    public static class Extras
    {
        [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, uint param, string pv, uint flags);

        const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x1, ES_DISPLAY_REQUIRED = 0x2;
        const uint WM_COMMAND = 0x0111, SPI_SETDESKWALLPAPER = 0x0014, SPIF_UPDATEINIFILE = 0x1, SPIF_SENDCHANGE = 0x2;
        const int TOGGLE_DESKTOP_ICONS = 0x7402;

        /// thermal zones as Windows reports them, without needing admin rights
        public static object Temperature()
        {
            List<object> sensors = new List<object>();
            try
            {
                using (ManagementObjectSearcher s = new ManagementObjectSearcher(@"root\cimv2", "SELECT Name, HighPrecisionTemperature, Temperature FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation"))
                {
                    foreach (ManagementObject m in s.Get())
                    {
                        // tenths of a kelvin when the high-precision reading is there, whole kelvins otherwise
                        object hp = m["HighPrecisionTemperature"];
                        double k = hp != null && Convert.ToDouble(hp) > 0 ? Convert.ToDouble(hp) / 10.0 : Convert.ToDouble(m["Temperature"]);
                        double c = Math.Round(k - 273.15, 1);
                        if (k <= 0 || c < -20 || c > 150) continue;
                        Dictionary<string, object> d = new Dictionary<string, object>();
                        d["name"] = Convert.ToString(m["Name"]);
                        d["c"] = c;
                        sensors.Add(d);
                    }
                }
            }
            catch { }
            return sensors;
        }

        static bool awake;

        /// stops the PC sleeping and the screen turning off; runs on the helper's lasting UI thread
        public static object KeepAwake(object on)
        {
            if (on != null)
            {
                awake = Convert.ToBoolean(on);
                SetThreadExecutionState(awake ? ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED : ES_CONTINUOUS);
            }
            return awake;
        }

        /// the default microphone's mute state, optionally changed first; null when there is no microphone
        public static object Mic(object mute)
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
            IMMDevice dev;
            if (en.GetDefaultAudioEndpoint(1 /* capture */, 0 /* console */, out dev) != 0 || dev == null) return null;
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
            IAudioEndpointVolume vol = (IAudioEndpointVolume)o;
            Guid ctx = Guid.Empty;
            if (mute != null) vol.SetMute(Convert.ToBoolean(mute), ref ctx);
            bool muted;
            vol.GetMute(out muted);
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["muted"] = muted;
            return d;
        }

        // the desktop's icon view lives under Progman, or under a WorkerW once a slideshow has run
        static IntPtr DefView()
        {
            IntPtr dv = FindWindowEx(Native.FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
            if (dv != IntPtr.Zero) return dv;
            IntPtr w = IntPtr.Zero;
            while ((w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null)) != IntPtr.Zero)
            {
                dv = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (dv != IntPtr.Zero) return dv;
            }
            return IntPtr.Zero;
        }

        /// whether desktop icons show, optionally switched first (the same command as View > Show desktop icons)
        public static object DesktopIcons(object show)
        {
            IntPtr dv = DefView();
            if (dv == IntPtr.Zero) return null;
            IntPtr list = FindWindowEx(dv, IntPtr.Zero, "SysListView32", null);
            bool visible = list != IntPtr.Zero && Native.IsWindowVisible(list);
            if (show != null && Convert.ToBoolean(show) != visible)
            {
                // Explorer's window: an Explorer that has stopped answering gets a few seconds, not for ever
                IntPtr r;
                if (Native.SendMessageTimeout(dv, WM_COMMAND, new IntPtr(TOGGLE_DESKTOP_ICONS), IntPtr.Zero, 2 /* SMTO_ABORTIFHUNG */, 3000, out r) == IntPtr.Zero) return visible;
                visible = !visible;
            }
            return visible;
        }

        public static object SetWallpaper(string path)
        {
            return SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, path, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        }

        /// the folders in File Explorer's Quick access (on the shell's STA thread, Sta in Shell.cs)
        public static object QuickAccess()
        {
            List<object> list = new List<object>();
            Type t = Type.GetTypeFromProgID("Shell.Application");
            if (t == null) return list;
            dynamic shell = Activator.CreateInstance(t);
            DateTime until = DateTime.UtcNow.AddSeconds(3);
            try
            {
                dynamic folder = shell.NameSpace("shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}");
                if (folder == null) return list;
                foreach (dynamic item in folder.Items())
                {
                    // a menu is waiting for these: what came in time is enough
                    if (DateTime.UtcNow > until) break;
                    // the shell counts .zip files as folders; only real directories belong here. A
                    // network folder isn't looked up on disk (an offline one takes long to say so)
                    string path = item.Path;
                    if (string.IsNullOrEmpty(path)) continue;
                    if (path.StartsWith(@"\\")) { if (System.IO.Path.GetExtension(path).Length > 0) continue; }
                    else if (!System.IO.Directory.Exists(path)) continue;
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["name"] = (string)item.Name;
                    d["path"] = path;
                    list.Add(d);
                    if (list.Count >= 12) break;
                }
            }
            finally { Marshal.ReleaseComObject(shell); }
            return list;
        }
    }
}
