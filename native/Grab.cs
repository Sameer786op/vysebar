// The picture behind the live glass: a strip of the screen as Windows composes it, read with
// GDI a few times a second and scaled down on the way. Windows that keep themselves out of
// captures (the dock, in Smooth glass) aren't in it, so the dock sees what is behind it.
// This replaces a continuous 30 fps screen-capture stream: that kept a desktop-duplication
// session open all the time, which costs a third of a CPU core and stops Windows from using
// its fast paths for games and video, so everything on the PC felt less smooth.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

static class Grab
{
    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }

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

    const int SRCCOPY = 0x00CC0020;
    const int HALFTONE = 4;

    static readonly object gate = new object();
    static IntPtr memDc, dib, oldBmp, bits;
    static int dibW, dibH;
    static byte[] buffer = new byte[0];

    /// <summary>the screen rect x,y,w,h (physical pixels) scaled to ow x oh, as base64 RGBA</summary>
    public static object Strip(int x, int y, int w, int h, int ow, int oh)
    {
        if (w <= 0 || h <= 0 || ow <= 0 || oh <= 0 || ow > 8192 || oh > 8192) return null;
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

    /// <summary>let the bitmap go (the glass is off, or the dock is idle)</summary>
    public static bool Release()
    {
        lock (gate) { Free(); buffer = new byte[0]; }
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
}
