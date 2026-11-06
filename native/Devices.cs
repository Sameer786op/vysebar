// The rest of Quick Toggles and the Bluetooth card: energy saver, Do not disturb, camera access,
// the mobile hotspot, Ethernet, the microphone's level and paired Bluetooth devices with their
// batteries. Each one answers null when this PC doesn't have the thing, so the dock can grey it out.
using System;
using System.Collections.Generic;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32;
using Windows.Devices.Bluetooth;
using Windows.Devices.Enumeration;
using Windows.Networking.Connectivity;
using Windows.Networking.NetworkOperators;
using Windows.System.Power;

namespace VyseHost
{
    public static class Devices
    {
        // ---------- energy saver ----------
        // Windows turns energy saver on by itself below a battery level ("turn on automatically at").
        // Switching it on sets that level to 100%, so it's on whenever the PC runs on battery; off
        // puts the level you had back. There is no public switch for it beyond that.

        [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr scheme);
        [DllImport("powrprof.dll")] static extern uint PowerReadDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
        [DllImport("powrprof.dll")] static extern uint PowerWriteDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
        [DllImport("powrprof.dll")] static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);

        static Guid SUB_ENERGYSAVER = new Guid("de830923-a562-41af-a086-e3a2c6bad2da");
        static Guid ESBATTTHRESHOLD = new Guid("e69653ca-cf7f-4f05-aa73-cb833fa90ad4");
        const string Key = @"Software\VyseBar";

        static bool ActiveScheme(out Guid scheme)
        {
            scheme = Guid.Empty;
            IntPtr p;
            if (PowerGetActiveScheme(IntPtr.Zero, out p) != 0 || p == IntPtr.Zero) return false;
            scheme = (Guid)Marshal.PtrToStructure(p, typeof(Guid));
            LocalFree(p);
            return true;
        }

        public static object EnergySaver(object on)
        {
            EnergySaverStatus st;
            try { st = PowerManager.EnergySaverStatus; } catch { return null; }
            Guid scheme;
            if (on != null && ActiveScheme(out scheme))
            {
                uint now;
                PowerReadDCValueIndex(IntPtr.Zero, ref scheme, ref SUB_ENERGYSAVER, ref ESBATTTHRESHOLD, out now);
                uint want;
                if (Convert.ToBoolean(on))
                {
                    if (now < 100) using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Key)) k.SetValue("EnergySaverLevel", (int)now);
                    want = 100;
                }
                else
                {
                    object saved = null;
                    using (RegistryKey k = Registry.CurrentUser.OpenSubKey(Key)) if (k != null) saved = k.GetValue("EnergySaverLevel");
                    want = saved != null ? (uint)Convert.ToInt32(saved) : 20;
                    if (want >= 100) want = 20;
                }
                PowerWriteDCValueIndex(IntPtr.Zero, ref scheme, ref SUB_ENERGYSAVER, ref ESBATTTHRESHOLD, want);
                PowerSetActiveScheme(IntPtr.Zero, ref scheme);
                System.Threading.Thread.Sleep(300);
                try { st = PowerManager.EnergySaverStatus; } catch { }
            }
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["on"] = st == EnergySaverStatus.On;
            // "disabled": plugged in, where Windows keeps it off whatever the level is
            d["available"] = st != EnergySaverStatus.Disabled;
            uint level = 0;
            Guid s2;
            if (ActiveScheme(out s2)) PowerReadDCValueIndex(IntPtr.Zero, ref s2, ref SUB_ENERGYSAVER, ref ESBATTTHRESHOLD, out level);
            d["always"] = level >= 100;
            return d;
        }

        // ---------- Do not disturb ----------
        // Windows 11 keeps it in the notification settings and tells the shell through the same
        // state Focus assist used; both are set so either kind of Windows picks it up.

        [DllImport("ntdll.dll")] static extern int NtQueryWnfStateData(ref ulong name, IntPtr type, IntPtr scope, out uint stamp, byte[] buffer, ref uint size);
        [DllImport("ntdll.dll")] static extern int NtUpdateWnfStateData(ref ulong name, byte[] buffer, uint length, IntPtr type, IntPtr scope, uint matchStamp, uint checkStamp);
        const ulong WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF1C75;
        const string NotifyKey = @"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";

        static int QuietProfile()
        {
            ulong name = WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED;
            byte[] buf = new byte[4];
            uint size = 4, stamp;
            try { if (NtQueryWnfStateData(ref name, IntPtr.Zero, IntPtr.Zero, out stamp, buf, ref size) != 0 || size < 4) return -1; }
            catch { return -1; }
            return BitConverter.ToInt32(buf, 0);
        }

        public static object DoNotDisturb(object on)
        {
            if (on != null)
            {
                bool want = Convert.ToBoolean(on);
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(NotifyKey)) k.SetValue("NOC_GLOBAL_SETTING_TOASTS_ENABLED", want ? 0 : 1, RegistryValueKind.DWord);
                ulong name = WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED;
                // 1: priority only, which is what Do not disturb lets through; 0: off
                byte[] buf = BitConverter.GetBytes(want ? 1 : 0);
                try { NtUpdateWnfStateData(ref name, buf, 4, IntPtr.Zero, IntPtr.Zero, 0, 0); } catch { }
            }
            object toasts = null;
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(NotifyKey)) if (k != null) toasts = k.GetValue("NOC_GLOBAL_SETTING_TOASTS_ENABLED");
            int profile = QuietProfile();
            if (toasts != null) return Convert.ToInt32(toasts) == 0 || profile > 0;
            return profile > 0;
        }

        // ---------- camera ----------
        // the privacy switch "Let apps access your camera", for this user; null without a camera

        const string CameraKey = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam";
        static int cameras = -1;
        static DateTime camerasAt;

        public static async Task<object> Camera(object on)
        {
            if (cameras < 0 || (DateTime.UtcNow - camerasAt).TotalMinutes > 2)
            {
                try { cameras = (await DeviceInformation.FindAllAsync(DeviceClass.VideoCapture)).Count; }
                catch { cameras = 0; }
                camerasAt = DateTime.UtcNow;
            }
            if (cameras == 0) return null;
            if (on != null)
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(CameraKey)) k.SetValue("Value", Convert.ToBoolean(on) ? "Allow" : "Deny");
            object v = null;
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(CameraKey)) if (k != null) v = k.GetValue("Value");
            return !"Deny".Equals(v as string, StringComparison.OrdinalIgnoreCase);
        }

        // ---------- mobile hotspot ----------
        // shares the PC's internet connection over Wi-Fi; null when the connection or adapter can't

        public static async Task<object> Hotspot(object on)
        {
            ConnectionProfile p;
            NetworkOperatorTetheringManager m;
            try
            {
                p = NetworkInformation.GetInternetConnectionProfile();
                if (p == null) return null;
                if (NetworkOperatorTetheringManager.GetTetheringCapabilityFromConnectionProfile(p) != TetheringCapability.Enabled) return null;
                m = NetworkOperatorTetheringManager.CreateFromConnectionProfile(p);
            }
            catch { return null; }
            if (on != null)
            {
                bool want = Convert.ToBoolean(on);
                bool now = m.TetheringOperationalState == TetheringOperationalState.On;
                if (want != now)
                {
                    NetworkOperatorTetheringOperationResult r = want ? await m.StartTetheringAsync() : await m.StopTetheringAsync();
                    if (r.Status != TetheringOperationStatus.Success) throw new Exception(string.IsNullOrEmpty(r.AdditionalErrorMessage) ? r.Status.ToString() : r.AdditionalErrorMessage);
                }
            }
            Dictionary<string, object> d = new Dictionary<string, object>();
            TetheringOperationalState st = m.TetheringOperationalState;
            d["on"] = st == TetheringOperationalState.On || st == TetheringOperationalState.InTransition;
            d["clients"] = (long)m.ClientCount;
            try
            {
                NetworkOperatorTetheringAccessPointConfiguration c = m.GetCurrentAccessPointConfiguration();
                d["name"] = c.Ssid;
            }
            catch { }
            return d;
        }

        // ---------- Ethernet ----------
        // a cable that's plugged in and up; null when the PC has no wired adapter

        public static object Ethernet()
        {
            bool any = false, up = false;
            foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.NetworkInterfaceType != NetworkInterfaceType.Ethernet && ni.NetworkInterfaceType != NetworkInterfaceType.GigabitEthernet) continue;
                string desc = ((ni.Description ?? "") + " " + (ni.Name ?? "")).ToLowerInvariant();
                if (desc.Contains("virtual") || desc.Contains("hyper-v") || desc.Contains("vpn") || desc.Contains("vethernet") || desc.Contains("bluetooth") || desc.Contains("tap-") || desc.Contains("wan miniport")) continue;
                any = true;
                if (ni.OperationalStatus == OperationalStatus.Up) up = true;
            }
            if (!any) return null;
            return up;
        }

        // ---------- Bluetooth ----------
        // paired devices, connected first, with the battery level Windows shows in Settings

        const string BATTERY = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";

        static object Prop(DeviceInformation d, string key)
        {
            object v;
            return d.Properties.TryGetValue(key, out v) ? v : null;
        }

        static async Task<DeviceInformationCollection> Find(string aqs, string[] props, DeviceInformationKind kind)
        {
            try { return await DeviceInformation.FindAllAsync(aqs, props, kind); }
            catch { return null; }
        }

        public static async Task<object> Bluetooth()
        {
            string[] aepProps = { "System.Devices.Aep.IsConnected", "System.Devices.Aep.ContainerId", "System.Devices.Aep.Bluetooth.Cod.Major", "System.Devices.Aep.Bluetooth.Cod.Minor", "System.Devices.Aep.Bluetooth.Le.Appearance.Category" };
            string[] basic = { "System.Devices.Aep.IsConnected", "System.Devices.Aep.ContainerId" };
            Dictionary<string, Dictionary<string, object>> byContainer = new Dictionary<string, Dictionary<string, object>>();
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();

            string[] selectors = { BluetoothDevice.GetDeviceSelectorFromPairingState(true), BluetoothLEDevice.GetDeviceSelectorFromPairingState(true) };
            for (int i = 0; i < selectors.Length; i++)
            {
                DeviceInformationCollection found = await Find(selectors[i], aepProps, DeviceInformationKind.AssociationEndpoint);
                if (found == null) found = await Find(selectors[i], basic, DeviceInformationKind.AssociationEndpoint);
                if (found == null) continue;
                foreach (DeviceInformation d in found)
                {
                    if (string.IsNullOrEmpty(d.Name)) continue;
                    object c = Prop(d, "System.Devices.Aep.ContainerId");
                    string container = c != null ? c.ToString().ToLowerInvariant() : d.Id;
                    bool connected = Prop(d, "System.Devices.Aep.IsConnected") is bool && (bool)Prop(d, "System.Devices.Aep.IsConnected");
                    Dictionary<string, object> x;
                    if (!byContainer.TryGetValue(container, out x))
                    {
                        x = new Dictionary<string, object>();
                        x["id"] = d.Id;
                        x["name"] = d.Name;
                        x["connected"] = false;
                        x["battery"] = null;
                        x["kind"] = "other";
                        x["le"] = i == 1;
                        byContainer[container] = x;
                        list.Add(x);
                    }
                    if (connected) x["connected"] = true;
                    string kind = KindOf(Prop(d, "System.Devices.Aep.Bluetooth.Cod.Major"), Prop(d, "System.Devices.Aep.Bluetooth.Cod.Minor"), Prop(d, "System.Devices.Aep.Bluetooth.Le.Appearance.Category"));
                    if (kind != "other") x["kind"] = kind;
                }
            }

            // the battery sits on the device's own nodes (hands-free, HID over GATT), found by container
            if (list.Count > 0)
            {
                DeviceInformationCollection nodes = await Find("System.Devices.DeviceInstanceId:~<\"BTH\"", new string[] { BATTERY, "System.Devices.ContainerId" }, DeviceInformationKind.Device);
                if (nodes != null)
                {
                    foreach (DeviceInformation n in nodes)
                    {
                        object b = Prop(n, BATTERY);
                        object c = Prop(n, "System.Devices.ContainerId");
                        if (b == null || c == null) continue;
                        Dictionary<string, object> x;
                        if (!byContainer.TryGetValue(c.ToString().ToLowerInvariant(), out x)) continue;
                        int level = Convert.ToInt32(b);
                        if (level < 0 || level > 100) continue;
                        x["battery"] = (long)level;
                    }
                }
            }

            list.Sort(delegate (Dictionary<string, object> a, Dictionary<string, object> b)
            {
                int c = ((bool)b["connected"]).CompareTo((bool)a["connected"]);
                return c != 0 ? c : string.Compare((string)a["name"], (string)b["name"], StringComparison.CurrentCultureIgnoreCase);
            });
            return list;
        }

        // Bluetooth's class of device for classic devices, the appearance category for LE ones
        static string KindOf(object major, object minor, object leCategory)
        {
            if (major != null)
            {
                int mj = Convert.ToInt32(major);
                int mn = minor != null ? Convert.ToInt32(minor) : 0;
                if (mj == 4) return mn == 6 || mn == 1 || mn == 2 ? "headset" : "speaker";
                if (mj == 2) return "phone";
                if (mj == 1) return "computer";
                if (mj == 5) return (mn & 0x30) == 0x10 ? "keyboard" : (mn & 0x30) == 0x20 ? "mouse" : (mn & 0x0f) == 2 ? "gamepad" : "input";
            }
            if (leCategory != null)
            {
                int cat = Convert.ToInt32(leCategory);
                switch (cat)
                {
                    case 0x01: return "phone";
                    case 0x02: return "computer";
                    case 0x03: return "watch";
                    case 0x0F: return "input";
                    case 0x25: return "headset";
                }
            }
            return "other";
        }
    }
}
