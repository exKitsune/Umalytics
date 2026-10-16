using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;

class FrozenHandoffHelper {
    static JavaScriptSerializer Json = new JavaScriptSerializer();
    static Dictionary<string, object> Read(string path) { return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path)); }
    static string Call(string origin, string path, string token, string body) {
        var request = (HttpWebRequest)WebRequest.Create(origin + path);
        request.Proxy = null; request.Method = "POST"; request.ContentType = "application/json"; request.Timeout = 5000;
        request.Headers["Origin"] = origin; request.Headers["X-UmaTrace-CSRF"] = token;
        var raw = Encoding.UTF8.GetBytes(body); request.ContentLength = raw.Length;
        using(var output = request.GetRequestStream()) output.Write(raw, 0, raw.Length);
        using(var response = request.GetResponse()) using(var reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
    }
    static int Main(string[] args) {
        try {
            var transaction = Read(args[1]);
            var data = (string)transaction["dataDirectory"];
            var controlPath = Path.Combine(data, "control.json");
            var control = Read(controlPath);
            var origin = "http://127.0.0.1:" + control["port"];
            var token = (string)control["token"];
            var reset = Environment.GetEnvironmentVariable("PYINSTALLER_RESET_ENVIRONMENT");
            Call(origin, "/api/update/restart", token, Json.Serialize(new { token = transaction["token"] }));
            Call(origin, "/api/app/exit", token, "{}");
            var extraction = (string)control["extraction"];
            var deadline = DateTime.UtcNow.AddSeconds(20);
            while(Directory.Exists(extraction) && DateTime.UtcNow < deadline) Thread.Sleep(30);
            if(Directory.Exists(extraction)) throw new Exception("Parent extraction directory was not cleaned up.");
            // Reproduce the pre-fix chain using real inherited private bootloader
            // values; the success case carries the production handoff untouched.
            if((bool)control["legacy"]) Environment.SetEnvironmentVariable("PYINSTALLER_RESET_ENVIRONMENT", null);
            var info = new ProcessStartInfo((string)control["runtime"], "--child --control \"" + controlPath + "\"");
            info.UseShellExecute = false; info.CreateNoWindow = true;
            info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            using(var child = Process.Start(info)) {
                if(!child.WaitForExit(20000)) { child.Kill(); throw new Exception("Fresh frozen child did not finish."); }
                var error = child.StandardError.ReadToEnd();
                File.WriteAllText(Path.Combine(data, "result.json"), Json.Serialize(new {
                    helperPid = Process.GetCurrentProcess().Id,
                    exitCode = child.ExitCode, error = error, inheritedReset = reset,
                    parentExtractionRemoved = !Directory.Exists(extraction)
                }));
            }
            return 0;
        } catch(Exception error) {
            File.WriteAllText(Path.Combine(Path.GetDirectoryName(args[1]), "fixture-helper-error.txt"), error.ToString());
            return 1;
        }
    }
}
