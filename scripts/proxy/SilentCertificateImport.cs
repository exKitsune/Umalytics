using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Documented CryptoAPI import only. No policy/registry edits or UI automation.
public static class UmaSilentCertificateImport
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ImportSource
    {
        public uint Size;
        public uint SubjectChoice;
        public IntPtr CertificateContext;
        public uint Flags;
        [MarshalAs(UnmanagedType.LPWStr)] public string Password;
    }

    public sealed class Result
    {
        public bool Success;
        public string ErrorHex;
        public string ErrorMessage;
        public long ElapsedMilliseconds;
    }

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr CertOpenStore(IntPtr provider, uint encoding, IntPtr cryptProvider,
        uint flags, [MarshalAs(UnmanagedType.LPWStr)] string storeName);

    [DllImport("crypt32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CertCloseStore(IntPtr store, uint flags);

    [DllImport("cryptui.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUIWizImport(uint flags, IntPtr parent,
        string title, ref ImportSource source, IntPtr destination);

    public static Result Run(IntPtr certificateContext, bool memoryControl)
    {
        // CERT_STORE_PROV_MEMORY=2; CERT_STORE_PROV_SYSTEM_W=10.
        // Root destination: CURRENT_USER (0x10000) | OPEN_EXISTING (0x4000).
        IntPtr store = CertOpenStore(new IntPtr(memoryControl ? 2 : 10), 0, IntPtr.Zero,
            memoryControl ? 0u : 0x14000u, memoryControl ? null : "Root");
        if (store == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var source = new ImportSource {
                Size = (uint)Marshal.SizeOf(typeof(ImportSource)),
                SubjectChoice = 2, // CRYPTUI_WIZ_IMPORT_SUBJECT_CERT_CONTEXT
                CertificateContext = certificateContext,
                Flags = 0,
                Password = String.Empty
            };
            var timer = Stopwatch.StartNew();
            // CRYPTUI_WIZ_NO_UI | CRYPTUI_WIZ_IMPORT_ALLOW_CERT.
            bool success = CryptUIWizImport(0x00020001, IntPtr.Zero, null, ref source, store);
            int error = success ? 0 : Marshal.GetLastWin32Error();
            timer.Stop();
            return new Result {
                Success = success,
                ErrorHex = "0x" + unchecked((uint)error).ToString("X8"),
                ErrorMessage = success ? null : new Win32Exception(error).Message,
                ElapsedMilliseconds = timer.ElapsedMilliseconds
            };
        }
        finally { CertCloseStore(store, 0); }
    }
}
