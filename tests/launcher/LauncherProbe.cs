using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;

// Harmless game stand-in, compiled only into .cache/launcher-tests.
internal static class LauncherProbe
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();
    [DataContract]
    private sealed class Result
    {
        [DataMember] public string[] args;
        [DataMember] public string http_proxy;
        [DataMember] public string https_proxy;
        [DataMember] public string all_proxy;
        [DataMember] public string no_proxy;
        [DataMember] public string working_directory;
        [DataMember] public bool console_attached;
    }
    private static int Main(string[] args)
    {
        if (args.Length == 0) return 2;
        var result = new Result {
            args = args,
            http_proxy = Environment.GetEnvironmentVariable("http_proxy"),
            https_proxy = Environment.GetEnvironmentVariable("https_proxy"),
            all_proxy = Environment.GetEnvironmentVariable("all_proxy"),
            no_proxy = Environment.GetEnvironmentVariable("no_proxy"),
            working_directory = Environment.CurrentDirectory,
            console_attached = GetConsoleWindow() != IntPtr.Zero
        };
        using (var stream = File.Create(args[0]))
            new DataContractJsonSerializer(typeof(Result)).WriteObject(stream, result);
        return 37;
    }
}
