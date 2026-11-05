// Lets C# 5 await WinRT operations. The usual helpers in System.Runtime.WindowsRuntime are
// bound to the single Windows.winmd of the SDK; Windows itself ships split .winmd files, so
// this bridges IAsyncOperation to Task by hand.
using System;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using Windows.Foundation;

namespace VyseHost
{
    public static class WinRtAsync
    {
        public static Task<T> AsTask<T>(this IAsyncOperation<T> op)
        {
            TaskCompletionSource<T> tcs = new TaskCompletionSource<T>();
            op.Completed = delegate (IAsyncOperation<T> info, AsyncStatus status)
            {
                if (status == AsyncStatus.Completed)
                {
                    try { tcs.TrySetResult(info.GetResults()); }
                    catch (Exception e) { tcs.TrySetException(e); }
                }
                else if (status == AsyncStatus.Error) tcs.TrySetException(info.ErrorCode ?? new Exception("WinRT operation failed"));
                else tcs.TrySetCanceled();
            };
            return tcs.Task;
        }

        public static TaskAwaiter<T> GetAwaiter<T>(this IAsyncOperation<T> op)
        {
            return op.AsTask().GetAwaiter();
        }
    }
}
