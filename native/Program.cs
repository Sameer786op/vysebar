// VyseHost: the native side of VyseBar. It speaks JSON lines over stdin/stdout:
//   in:  {"id":1,"cmd":"activate","args":{...}}
//   out: {"type":"reply","id":1,"ok":true,"result":...}  or  {"type":"<event>","data":...}
// When stdin closes (VyseBar quit or crashed) it puts the Windows taskbar back and exits,
// so the taskbar can never stay hidden behind a dead dock.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace VyseHost
{
    public static class Program
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 64 };
        static readonly object OutLock = new object();
        static StreamWriter Out;
        public static Control Ui;
        public static uint ParentPid;
        public static string DataDir;

        [STAThread]
        public static void Main(string[] args)
        {
            try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--parent") ParentPid = uint.Parse(args[i + 1]);
                if (args[i] == "--data") DataDir = args[i + 1];
            }
            if (DataDir == null) DataDir = Path.GetTempPath();

            Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            Out.AutoFlush = true;

            Ui = new Control();
            Ui.CreateControl();
            IntPtr force = Ui.Handle; // the handle must exist before BeginInvoke from other threads

            // a taskbar left hidden by an earlier crash comes back before anything else, and so
            // does a desktop left in peek (DWM keeps one on after its caller has gone)
            Taskbar.RecoverFromCrash();
            Peek.Reset();
            AppDomain.CurrentDomain.UnhandledException += delegate { try { Peek.Reset(); } catch { } };

            WindowTracker.Start();
            Thread reader = new Thread(ReadLoop);
            reader.IsBackground = true;
            reader.Start();
            Send("ready", null);
            Application.Run();
        }

        static void ReadLoop()
        {
            StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            try
            {
                while ((line = input.ReadLine()) != null)
                {
                    if (line.Length == 0) continue;
                    Dictionary<string, object> msg;
                    try { msg = (Dictionary<string, object>)Json.DeserializeObject(line); }
                    catch { continue; }
                    Dispatch(msg);
                }
            }
            catch { }
            Shutdown();
        }

        public static void Shutdown()
        {
            try { Peek.End(); } catch { }
            try { Taskbar.Restore(); } catch { }
            try { AppBars.RemoveAll(); } catch { }
            Environment.Exit(0);
        }

        static void Dispatch(Dictionary<string, object> msg)
        {
            object id = msg.ContainsKey("id") ? msg["id"] : null;
            string cmd = msg.ContainsKey("cmd") ? (string)msg["cmd"] : "";
            Dictionary<string, object> a = msg.ContainsKey("args") && msg["args"] is Dictionary<string, object>
                ? (Dictionary<string, object>)msg["args"] : new Dictionary<string, object>();
            Task.Run(async () =>
            {
                try
                {
                    object result = await Commands.Run(cmd, a);
                    Reply(id, true, result, null);
                }
                catch (Exception e)
                {
                    Reply(id, false, null, e.Message);
                }
            });
        }

        static void Reply(object id, bool ok, object result, string error)
        {
            if (id == null) return;
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["type"] = "reply";
            d["id"] = id;
            d["ok"] = ok;
            if (ok) d["result"] = result; else d["error"] = error;
            Write(d);
        }

        public static void Send(string type, object data)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["type"] = type;
            d["data"] = data;
            Write(d);
        }

        static void Write(Dictionary<string, object> d)
        {
            string s;
            try { s = Json.Serialize(d); }
            catch (Exception e) { s = "{\"type\":\"log\",\"data\":" + Json.Serialize("serialize failed: " + e.Message) + "}"; }
            lock (OutLock)
            {
                try { Out.WriteLine(s); }
                catch { Environment.Exit(0); }
            }
        }

        public static void Log(string text) { Send("log", text); }

        public static void OnUi(Action action)
        {
            try { Ui.BeginInvoke(action); } catch { }
        }

        public static T OnUiSync<T>(Func<T> fn)
        {
            if (!Ui.InvokeRequired) return fn();
            return (T)Ui.Invoke(fn);
        }

        // helpers for reading loosely typed JSON args
        public static string Str(Dictionary<string, object> a, string k) { return a.ContainsKey(k) && a[k] != null ? Convert.ToString(a[k]) : null; }
        public static long Long(Dictionary<string, object> a, string k, long def) { return a.ContainsKey(k) && a[k] != null ? Convert.ToInt64(a[k]) : def; }
        public static double Num(Dictionary<string, object> a, string k, double def) { return a.ContainsKey(k) && a[k] != null ? Convert.ToDouble(a[k]) : def; }
        public static bool Bool(Dictionary<string, object> a, string k, bool def) { return a.ContainsKey(k) && a[k] != null ? Convert.ToBoolean(a[k]) : def; }
        public static IntPtr Hwnd(Dictionary<string, object> a) { return new IntPtr(Long(a, "hwnd", 0)); }
    }
}
