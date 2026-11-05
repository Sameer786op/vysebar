// Recent files for an app's right-click menu: the same list the Windows taskbar shows in an
// app's jump list. Windows keeps it per app ID and hands it out through the documented
// IApplicationDocumentLists interface. An app's ID comes from its window or pin when it has one;
// otherwise Start's app list says which ID belongs to an .exe.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace VyseHost
{
    [ComImport, Guid("3c594f9f-9f30-47a1-979a-c9e83d3d0a06"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IApplicationDocumentLists
    {
        void SetAppID([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int GetList(int type, uint want, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
    }

    [ComImport, Guid("92CA9DCD-5622-4bba-A805-5E9F541BD8C9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IObjectArray
    {
        void GetCount(out uint n);
        [PreserveSig] int GetAt(uint i, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemJ
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItemJ ppsi);
        [PreserveSig] int GetDisplayName(uint sigdn, out IntPtr name);
        [PreserveSig] int GetAttributes(uint mask, out uint attrs);
    }

    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IApplicationActivationManager
    {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId, [MarshalAs(UnmanagedType.LPWStr)] string args, int options, out uint pid);
        [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appId, IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint pid);
    }

    public static class JumpLists
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IntPtr item);
        [DllImport("shell32.dll")] static extern int SHCreateShellItemArrayFromShellItem(IntPtr item, ref Guid riid, out IntPtr array);
        [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);

        static readonly Guid CLSID_DocLists = new Guid("86bec222-30f2-47e0-9f25-60d11cd75c28");
        static readonly Guid CLSID_Activation = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
        static readonly Guid IID_Unknown = new Guid("00000000-0000-0000-C000-000000000046");
        static readonly Guid IID_ShellItem = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
        static readonly Guid IID_ShellItemArray = new Guid("b63ea76d-1f85-456f-a19c-48159efa858b");
        const int ADLT_RECENT = 0;
        const uint SIGDN_NORMALDISPLAY = 0, SIGDN_FILESYSPATH = 0x80058000, SFGAO_FOLDER = 0x20000000;

        // Start's app list: .exe → app ID, rebuilt in the background when it gets old
        static Dictionary<string, string> exeIds;
        static DateTime builtAt;
        static bool building;

        public static void Warm()
        {
            if (building) return;
            building = true;
            Sta.Run(delegate { BuildMap(); return true; });
        }

        static void BuildMap()
        {
            Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
                dynamic folder = shell.NameSpace("shell:AppsFolder");
                foreach (dynamic item in folder.Items())
                {
                    try
                    {
                        string id = item.Path;
                        string target = item.ExtendedProperty("System.Link.TargetParsingPath");
                        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(target) || !target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!map.ContainsKey(target)) map[target] = id;
                    }
                    catch { }
                }
                Marshal.ReleaseComObject(shell);
            }
            catch { }
            exeIds = map;
            builtAt = DateTime.UtcNow;
            building = false;
        }

        static string IdForExe(string exe)
        {
            if ((exeIds == null || (DateTime.UtcNow - builtAt).TotalMinutes > 10) && !building)
            {
                // the first time it is needed now; after that an old map answers while a new one is read
                if (exeIds == null) { building = true; BuildMap(); }
                else Warm();
            }
            Dictionary<string, string> map = exeIds;
            if (map == null || exe == null) return null;
            string id;
            if (map.TryGetValue(exe, out id)) return id;
            // updaters (Squirrel apps like Discord) start a stub one folder up from the real .exe
            string name = Path.GetFileName(exe);
            foreach (KeyValuePair<string, string> kv in map)
            {
                string dir = Path.GetDirectoryName(kv.Key);
                if (Path.GetFileName(kv.Key).Equals(name, StringComparison.OrdinalIgnoreCase) && dir != null &&
                    exe.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase)) return kv.Value;
            }
            return null;
        }

        // an app without an ID of its own is known by its path, with known folders as GUIDs
        static readonly string[] KnownFolders = {
            "{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}", // LocalAppData
            "{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}", // RoamingAppData
            "{6D809377-6AF0-444B-8957-A3773F02200E}", // Program Files
            "{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}", // Program Files (x86)
            "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}", // System32
            "{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}", // SysWOW64
            "{F38BF404-1D43-42F2-9305-67DE0B28FC23}", // Windows
        };

        static string ImplicitId(string exe)
        {
            if (exe == null) return null;
            string best = null;
            int bestLen = 0;
            foreach (string g in KnownFolders)
            {
                Guid id = new Guid(g);
                IntPtr p;
                if (SHGetKnownFolderPath(ref id, 0, IntPtr.Zero, out p) != 0) continue;
                string dir = Marshal.PtrToStringUni(p);
                Marshal.FreeCoTaskMem(p);
                if (dir.Length > bestLen && exe.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase))
                {
                    best = g + exe.Substring(dir.Length);
                    bestLen = dir.Length;
                }
            }
            return best;
        }

        public static Task<object> Get(List<string> ids, string exe, string lnk)
        {
            return Sta.Run(delegate
            {
                List<string> tries = new List<string>();
                foreach (string id in ids) if (!string.IsNullOrEmpty(id) && !tries.Contains(id)) tries.Add(id);
                if (!string.IsNullOrEmpty(lnk) && lnk.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
                {
                    string fromLink = Shell.FileAumid(lnk);
                    if (fromLink != null && !tries.Contains(fromLink)) tries.Add(fromLink);
                }
                string viaStart = IdForExe(exe);
                if (viaStart != null && !tries.Contains(viaStart)) tries.Add(viaStart);
                string implicitId = ImplicitId(exe);
                if (implicitId != null && !tries.Contains(implicitId)) tries.Add(implicitId);

                string recentId = null;
                List<object> recent = new List<object>();
                foreach (string id in tries)
                {
                    recent = Recent(id, 10);
                    if (recent.Count == 0) continue;
                    recentId = id;
                    break;
                }
                // the app's own tasks and lists (JumpTasks.cs), found by the same IDs
                string listId = null;
                List<object> lists = null;
                foreach (string id in tries)
                {
                    string h = JumpTasks.Hash(id);
                    if (!JumpTasks.Exists(h)) continue;
                    lists = JumpTasks.Read(h);
                    if (lists == null || lists.Count == 0) continue;
                    listId = h;
                    break;
                }
                if (recentId == null && listId == null) return null;
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["appId"] = recentId ?? (tries.Count > 0 ? tries[0] : null);
                d["items"] = recent;
                d["listId"] = listId;
                d["lists"] = listId != null ? lists : new List<object>();
                return (object)d;
            });
        }

        static List<object> Recent(string appId, int max)
        {
            List<object> list = new List<object>();
            IApplicationDocumentLists adl = null;
            object o = null;
            try
            {
                adl = (IApplicationDocumentLists)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_DocLists));
                adl.SetAppID(appId);
                Guid iid = typeof(IObjectArray).GUID;
                if (adl.GetList(ADLT_RECENT, 20, ref iid, out o) != 0 || o == null) return list;
                IObjectArray arr = (IObjectArray)o;
                uint n;
                arr.GetCount(out n);
                HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                Guid unk = IID_Unknown;
                for (uint i = 0; i < n && list.Count < max; i++)
                {
                    object it;
                    if (arr.GetAt(i, ref unk, out it) != 0) continue;
                    IShellItemJ si = it as IShellItemJ;
                    if (si == null) { Marshal.ReleaseComObject(it); continue; }
                    IntPtr p;
                    string path = si.GetDisplayName(SIGDN_FILESYSPATH, out p) == 0 ? Take(p) : null;
                    string name = si.GetDisplayName(SIGDN_NORMALDISPLAY, out p) == 0 ? Take(p) : null;
                    uint attrs;
                    bool folder = si.GetAttributes(SFGAO_FOLDER, out attrs) == 0 && (attrs & SFGAO_FOLDER) != 0;
                    Marshal.ReleaseComObject(it);
                    // only real files and folders that are still there (a card or USB stick may be out)
                    if (path == null || !seen.Add(path)) continue;
                    if (!path.StartsWith("\\\\") && !File.Exists(path) && !Directory.Exists(path)) continue;
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["name"] = string.IsNullOrEmpty(name) ? Path.GetFileName(path) : name;
                    d["path"] = path;
                    d["folder"] = folder;
                    list.Add(d);
                }
            }
            catch { }
            finally
            {
                if (o != null) Marshal.ReleaseComObject(o);
                if (adl != null) Marshal.ReleaseComObject(adl);
            }
            return list;
        }

        static string Take(IntPtr p)
        {
            string s = Marshal.PtrToStringUni(p);
            Marshal.FreeCoTaskMem(p);
            return s;
        }

        /// opens a recent file in the app it came from, as the taskbar's jump list does
        public static Task<object> Open(string path, string appId, string exe)
        {
            return Sta.Run(delegate
            {
                // an empty input lets this process hand the foreground to what it opens
                INPUT[] input = new INPUT[1];
                input[0].type = Native.INPUT_MOUSE;
                Native.SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
                AllowSetForegroundWindow(-1);

                if (!string.IsNullOrEmpty(appId) && appId.Contains("!") && ActivateForFile(appId, path)) return (object)true;
                if (!string.IsNullOrEmpty(exe) && File.Exists(exe) && !exe.EndsWith("\\explorer.exe", StringComparison.OrdinalIgnoreCase))
                {
                    Process.Start(new ProcessStartInfo(exe, "\"" + path + "\"") { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) });
                    return (object)true;
                }
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                return (object)true;
            });
        }

        static bool ActivateForFile(string appId, string path)
        {
            IntPtr item = IntPtr.Zero, array = IntPtr.Zero;
            try
            {
                Guid iidItem = IID_ShellItem, iidArray = IID_ShellItemArray;
                if (SHCreateItemFromParsingName(path, IntPtr.Zero, ref iidItem, out item) != 0) return false;
                if (SHCreateShellItemArrayFromShellItem(item, ref iidArray, out array) != 0) return false;
                IApplicationActivationManager m = (IApplicationActivationManager)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_Activation));
                uint pid;
                int hr = m.ActivateForFile(appId, array, "open", out pid);
                Marshal.ReleaseComObject(m);
                return hr == 0;
            }
            catch { return false; }
            finally
            {
                if (array != IntPtr.Zero) Marshal.Release(array);
                if (item != IntPtr.Zero) Marshal.Release(item);
            }
        }
    }
}
