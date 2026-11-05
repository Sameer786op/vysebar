// Window previews for the hover popup: only the windows asked for, drawn with PrintWindow
// (the full-content flag covers GPU-drawn apps), scaled with GDI and sent as small JPEGs.
// Electron's desktopCapturer captured every window on screen and PNG-encoded them on the main
// thread, which froze the mouse pointer for up to ~90 ms each time a preview refreshed.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

static class Thumbs
{
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }

    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int mode);
    [DllImport("gdi32.dll")] static extern bool SetBrushOrgEx(IntPtr dc, int x, int y, IntPtr prev);
    [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int sw, int sh, int rop);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr section, uint offset);

    const uint PW_RENDERFULLCONTENT = 2;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    const int SRCCOPY = 0x00CC0020;
    const int HALFTONE = 4;

    static readonly object gate = new object();
    static ImageCodecInfo jpeg;
    static EncoderParameters quality;

    /// <summary>hwnd → JPEG data URL, at most maxW x maxH; windows that can't be drawn are left out</summary>
    public static Dictionary<string, object> Get(IEnumerable<IntPtr> hwnds, int maxW, int maxH)
    {
        var out_ = new Dictionary<string, object>();
        lock (gate)
        {
            foreach (IntPtr h in hwnds)
            {
                try
                {
                    string url = One(h, maxW, maxH);
                    if (url != null) out_[((long)h).ToString()] = url;
                }
                catch { }
            }
        }
        return out_;
    }

    static IntPtr Dib(IntPtr screen, int w, int h, out IntPtr bits)
    {
        var bi = new BITMAPINFOHEADER { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
        return CreateDIBSection(screen, ref bi, 0, out bits, IntPtr.Zero, 0);
    }

    static string One(IntPtr h, int maxW, int maxH)
    {
        // a minimized window has nothing to draw, and a hung one would hang us too
        if (!IsWindow(h) || IsIconic(h) || IsHungAppWindow(h)) return null;
        RECT wr, fr;
        if (!GetWindowRect(h, out wr)) return null;
        int ww = wr.Right - wr.Left, wh = wr.Bottom - wr.Top;
        if (ww < 8 || wh < 8 || ww > 16384 || wh > 16384) return null;
        // the visible frame, without the invisible resize borders Windows 10/11 adds around it
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out fr, 16) != 0) fr = wr;
        int cx = Math.Max(0, fr.Left - wr.Left), cy = Math.Max(0, fr.Top - wr.Top);
        int cw = Math.Min(ww - cx, fr.Right - fr.Left), ch = Math.Min(wh - cy, fr.Bottom - fr.Top);
        if (cw < 8 || ch < 8) return null;
        double s = Math.Min(1.0, Math.Min((double)maxW / cw, (double)maxH / ch));
        int tw = Math.Max(1, (int)Math.Round(cw * s)), th = Math.Max(1, (int)Math.Round(ch * s));

        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr full = CreateCompatibleDC(screen), small = CreateCompatibleDC(screen);
        IntPtr fullBits, smallBits;
        IntPtr fullBmp = Dib(screen, ww, wh, out fullBits), smallBmp = Dib(screen, tw, th, out smallBits);
        IntPtr oldFull = SelectObject(full, fullBmp), oldSmall = SelectObject(small, smallBmp);
        try
        {
            if (fullBmp == IntPtr.Zero || smallBmp == IntPtr.Zero) return null;
            if (!PrintWindow(h, full, PW_RENDERFULLCONTENT)) return null;
            SetStretchBltMode(small, HALFTONE);
            SetBrushOrgEx(small, 0, 0, IntPtr.Zero);
            if (!StretchBlt(small, 0, 0, tw, th, full, cx, cy, cw, ch, SRCCOPY)) return null;
            using (var bmp = new Bitmap(tw, th, tw * 4, PixelFormat.Format32bppRgb, smallBits))
            using (var ms = new MemoryStream())
            {
                if (jpeg == null)
                {
                    foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpeg = c;
                    quality = new EncoderParameters(1);
                    quality.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 86L);
                }
                bmp.Save(ms, jpeg, quality);
                return "data:image/jpeg;base64," + Convert.ToBase64String(ms.GetBuffer(), 0, (int)ms.Length);
            }
        }
        finally
        {
            SelectObject(full, oldFull);
            SelectObject(small, oldSmall);
            if (fullBmp != IntPtr.Zero) DeleteObject(fullBmp);
            if (smallBmp != IntPtr.Zero) DeleteObject(smallBmp);
            DeleteDC(full);
            DeleteDC(small);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }
}
