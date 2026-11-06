// The text in a picture (a screenshot), read by Windows' own OCR in the languages you have
// installed. Nothing leaves the PC.
using System;
using System.Text;
using System.Threading.Tasks;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Storage.Streams;

namespace VyseHost
{
    public static class Ocr
    {
        public static async Task<object> Read(string path)
        {
            OcrEngine engine = OcrEngine.TryCreateFromUserProfileLanguages();
            if (engine == null) throw new Exception("Windows has no text recognition for your languages");
            // the Storage API only takes a full path with backslashes
            StorageFile file = await StorageFile.GetFileFromPathAsync(System.IO.Path.GetFullPath(path.Replace('/', '\\')));
            SoftwareBitmap bmp;
            using (IRandomAccessStream s = await file.OpenAsync(FileAccessMode.Read))
            {
                BitmapDecoder dec = await BitmapDecoder.CreateAsync(s);
                uint max = OcrEngine.MaxImageDimension;
                if (dec.PixelWidth > max || dec.PixelHeight > max)
                {
                    // too big for the engine: scaled down to fit, keeping its shape
                    double k = Math.Min((double)max / dec.PixelWidth, (double)max / dec.PixelHeight);
                    BitmapTransform t = new BitmapTransform();
                    t.ScaledWidth = (uint)(dec.PixelWidth * k);
                    t.ScaledHeight = (uint)(dec.PixelHeight * k);
                    bmp = await dec.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, t, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage);
                }
                else bmp = await dec.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
            }
            OcrResult r = await engine.RecognizeAsync(bmp);
            StringBuilder sb = new StringBuilder();
            foreach (OcrLine line in r.Lines)
            {
                if (sb.Length > 0) sb.Append('\n');
                sb.Append(line.Text);
            }
            return sb.ToString();
        }
    }
}
