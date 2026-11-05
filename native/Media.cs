// Now Playing: whatever app reports to Windows' media controls (Spotify, browsers, Vyse Music...)
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
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
                        if (x.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) { s = x; break; }
                    }
                }
                catch { }
            }
            if (session != null && s != null && session.SourceAppUserModelId == s.SourceAppUserModelId && ReferenceEquals(session, s)) { Push(); return; }
            session = s;
            if (s != null)
            {
                s.MediaPropertiesChanged += delegate { Push(); };
                s.PlaybackInfoChanged += delegate { Push(); };
                s.TimelinePropertiesChanged += delegate { Push(); };
            }
            Push();
        }

        static async void Push()
        {
            try
            {
                object state = await Snapshot();
                Program.Send("media", state);
            }
            catch (Exception e) { Program.Log("media: " + e.Message); }
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
            GlobalSystemMediaTransportControlsSessionPlaybackInfo info = s.GetPlaybackInfo();
            GlobalSystemMediaTransportControlsSessionTimelineProperties tl = s.GetTimelineProperties();

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
            d["canNext"] = info.Controls.IsNextEnabled;
            d["canPrev"] = info.Controls.IsPreviousEnabled;
            d["canSeek"] = info.Controls.IsPlaybackPositionEnabled;
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
