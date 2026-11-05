// Speaker volume through Core Audio, plus each app's own volume (the Volume mixer)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VyseHost
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCo { }

    // undocumented but stable since Windows 7: what the Sound control panel uses to pick the default output
    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    class PolicyConfigClient { }

    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string device, int useDefault, IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string device);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string device, int useDefault, IntPtr defaultPeriod, IntPtr minPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string device, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string device, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string device, int role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string device, int visible);
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore props);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
        [PreserveSig] int GetChannelCount(out uint c);
        [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolumeLevel(out float db);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint ch, float db, ref Guid ctx);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
        [PreserveSig] int GetChannelVolumeLevel(uint ch, out float db);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr guid, uint flags, out IntPtr ctl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, uint flags, out IntPtr vol);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
        [PreserveSig] int GetGroupingParam(out Guid g);
        [PreserveSig] int SetGroupingParam(ref Guid g, ref Guid ctx);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    public static class Audio
    {
        const int eRender = 0, eMultimedia = 1, CLSCTX_ALL = 23, DEVICE_STATE_ACTIVE = 1;

        static IMMDevice DefaultDevice()
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
            IMMDevice dev;
            Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(eRender, eMultimedia, out dev));
            return dev;
        }

        static IAudioEndpointVolume EndpointVolume(IMMDevice dev)
        {
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            Marshal.ThrowExceptionForHR(dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o));
            return (IAudioEndpointVolume)o;
        }

        static string NameOf(IMMDevice dev)
        {
            IPropertyStore store;
            if (dev.OpenPropertyStore(0, out store) != 0) return null;
            return Native.ReadString(store, Native.PKEY_Device_FriendlyName);
        }

        public static object Get()
        {
            IMMDevice dev = DefaultDevice();
            IAudioEndpointVolume vol = EndpointVolume(dev);
            float level; bool muted;
            vol.GetMasterVolumeLevelScalar(out level);
            vol.GetMute(out muted);
            string id;
            dev.GetId(out id);
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["volume"] = Math.Round(level * 100);
            d["muted"] = muted;
            d["device"] = NameOf(dev);
            d["id"] = id;
            return d;
        }

        public static object Set(double volume, object mute)
        {
            IAudioEndpointVolume vol = EndpointVolume(DefaultDevice());
            Guid ctx = Guid.Empty;
            if (volume >= 0) vol.SetMasterVolumeLevelScalar((float)Math.Max(0, Math.Min(1, volume / 100.0)), ref ctx);
            if (mute != null) vol.SetMute(Convert.ToBoolean(mute), ref ctx);
            return Get();
        }

        public static object Devices()
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
            IMMDeviceCollection col;
            List<object> list = new List<object>();
            if (en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out col) != 0) return list;
            uint n;
            col.GetCount(out n);
            for (uint i = 0; i < n; i++)
            {
                IMMDevice dev;
                if (col.Item(i, out dev) != 0) continue;
                string id;
                dev.GetId(out id);
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["id"] = id;
                d["name"] = NameOf(dev);
                list.Add(d);
            }
            return list;
        }

        static IAudioSessionEnumerator Sessions()
        {
            IMMDevice dev = DefaultDevice();
            Guid iid = typeof(IAudioSessionManager2).GUID;
            object o;
            Marshal.ThrowExceptionForHR(dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o));
            IAudioSessionEnumerator e;
            Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out e));
            return e;
        }

        public static object Mixer()
        {
            List<object> list = new List<object>();
            IAudioSessionEnumerator e = Sessions();
            int n;
            e.GetCount(out n);
            HashSet<uint> seen = new HashSet<uint>();
            for (int i = 0; i < n; i++)
            {
                IAudioSessionControl2 s;
                if (e.GetSession(i, out s) != 0) continue;
                uint pid;
                s.GetProcessId(out pid);
                if (pid == 0 || s.IsSystemSoundsSession() == 0 || seen.Contains(pid)) continue;
                int state;
                s.GetState(out state);
                if (state == 2) continue; // expired
                seen.Add(pid);
                ISimpleAudioVolume v = (ISimpleAudioVolume)s;
                float level; bool muted;
                v.GetMasterVolume(out level);
                v.GetMute(out muted);
                string name = null;
                string exe = WindowTracker.ExeOf(pid);
                try { name = Process.GetProcessById((int)pid).MainModule.FileVersionInfo.FileDescription; } catch { }
                if (string.IsNullOrEmpty(name) && exe != null) name = System.IO.Path.GetFileNameWithoutExtension(exe);
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["pid"] = (long)pid;
                d["name"] = name;
                d["exe"] = exe;
                d["volume"] = Math.Round(level * 100);
                d["muted"] = muted;
                d["active"] = state == 1;
                list.Add(d);
            }
            return list;
        }

        public static object SetApp(uint pid, double volume, object mute)
        {
            IAudioSessionEnumerator e = Sessions();
            int n;
            e.GetCount(out n);
            Guid ctx = Guid.Empty;
            for (int i = 0; i < n; i++)
            {
                IAudioSessionControl2 s;
                if (e.GetSession(i, out s) != 0) continue;
                uint p;
                s.GetProcessId(out p);
                if (p != pid) continue;
                ISimpleAudioVolume v = (ISimpleAudioVolume)s;
                if (volume >= 0) v.SetMasterVolume((float)Math.Max(0, Math.Min(1, volume / 100.0)), ref ctx);
                if (mute != null) v.SetMute(Convert.ToBoolean(mute), ref ctx);
            }
            return true;
        }

        public static object SetDefault(string id)
        {
            IPolicyConfig pc = (IPolicyConfig)new PolicyConfigClient();
            for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, role));
            return Get();
        }
    }
}
