// Now Playing: whatever app reports to Windows' media controls (Spotify, browsers, Vyse Music...)
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Media.Control;

namespace VyseHost
{
    public static class Media
    {
        static GlobalSystemMediaTransportControlsSessionManager manager;
        static GlobalSystemMediaTransportControlsSession session;
        static string lastTrackKey = "";
        static string lastThumb = null;
        static bool started;

        public static async Task Start()
        {
            if (started) return;
            started = true;
            manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            manager.CurrentSessionChanged += delegate { Attach(); };
            manager.SessionsChanged += delegate { Attach(); };
            Attach();
        }

        // one set of handlers, on the one session listened to. Windows hands out a new wrapper for
        // the same session each time it's asked, so listening again on every change of the session
        // list piled up handlers, each sending the same update again
        static readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs> onProps = delegate { Push(); };
        static readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs> onPlayback = delegate { Push(); };
        static readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, TimelinePropertiesChangedEventArgs> onTimeline = delegate { Push(); };
        static readonly object gate = new object();
        static string sessionApp;

        static void Attach()
        {
            GlobalSystemMediaTransportControlsSession s = null;
            try { s = manager.GetCurrentSession(); } catch { }
            if (s == null)
            {
                // fall back to any session that is playing
                try
                {
                    foreach (GlobalSystemMediaTransportControlsSession x in manager.GetSessions())
                    {
                        if (s == null) s = x;
                        GlobalSystemMediaTransportControlsSessionPlaybackInfo pi = x.GetPlaybackInfo();
                        if (pi != null && pi.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) { s = x; break; }
                    }
                }
                catch { }
            }
            string app = null;
            try { app = s == null ? null : s.SourceAppUserModelId; } catch { s = null; }
            lock (gate)
            {
                if (s != null && session != null && app == sessionApp) { Push(); return; }
                GlobalSystemMediaTransportControlsSession old = session;
                if (old != null)
                {
                    try
                    {
                        old.MediaPropertiesChanged -= onProps;
                        old.PlaybackInfoChanged -= onPlayback;
                        old.TimelinePropertiesChanged -= onTimeline;
                    }
                    catch { }
                }
                session = s;
                sessionApp = app;
                if (s != null)
                {
                    try
                    {
                        s.MediaPropertiesChanged += onProps;
                        s.PlaybackInfoChanged += onPlayback;
                        s.TimelinePropertiesChanged += onTimeline;
                    }
                    catch { }
                }
            }
            Push();
        }

        // a burst of changes (a new track changes its title, art and timeline at once) is read
        // and sent once, then once more if anything changed during that read
        static int pushing;
        static volatile bool again;

        static async void Push()
        {
            if (Interlocked.Exchange(ref pushing, 1) == 1) { again = true; return; }
            try
            {
                do
                {
                    again = false;
                    try
                    {
                        object state = await Snapshot();
                        Program.Send("media", state);
                    }
                    catch (Exception e) { Program.LogError("media", e); }
                } while (again);
            }
            finally { Interlocked.Exchange(ref pushing, 0); }
        }

        public static async Task<object> Snapshot()
        {
            if (manager == null) await Start();
            GlobalSystemMediaTransportControlsSession s = session;
            if (s == null) return null;
            GlobalSystemMediaTransportControlsSessionMediaProperties props;
            try { props = await s.TryGetMediaPropertiesAsync(); }
            catch { return null; }
            if (props == null) return null;
            // a session that is closing answers with nothing for these
            GlobalSystemMediaTransportControlsSessionPlaybackInfo info = s.GetPlaybackInfo();
            if (info == null) return null;
            GlobalSystemMediaTransportControlsSessionTimelineProperties tl = s.GetTimelineProperties();
            GlobalSystemMediaTransportControlsSessionPlaybackControls controls = info.Controls;

            string key = s.SourceAppUserModelId + "|" + props.Title + "|" + props.Artist + "|" + props.AlbumTitle;
            if (key != lastTrackKey)
            {
                lastTrackKey = key;
                lastThumb = null;
                if (props.Thumbnail != null)
                {
                    try
                    {
                        using (global::Windows.Storage.Streams.IRandomAccessStreamWithContentType ras = await props.Thumbnail.OpenReadAsync())
                        using (global::Windows.Storage.Streams.DataReader reader = new global::Windows.Storage.Streams.DataReader(ras.GetInputStreamAt(0)))
                        {
                            uint n = await reader.LoadAsync((uint)ras.Size);
                            byte[] buf = new byte[n];
                            reader.ReadBytes(buf);
                            string type = string.IsNullOrEmpty(ras.ContentType) ? "image/png" : ras.ContentType;
                            lastThumb = "data:" + type + ";base64," + Convert.ToBase64String(buf);
                        }
                    }
                    catch { lastThumb = null; }
                }
            }

            Dictionary<string, object> d = new Dictionary<string, object>();
            d["app"] = s.SourceAppUserModelId;
            d["title"] = props.Title;
            d["artist"] = props.Artist;
            d["album"] = props.AlbumTitle;
            d["thumb"] = lastThumb;
            d["status"] = info.PlaybackStatus.ToString().ToLowerInvariant();
            d["canNext"] = controls != null && controls.IsNextEnabled;
            d["canPrev"] = controls != null && controls.IsPreviousEnabled;
            d["canSeek"] = controls != null && controls.IsPlaybackPositionEnabled;
            if (tl != null)
            {
                d["position"] = tl.Position.TotalSeconds;
                d["duration"] = (tl.EndTime - tl.StartTime).TotalSeconds;
                d["updatedAt"] = (tl.LastUpdatedTime.ToUniversalTime() - new DateTimeOffset(1970, 1, 1, 0, 0, 0, TimeSpan.Zero)).TotalMilliseconds;
            }
            return d;
        }

        public static async Task<object> Control(string action, double seconds)
        {
            if (manager == null) await Start();
            GlobalSystemMediaTransportControlsSession s = session;
            if (s == null) return false;
            switch (action)
            {
                case "toggle": return await s.TryTogglePlayPauseAsync();
                case "play": return await s.TryPlayAsync();
                case "pause": return await s.TryPauseAsync();
                case "next": return await s.TrySkipNextAsync();
                case "prev": return await s.TrySkipPreviousAsync();
                case "seek": return await s.TryChangePlaybackPositionAsync((long)(seconds * 10000000));
            }
            return false;
        }
    }
}
