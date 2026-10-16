using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("UmaTrace Launcher")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]

namespace UmaTrace
{
    // Built as a Windows-subsystem executable: no console is allocated at
    // startup. No PowerShell, cmd, injection, or certificate changes are used.
    internal static class Launcher
    {
        [DllImport("kernel32.dll")]
        private static extern IntPtr GetConsoleWindow();

        [DataContract]
        private sealed class LaunchRecord
        {
            [DataMember] public string started_at;
            [DataMember] public string ended_at;
            [DataMember] public string mode;
            [DataMember] public string state;
            [DataMember] public string error;
            [DataMember] public string game_path;
            [DataMember] public string proxy = "http://127.0.0.1:4327";
            [DataMember] public string environment_scope = "child-only";
            [DataMember] public bool elevated;
            [DataMember] public bool console_attached;
            [DataMember] public int launcher_pid;
            [DataMember] public int game_pid;
            [DataMember] public int exit_code;
        }

        private sealed class LaunchError : Exception
        {
            internal readonly string Code;
            internal LaunchError(string code, string message) : base(message) { Code = code; }
        }

        [STAThread]
        private static int Main(string[] args)
        {
            var record = new LaunchRecord {
                started_at = DateTimeOffset.UtcNow.ToString("o"),
                launcher_pid = Process.GetCurrentProcess().Id,
                console_attached = GetConsoleWindow() != IntPtr.Zero,
                state = "checking", mode = "launch"
            };
            bool check = false;
            bool quiet = false;
            try
            {
                int index = 0;
                while (index < args.Length && args[index] != "--")
                {
                    if (args[index] == "--check") { check = true; quiet = true; }
                    else if (args[index] == "--quiet") quiet = true;
                    else throw new LaunchError("usage", "Set Uma's Steam Launch Options to the UmaTrace launcher path followed by -- %command%.");
                    index++;
                }
                if (index >= args.Length - 1) throw new LaunchError("usage", "The launcher needs the game executable after --.");
                index++;
                record.mode = check ? "check" : "launch";
                record.game_path = Path.GetFullPath(args[index++]);
                if (!String.Equals(Path.GetFileName(record.game_path), "\u0055mamusume\u0050rettyDerby.exe", StringComparison.OrdinalIgnoreCase)
                    || !File.Exists(record.game_path))
                    throw new LaunchError("game_missing", "Uma's executable could not be found. Check its Steam installation and Launch Options.");

                using (var identity = WindowsIdentity.GetCurrent())
                    record.elevated = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                if (record.elevated) throw new LaunchError("elevated", "Launch Uma through Steam without running Steam or UmaTrace as administrator.");
                if (IsRunning("\u0055mamusume\u0050rettyDerby")) throw new LaunchError("game_running", "Uma is already running. Close it before starting another instance.");
                if (!IsRunning("steam")) throw new LaunchError("steam_missing", "Open Steam and launch Uma from its library.");
                if (!ProxyIsListening()) throw new LaunchError("proxy_unavailable", "UmaTrace's capture proxy is not running. Start the collector, then launch Uma again. To play without capture, clear Uma's Steam Launch Options.");

                if (check)
                {
                    record.state = "ready";
                    record.ended_at = DateTimeOffset.UtcNow.ToString("o");
                    Save(record);
                    return 0;
                }

                var start = new ProcessStartInfo {
                    FileName = record.game_path,
                    WorkingDirectory = Path.GetDirectoryName(record.game_path),
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                var forwarded = new List<string>();
                for (; index < args.Length; index++) forwarded.Add(QuoteArgument(args[index]));
                start.Arguments = String.Join(" ", forwarded.ToArray());
                // Change only this ProcessStartInfo's copied environment.
                var keys = new List<string>();
                foreach (string key in start.EnvironmentVariables.Keys) keys.Add(key);
                foreach (string key in keys)
                    if (IsProxyVariable(key)) start.EnvironmentVariables.Remove(key);
                foreach (string key in new[] { "http_proxy", "https_proxy", "all_proxy" })
                    start.EnvironmentVariables[key] = record.proxy;
                start.EnvironmentVariables["no_proxy"] = "localhost,127.0.0.1,::1";

                using (var game = Process.Start(start))
                {
                    if (game == null) throw new LaunchError("start_failed", "Windows could not start Uma.");
                    record.game_pid = game.Id;
                    record.state = "running";
                    Save(record);
                    // Steam tracks the wrapper for the lifetime of its game child.
                    game.WaitForExit();
                    record.exit_code = game.ExitCode;
                }
                record.state = "exited";
                record.ended_at = DateTimeOffset.UtcNow.ToString("o");
                Save(record);
                return record.exit_code;
            }
            catch (Exception error)
            {
                var known = error as LaunchError;
                record.error = known == null ? error.GetType().Name : known.Code;
                record.state = "error";
                record.exit_code = 1;
                record.ended_at = DateTimeOffset.UtcNow.ToString("o");
                Save(record);
                if (!quiet)
                    MessageBox.Show(known == null ? "UmaTrace could not launch the game. Check the launcher status in LocalAppData\\UmaTrace\\launcher." : known.Message,
                        "UmaTrace", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }
        }

        private static bool IsRunning(string name)
        {
            var processes = Process.GetProcessesByName(name);
            bool running = processes.Length != 0;
            foreach (var process in processes) process.Dispose();
            return running;
        }

        private static bool ProxyIsListening()
        {
            using (var client = new TcpClient())
            {
                try
                {
                    var pending = client.BeginConnect(IPAddress.Loopback, 4327, null, null);
                    using (pending.AsyncWaitHandle)
                    {
                        if (!pending.AsyncWaitHandle.WaitOne(2000)) return false;
                        client.EndConnect(pending);
                    }
                    return true;
                }
                catch (SocketException) { return false; }
            }
        }

        private static bool IsProxyVariable(string key)
        {
            foreach (string name in new[] { "http_proxy", "https_proxy", "all_proxy", "no_proxy" })
                if (String.Equals(key, name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        // Windows command-line escaping, including embedded quotes and trailing
        // backslashes. The child's actual argv round-trip is covered by a fixture.
        private static string QuoteArgument(string value)
        {
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') result.Append('\\', slashes * 2 + 1);
                else result.Append('\\', slashes);
                slashes = 0;
                result.Append(character);
            }
            result.Append('\\', slashes * 2);
            return result.Append('"').ToString();
        }

        private static void Save(LaunchRecord record)
        {
            try
            {
                string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UmaTrace", "launcher");
                Directory.CreateDirectory(directory);
                string path = Path.Combine(directory, "latest-launch.json");
                string temporary = Path.Combine(directory, "launch-" + record.launcher_pid + ".tmp");
                using (var stream = File.Create(temporary))
                    new DataContractJsonSerializer(typeof(LaunchRecord)).WriteObject(stream, record);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            catch (IOException) { /* Diagnostics must not interrupt the game. */ }
            catch (UnauthorizedAccessException) { }
        }
    }
}
