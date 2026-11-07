// VyseHost: the native side of VyseBar. It speaks JSON lines over stdin/stdout:
//   in:  {"id":1,"cmd":"activate","args":{...}}
//   out: {"type":"reply","id":1,"ok":true,"result":...}  or  {"type":"<event>","data":...}
// When stdin closes (VyseBar quit or crashed) it puts the Windows taskbar back and exits,
// so the taskbar can never stay hidden behind a dead dock.
using System;
using System.Collections.Concurrent;
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
        static StreamWriter Out;
        // everything for VyseBar goes out through one writer thread. A VyseBar that is busy and
        // not reading then holds up nothing here: the window thread and the tray go on answering
        // Windows, and events wait in line (past a limit they are dropped; replies never are)
        static readonly BlockingCollection<string> outbox = new BlockingCollection<string>();
        static long queued;
        static int dropped;
        const long MaxQueued = 32L * 1024 * 1024;
        public static Control Ui;
        public static uint ParentPid;
        public static string DataDir;

        [STAThread]
        public static void Main(string[] args)
        {
            // an error in a timer or window callback is logged; it never brings up .NET's error
            // dialog, which on this hidden helper would hold its window thread until closed
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e) { LogError("window thread", e.Exception); };
            try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--parent") ParentPid = uint.Parse(args[i + 1]);
                if (args[i] == "--data") DataDir = args[i + 1];
            }
            if (DataDir == null) DataDir = Path.GetTempPath();

            Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            Out.AutoFlush = true;
            Thread writer = new Thread(WriteLoop);
            writer.IsBackground = true;
            writer.Start();

            Ui = new Control();
            Ui.CreateControl();
            IntPtr force = Ui.Handle; // the handle must exist before BeginInvoke from other threads

            // a taskbar left hidden by an earlier crash comes back before anything else, and so
            // does a desktop left in peek (DWM keeps one on after its caller has gone)
            Taskbar.RecoverFromCrash();
            Peek.Reset();
            AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e)
            {
                try { Peek.Reset(); } catch { }
                try { Diary("helper crashed: " + Describe(e.ExceptionObject as Exception)); } catch { }
            };

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

        static int shuttingDown;
        static volatile bool recovering;

        /// VyseBar quit or is gone: the taskbar comes back and the helper ends
        public static void Shutdown()
        {
            // the watchdog is ending a stuck VyseBar and starting a new one: it finishes up itself
            if (recovering) { Thread.Sleep(Timeout.Infinite); return; }
            if (Interlocked.Exchange(ref shuttingDown, 1) == 1) { Thread.Sleep(Timeout.Infinite); return; }
            Cleanup();
            Environment.Exit(0);
        }

        public static void BeginRecovery() { recovering = true; }

        /// what a dock leaves on the desktop: the hidden taskbar, the reserved strip, a peek
        public static void Cleanup()
        {
            try { Peek.End(); } catch { }
            try { Taskbar.Restore(); } catch { }
            try { AppBars.RemoveAll(); } catch { }
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
            Write(d, true);
        }

        public static void Send(string type, object data)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["type"] = type;
            d["data"] = data;
            Write(d, false);
        }

        static void Write(Dictionary<string, object> d, bool reply)
        {
            string s;
            try { s = Json.Serialize(d); }
            catch (Exception e) { s = "{\"type\":\"log\",\"data\":" + Json.Serialize("serialize failed: " + e.GetType().Name) + "}"; }
            if (!reply && Interlocked.Read(ref queued) > MaxQueued)
            {
                Interlocked.Increment(ref dropped);
                return;
            }
            Interlocked.Add(ref queued, s.Length);
            try { outbox.Add(s); } catch { }
        }

        static void WriteLoop()
        {
            foreach (string s in outbox.GetConsumingEnumerable())
            {
                Interlocked.Add(ref queued, -s.Length);
                // VyseBar has gone (the pipe broke): the read loop ends the same way any moment now
                try { Out.WriteLine(s); }
                catch { Shutdown(); }
                int lost = Interlocked.Exchange(ref dropped, 0);
                if (lost > 0) Log("VyseBar was busy: " + lost + " updates were dropped");
            }
        }

        public static void Log(string text) { Send("log", text); }

        // the same error over and over (a timer that keeps failing) is written down once a minute
        static readonly Dictionary<string, DateTime> lastErrors = new Dictionary<string, DateTime>();

        public static void LogError(string where, Exception e)
        {
            string text = where + ": " + Describe(e);
            lock (lastErrors)
            {
                DateTime at;
                if (lastErrors.TryGetValue(text, out at) && (DateTime.UtcNow - at).TotalSeconds < 60) return;
                if (lastErrors.Count > 200) lastErrors.Clear();
                lastErrors[text] = DateTime.UtcNow;
            }
            Log("error in " + text);
        }

        /// the kind of error and where it happened, without its message (which can hold a file name)
        public static string Describe(Exception e)
        {
            if (e == null) return "unknown error";
            StringBuilder sb = new StringBuilder(e.GetType().Name);
            string trace = e.StackTrace ?? "";
            int n = 0;
            foreach (string raw in trace.Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith("at ")) line = line.Substring(3);
                int paren = line.IndexOf('(');
                if (paren > 0) line = line.Substring(0, paren);
                sb.Append(n == 0 ? " at " : " < ").Append(line);
                if (++n == 3) break;
            }
            return sb.ToString();
        }

        /// a line straight into vysebar.log, for when VyseBar itself can't take it (it is stuck or gone)
        public static void Diary(string line)
        {
            string file = Path.Combine(DataDir ?? Path.GetTempPath(), "vysebar.log");
            string text = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") + " [" + System.Diagnostics.Process.GetCurrentProcess().Id + " helper] " + line + "\n";
            for (int i = 0; i < 5; i++)
            {
                try { File.AppendAllText(file, text, new UTF8Encoding(false)); return; }
                catch (IOException) { Thread.Sleep(30); }
                catch { return; }
            }
        }

        public static void OnUi(Action action)
        {
            try
            {
                Ui.BeginInvoke(new Action(delegate
                {
                    try { action(); }
                    catch (Exception e) { LogError("window thread", e); }
                }));
            }
            catch { }
        }

        /// runs fn on the window thread. A thread that stays busy (a call into a program that has
        /// stopped answering) gives the caller an error after a while, rather than a wait for ever
        public static T OnUiSync<T>(Func<T> fn) { return OnUiSync(fn, 5000); }

        public static T OnUiSync<T>(Func<T> fn, int ms)
        {
            if (!Ui.InvokeRequired) return fn();
            T result = default(T);
            Exception error = null;
            IAsyncResult r = Ui.BeginInvoke(new Action(delegate
            {
                try { result = fn(); }
                catch (Exception e) { error = e; }
            }));
            if (!r.AsyncWaitHandle.WaitOne(ms)) throw new TimeoutException("the helper's window thread is busy");
            try { Ui.EndInvoke(r); } catch { }
            if (error != null) throw error;
            return result;
        }

        // helpers for reading loosely typed JSON args
        public static string Str(Dictionary<string, object> a, string k) { return a.ContainsKey(k) && a[k] != null ? Convert.ToString(a[k]) : null; }
        public static long Long(Dictionary<string, object> a, string k, long def) { return a.ContainsKey(k) && a[k] != null ? Convert.ToInt64(a[k]) : def; }
        public static double Num(Dictionary<string, object> a, string k, double def) { return a.ContainsKey(k) && a[k] != null ? Convert.ToDouble(a[k]) : def; }
        public static bool Bool(Dictionary<string, object> a, string k, bool def) { return a.ContainsKey(k) && a[k] != null ? Convert.ToBoolean(a[k]) : def; }
        public static IntPtr Hwnd(Dictionary<string, object> a) { return new IntPtr(Long(a, "hwnd", 0)); }
    }
}
