// The picture behind the live glass: a strip of the screen behind the dock, read a few times a
// second and scaled down on the way.
//
// It is read with the Magnification API, told to leave VyseBar's own windows out, so the glass
// sees what is behind the dock while the dock itself stays visible to screen shares and
// screenshots, like the taskbar. Where the magnifier doesn't work, GDI reads the screen as
// Windows composes it; then the dock has to keep itself out of captures (or the glass would show
// the dock inside itself), and main is told so ("grabMode").
//
// This replaces a continuous 30 fps screen-capture stream: that kept a desktop-duplication
// session open all the time, which costs a third of a CPU core and stops Windows from using
// its fast paths for games and video, so everything on the PC felt less smooth.
using System;
using System.Collections.Generic;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Security;
using System.Threading;
using System.Windows.Forms;

static class Grab
{
    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
    [StructLayout(LayoutKind.Sequential)]
    struct MRECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct MAGIMAGEHEADER { public uint width, height; public Guid format; public uint stride, offset; public UIntPtr cbSize; }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate bool MagScalingCallback(IntPtr hwnd, IntPtr src, MAGIMAGEHEADER srcHeader, IntPtr dst, MAGIMAGEHEADER dstHeader, MRECT unclipped, MRECT clipped, IntPtr dirty);
    delegate bool EnumProc(IntPtr hwnd, IntPtr lp);

    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int mode);
    [DllImport("gdi32.dll")] static extern bool SetBrushOrgEx(IntPtr dc, int x, int y, IntPtr prev);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
    [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int sw, int sh, int rop);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr section, uint offset);

    [DllImport("Magnification.dll")] static extern bool MagInitialize();
    [DllImport("Magnification.dll")] static extern bool MagSetWindowSource(IntPtr hwnd, MRECT rect);
    [DllImport("Magnification.dll")] static extern bool MagSetWindowFilterList(IntPtr hwnd, int mode, int count, IntPtr[] list);
    [DllImport("Magnification.dll")] static extern bool MagSetImageScalingCallback(IntPtr hwnd, MagScalingCallback cb);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateWindowEx(int ex, string cls, string name, int style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);

    const int SRCCOPY = 0x00CC0020;
    const int HALFTONE = 4;
    const int WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_POPUP = unchecked((int)0x80000000);
    const int WS_EX_LAYERED = 0x80000, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
    const uint LWA_ALPHA = 2;
    const int MW_FILTERMODE_EXCLUDE = 0;

    // ---- GDI: what Windows composes, windows kept out of captures excluded
    static readonly object gate = new object();
    static IntPtr memDc, dib, oldBmp, bits;
    static int dibW, dibH;
    static byte[] buffer = new byte[0];

    /// <summary>the screen rect x,y,w,h (physical pixels) scaled to ow x oh, as base64 RGBA</summary>
    public static object Strip(int x, int y, int w, int h, int ow, int oh)
    {
        if (w <= 0 || h <= 0 || ow <= 0 || oh <= 0 || ow > 8192 || oh > 8192 || w > 16384 || h > 16384) return null;
        if (MagUsable())
        {
            byte[] rgba = OnMag(delegate { return MagStrip(x, y, w, h, ow, oh); }, 3000);
            if (rgba != null) return new Dictionary<string, object> { { "w", ow }, { "h", oh }, { "data", Convert.ToBase64String(rgba) } };
            // a miss now and then is fine; a broken magnifier hands over to GDI below
            if (!magBroken) return null;
        }
        return GdiStrip(x, y, w, h, ow, oh);
    }

    static object GdiStrip(int x, int y, int w, int h, int ow, int oh)
    {
        lock (gate)
        {
            IntPtr screen = GetDC(IntPtr.Zero);
            if (screen == IntPtr.Zero) return null;
            try
            {
                if (dib == IntPtr.Zero || dibW != ow || dibH != oh)
                {
                    Free();
                    memDc = CreateCompatibleDC(screen);
                    var bi = new BITMAPINFOHEADER { biSize = 40, biWidth = ow, biHeight = -oh, biPlanes = 1, biBitCount = 32 };
                    dib = CreateDIBSection(screen, ref bi, 0, out bits, IntPtr.Zero, 0);
                    if (memDc == IntPtr.Zero || dib == IntPtr.Zero) { Free(); return null; }
                    oldBmp = SelectObject(memDc, dib);
                    SetStretchBltMode(memDc, HALFTONE);
                    SetBrushOrgEx(memDc, 0, 0, IntPtr.Zero);
                    dibW = ow;
                    dibH = oh;
                }
                bool ok = ow == w && oh == h
                    ? BitBlt(memDc, 0, 0, ow, oh, screen, x, y, SRCCOPY)
                    : StretchBlt(memDc, 0, 0, ow, oh, screen, x, y, w, h, SRCCOPY);
                if (!ok) return null;
                int n = ow * oh * 4;
                if (buffer.Length != n) buffer = new byte[n];
                Marshal.Copy(bits, buffer, 0, n);
                // GDI hands out BGRx; WebGL wants RGBA
                for (int i = 0; i < n; i += 4)
                {
                    byte b = buffer[i];
                    buffer[i] = buffer[i + 2];
                    buffer[i + 2] = b;
                    buffer[i + 3] = 255;
                }
                return new Dictionary<string, object> { { "w", ow }, { "h", oh }, { "data", Convert.ToBase64String(buffer) } };
            }
            finally { ReleaseDC(IntPtr.Zero, screen); }
        }
    }

    /// <summary>whether the glass's reads leave VyseBar's own windows out. Only then can the dock
    /// stay visible to screen shares and screenshots: otherwise it must keep itself out of them.
    /// Main allows the magnifier unless a helper died in the middle of a read before.</summary>
    public static object Mode(bool allow)
    {
        magAllowed = allow;
        bool ok = false;
        if (allow && MagUsable())
        {
            // one tiny read proves the magnifier answers on this PC
            ok = OnMag(delegate { return MagStrip(0, 0, 16, 4, 4, 1); }, 5000) != null;
            if (!ok) Broke("the first read came back empty");
        }
        return new Dictionary<string, object> { { "excludes", ok } };
    }

    /// <summary>let the bitmaps go (the glass is off, or the dock is idle)</summary>
    public static bool Release()
    {
        lock (gate) { Free(); buffer = new byte[0]; }
        Control ui = magUi;
        if (ui != null && !magBroken)
        {
            try
            {
                ui.BeginInvoke(new Action(delegate
                {
                    if (magCtl != IntPtr.Zero) DestroyWindow(magCtl);
                    magCtl = IntPtr.Zero;
                    ctlW = ctlH = 0;
                    frame = new byte[0];
                }));
            }
            catch { }
        }
        return true;
    }

    static void Free()
    {
        if (memDc != IntPtr.Zero && oldBmp != IntPtr.Zero) SelectObject(memDc, oldBmp);
        if (dib != IntPtr.Zero) DeleteObject(dib);
        if (memDc != IntPtr.Zero) DeleteDC(memDc);
        memDc = dib = oldBmp = bits = IntPtr.Zero;
        dibW = dibH = 0;
    }

    // ---- the magnifier: the screen with VyseBar's windows left out. It lives on a thread of its
    // own with a message loop (its windows must be served, or a broadcast to them would hang)
    static readonly object startGate = new object();
    static Control magUi;
    // GDI until main says the magnifier may be used; never again once it has failed
    static volatile bool magAllowed, magBroken;
    static bool magInit;
    static IntPtr magHost, magCtl;
    static int ctlW, ctlH, misses;
    static IntPtr[] excluded = new IntPtr[0];
    static readonly MagScalingCallback onFrame = OnFrame;
    static readonly EnumProc collect = Collect;
    static readonly List<IntPtr> found = new List<IntPtr>();
    static byte[] frame = new byte[0];
    static int frameW, frameH, frameStride;
    static bool frameGot;

    static bool MagUsable()
    {
        if (magBroken || !magAllowed) return false;
        // without the dock's process there is nothing to leave out, and the glass would see the dock
        if (VyseHost.Program.ParentPid == 0) return false;
        if (magUi != null) return true;
        lock (startGate)
        {
            if (magUi != null) return true;
            if (magBroken) return false;
            Control made = null;
            ManualResetEvent ready = new ManualResetEvent(false);
            Thread t = new Thread(delegate ()
            {
                try
                {
                    made = new Control();
                    made.CreateControl();
                    IntPtr force = made.Handle;
                }
                catch { made = null; }
                ready.Set();
                if (made != null) Application.Run();
            });
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            ready.WaitOne(5000);
            if (made == null || !made.IsHandleCreated) { Broke("its thread didn't start"); return false; }
            magUi = made;
            return true;
        }
    }

    static void Broke(string why)
    {
        if (magBroken) return;
        magBroken = true;
        try { VyseHost.Program.Log("glass: magnifier off (" + why + "), reading the screen with GDI"); } catch { }
        // main puts the dock back out of captures, or the GDI reads would show the dock in its glass
        try { VyseHost.Program.Send("grabMode", new Dictionary<string, object> { { "excludes", false } }); } catch { }
    }

    /// <summary>on the magnifier's thread: the screen rect, VyseBar left out, shrunk to ow x oh RGBA</summary>
    [HandleProcessCorruptedStateExceptions, SecurityCritical]
    static byte[] MagStrip(int x, int y, int w, int h, int ow, int oh)
    {
        if (magBroken) return null;
        try
        {
            if (!magInit)
            {
                if (!MagInitialize()) { Broke("MagInitialize failed"); return null; }
                magInit = true;
                magHost = CreateWindowEx(WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, "Static", "VyseBar glass", WS_POPUP, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
                if (magHost == IntPtr.Zero) { Broke("no host window"); return null; }
                SetLayeredWindowAttributes(magHost, 0, 255, LWA_ALPHA);
            }
            // the control draws a picture its own size. Resizing one after it has drawn crashes
            // inside Windows, so each new size gets a new control
            if (magCtl == IntPtr.Zero || ctlW != w || ctlH != h)
            {
                if (magCtl != IntPtr.Zero) DestroyWindow(magCtl);
                magCtl = CreateWindowEx(0, "Magnifier", "", WS_CHILD | WS_VISIBLE, 0, 0, w, h, magHost, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
                ctlW = ctlH = 0;
                excluded = new IntPtr[0];
                if (magCtl == IntPtr.Zero) { Broke("no magnifier control"); return null; }
                if (!MagSetImageScalingCallback(magCtl, onFrame)) { Broke("no picture callback"); return null; }
                ctlW = w;
                ctlH = h;
            }
            // VyseBar's windows right now (a card or the Settings window may have opened)
            found.Clear();
            EnumWindows(collect, IntPtr.Zero);
            if (!SameWindows(found, excluded))
            {
                IntPtr[] list = found.ToArray();
                if (list.Length > 0 && !MagSetWindowFilterList(magCtl, MW_FILTERMODE_EXCLUDE, list.Length, list)) return Missed();
                excluded = list;
            }
            frameGot = false;
            MRECT r = new MRECT { left = x, top = y, right = x + w, bottom = y + h };
            if (!MagSetWindowSource(magCtl, r) || !frameGot) return Missed();
            if (frameW < 1 || frameH < 1 || frameStride < frameW * 4 || frame.Length < frameStride * frameH) return Missed();
            misses = 0;
            return Shrink(frame, frameW, frameH, frameStride, ow, oh);
        }
        catch (Exception e)
        {
            Broke(e.GetType().Name + ": " + e.Message);
            return null;
        }
    }

    // a read on the magnifier's thread. One that doesn't come back (a graphics driver stuck in
    // it) leaves its caller without a picture after a while instead of waiting for ever, and two
    // of those in a row hand the reads over to GDI
    static int stalls;

    static byte[] OnMag(Func<byte[]> fn, int ms)
    {
        Control ui = magUi;
        if (ui == null) return null;
        byte[] result = null;
        IAsyncResult r;
        try
        {
            r = ui.BeginInvoke(new Action(delegate
            {
                try { result = fn(); }
                catch { result = null; }
            }));
        }
        catch { return null; }
        if (!r.AsyncWaitHandle.WaitOne(ms))
        {
            if (Interlocked.Increment(ref stalls) >= 2) Broke("it stopped answering");
            return null;
        }
        Interlocked.Exchange(ref stalls, 0);
        try { ui.EndInvoke(r); } catch { }
        return result;
    }

    // a few misses in a row mean the magnifier doesn't answer on this PC
    static byte[] Missed()
    {
        if (++misses >= 3) Broke("no picture three times in a row");
        return null;
    }

    static bool OnFrame(IntPtr hwnd, IntPtr src, MAGIMAGEHEADER srcHeader, IntPtr dst, MAGIMAGEHEADER dstHeader, MRECT unclipped, MRECT clipped, IntPtr dirty)
    {
        try
        {
            int n = (int)srcHeader.cbSize.ToUInt64();
            if (src == IntPtr.Zero || n <= 0) return true;
            if (frame.Length != n) frame = new byte[n];
            Marshal.Copy(src, frame, 0, n);
            frameW = (int)srcHeader.width;
            frameH = (int)srcHeader.height;
            frameStride = (int)srcHeader.stride;
            frameGot = true;
        }
        catch { }
        return true;
    }

    static bool Collect(IntPtr hwnd, IntPtr lp)
    {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == VyseHost.Program.ParentPid && IsWindowVisible(hwnd)) found.Add(hwnd);
        return true;
    }

    static bool SameWindows(List<IntPtr> now, IntPtr[] before)
    {
        if (now.Count != before.Length) return false;
        for (int i = 0; i < before.Length; i++) if (now[i] != before[i]) return false;
        return true;
    }

    // a box filter from the magnifier's BGRA down to ow x oh, as RGBA for WebGL
    static byte[] Shrink(byte[] src, int sw, int sh, int stride, int ow, int oh)
    {
        byte[] dst = new byte[ow * oh * 4];
        for (int oy = 0; oy < oh; oy++)
        {
            int y0 = (int)((long)oy * sh / oh);
            int y1 = Math.Max(y0 + 1, (int)((long)(oy + 1) * sh / oh));
            for (int ox = 0; ox < ow; ox++)
            {
                int x0 = (int)((long)ox * sw / ow);
                int x1 = Math.Max(x0 + 1, (int)((long)(ox + 1) * sw / ow));
                int b = 0, g = 0, r = 0, c = 0;
                for (int yy = y0; yy < y1; yy++)
                {
                    int i = yy * stride + x0 * 4;
                    for (int xx = x0; xx < x1; xx++, i += 4)
                    {
                        b += src[i];
                        g += src[i + 1];
                        r += src[i + 2];
                        c++;
                    }
                }
                int o = (oy * ow + ox) * 4;
                dst[o] = (byte)(r / c);
                dst[o + 1] = (byte)(g / c);
                dst[o + 2] = (byte)(b / c);
                dst[o + 3] = 255;
            }
        }
        return dst;
    }
}
