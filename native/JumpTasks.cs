// The rest of an app's jump list: its own Tasks ("New window", "New InPrivate window") and any
// lists it adds, the way the Windows taskbar shows them on right-click. Apps hand these to
// Windows through ICustomDestinationList, which keeps them in
// %APPDATA%\Microsoft\Windows\Recent\CustomDestinations\<id>.customDestinations-ms, where <id>
// is a CRC-64 of the app's ID in capitals. Windows has no API to read them back, so this reads
// the file: a short header, then per list its kind, a name (for the app's own lists) and a count,
// then the entries, each a COM class ID followed by that object's saved stream (almost always a
// shell link), and an end marker. The shell link reads its own stream back, which also says
// where the next one starts.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.RegularExpressions;

namespace VyseHost
{
    [ComImport, Guid("00000109-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPersistStreamJ
    {
        void GetClassID(out Guid clsid);
        [PreserveSig] int IsDirty();
        [PreserveSig] int Load(IStream stream);
        [PreserveSig] int Save(IStream stream, bool clearDirty);
        [PreserveSig] int GetSizeMax(out long size);
    }

    [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPersistFileJ
    {
        void GetClassID(out Guid clsid);
        [PreserveSig] int IsDirty();
        [PreserveSig] int Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
        [PreserveSig] int Save([MarshalAs(UnmanagedType.LPWStr)] string file, bool remember);
        [PreserveSig] int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
        [PreserveSig] int GetCurFile(out IntPtr file);
    }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellLinkWJ
    {
        [PreserveSig] int GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr findData, uint flags);
        [PreserveSig] int GetIDList(out IntPtr pidl);
        [PreserveSig] int SetIDList(IntPtr pidl);
        [PreserveSig] int GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int cch);
        [PreserveSig] int SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        [PreserveSig] int GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int cch);
        [PreserveSig] int SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        [PreserveSig] int GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int cch);
    }

    public static class JumpTasks
    {
        [DllImport("shlwapi.dll", EntryPoint = "SHCreateMemStream")]
        [return: MarshalAs(UnmanagedType.Interface)]
        static extern IStream SHCreateMemStream(byte[] data, uint size);

        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
        static extern int SHLoadIndirectString(string source, StringBuilder output, int cch, IntPtr reserved);

        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);

        [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IActivationManager
        {
            [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId, [MarshalAs(UnmanagedType.LPWStr)] string args, int options, out uint pid);
        }
        static readonly Guid CLSID_Activation = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");

        const uint FOOTER = 0xBABFFBAB;
        const int MAX_ITEMS = 12;
        static readonly PROPERTYKEY PKEY_Title = new PROPERTYKEY(new Guid("F29F85E0-4FF9-1068-AB91-08002B27B3D9"), 2);
        static readonly PROPERTYKEY PKEY_Separator = new PROPERTYKEY(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 6);
        static readonly PROPERTYKEY PKEY_AppId = new PROPERTYKEY(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
        // what a Store app's entry passes to the app when it starts (which chat to open, say)
        static readonly PROPERTYKEY PKEY_Activation = new PROPERTYKEY(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 20);

        static string Folder
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Recent\CustomDestinations"); }
        }

        /// the file name Windows gives an app's lists: CRC-64 (reflected, 0x92C64265D32139A4) of
        /// the app ID in capitals as UTF-16, written in hex without leading zeros
        public static string Hash(string appId)
        {
            ulong crc = ulong.MaxValue;
            foreach (byte b in Encoding.Unicode.GetBytes(appId.ToUpperInvariant()))
            {
                crc ^= b;
                for (int i = 0; i < 8; i++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0x92C64265D32139A4UL : crc >> 1;
            }
            return crc.ToString("x");
        }

        static bool ValidId(string id) { return id != null && Regex.IsMatch(id, "^[0-9a-f]{1,16}$"); }

        static string FileOf(string listId) { return Path.Combine(Folder, listId + ".customDestinations-ms"); }

        public static bool Exists(string listId) { return ValidId(listId) && File.Exists(FileOf(listId)); }

        static uint U32(byte[] b, ref int pos) { uint v = BitConverter.ToUInt32(b, pos); pos += 4; return v; }
        static int U16(byte[] b, ref int pos) { int v = BitConverter.ToUInt16(b, pos); pos += 2; return v; }

        /// each entry of the file as a live COM object, by list; the caller releases them
        static void Walk(string listId, Func<int, string, int, object, bool> visit)
        {
            byte[] b = File.ReadAllBytes(FileOf(listId));
            if (b.Length < 12) return;
            int pos = 0;
            U32(b, ref pos); // format version
            uint lists = U32(b, ref pos);
            U32(b, ref pos);
            IntPtr where = Marshal.AllocCoTaskMem(8);
            try
            {
                for (int c = 0; c < lists && pos + 4 <= b.Length; c++)
                {
                    uint kind = U32(b, ref pos);
                    string name = null;
                    int count = 0;
                    if (kind == 0)
                    {
                        int len = U16(b, ref pos);
                        name = Encoding.Unicode.GetString(b, pos, len * 2);
                        pos += len * 2;
                        count = (int)U32(b, ref pos);
                    }
                    else if (kind == 1) { U32(b, ref pos); } // Recent or Frequent: kept by Windows, read elsewhere
                    else if (kind == 2) { name = null; count = (int)U32(b, ref pos); }
                    else return;

                    for (int i = 0; i < count; i++)
                    {
                        if (pos + 16 > b.Length) return;
                        byte[] g = new byte[16];
                        Array.Copy(b, pos, g, 0, 16);
                        pos += 16;
                        Type t = Type.GetTypeFromCLSID(new Guid(g), false);
                        if (t == null) return;
                        object o = Activator.CreateInstance(t);
                        IPersistStreamJ ps = o as IPersistStreamJ;
                        if (ps == null) { Marshal.ReleaseComObject(o); return; }
                        byte[] rest = new byte[b.Length - pos];
                        Array.Copy(b, pos, rest, 0, rest.Length);
                        IStream st = SHCreateMemStream(rest, (uint)rest.Length);
                        bool ok = st != null && ps.Load(st) == 0;
                        long used = 0;
                        if (ok)
                        {
                            st.Seek(0, 1 /* STREAM_SEEK_CUR */, where);
                            used = Marshal.ReadInt64(where);
                        }
                        if (st != null) Marshal.ReleaseComObject(st);
                        if (!ok || used <= 0) { Marshal.ReleaseComObject(o); return; }
                        pos += (int)used;
                        bool more = visit(kind == 2 ? -1 : c, name, i, o);
                        if (!more) return;
                    }
                    if (pos + 4 > b.Length || U32(b, ref pos) != FOOTER) return;
                }
            }
            finally { Marshal.FreeCoTaskMem(where); }
        }

        static string Indirect(string s)
        {
            if (string.IsNullOrEmpty(s) || s[0] != '@') return s;
            StringBuilder sb = new StringBuilder(512);
            return SHLoadIndirectString(s, sb, sb.Capacity, IntPtr.Zero) == 0 ? sb.ToString() : null;
        }

        /// a text property, whichever string kind the app saved it as
        static string Text(IPropertyStore store, PROPERTYKEY key)
        {
            if (store == null) return null;
            PROPVARIANT pv;
            if (store.GetValue(ref key, out pv) != 0) return null;
            string s = null;
            if ((pv.vt == 31 || pv.vt == 8) && pv.p != IntPtr.Zero) s = Marshal.PtrToStringUni(pv.p); // VT_LPWSTR, VT_BSTR
            Native.PropVariantClear(ref pv);
            return string.IsNullOrEmpty(s) ? null : s;
        }

        static bool IsSeparator(IPropertyStore store)
        {
            if (store == null) return false;
            PROPERTYKEY key = PKEY_Separator;
            PROPVARIANT pv;
            if (store.GetValue(ref key, out pv) != 0) return false;
            bool on = pv.vt == 11 && (pv.p.ToInt64() & 0xFFFF) != 0; // VT_BOOL
            Native.PropVariantClear(ref pv);
            return on;
        }

        /// an app's lists for its menu: Tasks last, as on the taskbar
        public static List<object> Read(string listId)
        {
            if (!Exists(listId)) return null;
            Dictionary<int, Dictionary<string, object>> byList = new Dictionary<int, Dictionary<string, object>>();
            List<int> order = new List<int>();
            try
            {
                Walk(listId, delegate (int list, string name, int index, object o)
                {
                    try
                    {
                        Dictionary<string, object> group;
                        if (!byList.TryGetValue(list, out group))
                        {
                            group = new Dictionary<string, object>();
                            group["name"] = list < 0 ? "Tasks" : Indirect(name) ?? "";
                            group["list"] = list;
                            group["items"] = new List<object>();
                            byList[list] = group;
                            order.Add(list);
                        }
                        List<object> items = (List<object>)group["items"];
                        IShellLinkWJ link = o as IShellLinkWJ;
                        IPropertyStore store = o as IPropertyStore;
                        if (IsSeparator(store))
                        {
                            if (items.Count > 0) items.Add(new Dictionary<string, object> { { "separator", true } });
                            return true;
                        }
                        string title = Indirect(Text(store, PKEY_Title));
                        if (string.IsNullOrEmpty(title) && link != null)
                        {
                            StringBuilder sb = new StringBuilder(1024);
                            if (link.GetDescription(sb, sb.Capacity) == 0) title = Indirect(sb.ToString());
                        }
                        if (string.IsNullOrEmpty(title) || items.Count >= MAX_ITEMS) return true;
                        Dictionary<string, object> item = new Dictionary<string, object>();
                        item["title"] = title;
                        item["list"] = list;
                        item["index"] = index;
                        items.Add(item);
                        return true;
                    }
                    finally { Marshal.ReleaseComObject(o); }
                });
            }
            catch { }
            List<object> result = new List<object>();
            // custom lists first, then Tasks, the order the taskbar uses
            order.Sort(delegate (int x, int y) { return (x < 0 ? 1 : 0).CompareTo(y < 0 ? 1 : 0); });
            foreach (int list in order)
            {
                List<object> items = (List<object>)byList[list]["items"];
                while (items.Count > 0 && ((Dictionary<string, object>)items[items.Count - 1]).ContainsKey("separator")) items.RemoveAt(items.Count - 1);
                if (items.Count > 0) result.Add(byList[list]);
            }
            return result;
        }

        /// runs one entry: saved as a shortcut and opened, so its arguments, start folder and app
        /// ID all come along exactly as the app set them
        public static object Open(string listId, int list, int index)
        {
            if (!Exists(listId)) return false;
            string lnk = Path.Combine(Path.GetTempPath(), "VyseBar-task-" + listId + ".lnk");
            bool saved = false;
            string storeApp = null, storeArgs = null;
            Walk(listId, delegate (int l, string name, int i, object o)
            {
                try
                {
                    if (l != list || i != index) return true;
                    IPropertyStore store = o as IPropertyStore;
                    string id = Text(store, PKEY_AppId);
                    if (id != null && id.Contains("!")) { storeApp = id; storeArgs = Text(store, PKEY_Activation) ?? ""; }
                    IPersistFileJ pf = o as IPersistFileJ;
                    saved = pf != null && pf.Save(lnk, false) == 0;
                    return false;
                }
                finally { Marshal.ReleaseComObject(o); }
            });
            // an empty input lets this process hand the foreground to what it starts
            INPUT[] input = new INPUT[1];
            input[0].type = Native.INPUT_MOUSE;
            Native.SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
            AllowSetForegroundWindow(-1);
            // a Store app's entry starts the app with its arguments, as the taskbar does
            if (storeApp != null)
            {
                try
                {
                    IActivationManager am = (IActivationManager)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_Activation));
                    uint pid;
                    int hr = am.ActivateApplication(storeApp, storeArgs, 0, out pid);
                    Marshal.ReleaseComObject(am);
                    if (hr == 0) return true;
                }
                catch { }
            }
            if (!saved) return false;
            Process.Start(new ProcessStartInfo(lnk) { UseShellExecute = true });
            return true;
        }
    }
}
