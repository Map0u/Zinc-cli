// Offline acceptance fixture, not Claude Code. Never connects to a model provider.
// Compile in the disposable Windows VM as claude.exe to exercise Zinc's packaged
// hook, process binding, and per-tab restore wiring without real credentials.
using System;
using System.Diagnostics;
using System.IO;

internal static class FakeClaude
{
    private static string SettingsPath(string[] args)
    {
        for (int i = 0; i + 1 < args.Length; i++)
            if (args[i] == "--settings") return args[i + 1];
        return null;
    }

    private static void Report(string settingsPath, Guid id, string source)
    {
        if (settingsPath == null) return;
        string reporter = Path.Combine(Path.GetDirectoryName(settingsPath), "report.cmd");
        var start = new ProcessStartInfo("cmd.exe", "/d /c \"\"" + reporter + "\"\"");
        start.UseShellExecute = false;
        start.RedirectStandardInput = true;
        start.RedirectStandardError = true;
        start.CreateNoWindow = true;
        using (var child = Process.Start(start))
        {
            child.StandardInput.Write("{\"session_id\":\"" + id + "\",\"source\":\"" + source + "\"}");
            child.StandardInput.Close();
            if (!child.WaitForExit(15000) || child.ExitCode != 0)
                Console.Error.WriteLine("FAKE_CLAUDE_HOOK_FAILED " + child.StandardError.ReadToEnd());
        }
    }

    private static void Main(string[] args)
    {
        string settings = SettingsPath(args);
        Guid session = Guid.NewGuid();
        for (int i = 0; i + 1 < args.Length; i++)
        {
            Guid parsed;
            if (args[i] == "--resume" && Guid.TryParse(args[i + 1], out parsed))
                session = parsed;
        }
        Report(settings, session, "startup");
        Console.WriteLine("ZINC_FAKE_CLAUDE_SESSION=" + session);
        for (;;)
        {
            string line = Console.ReadLine();
            if (line == null || line.Trim() == "exit") return;
            if (line.Trim() == "/clear")
            {
                session = Guid.NewGuid();
                Report(settings, session, "clear");
                Console.WriteLine("ZINC_FAKE_CLAUDE_SESSION=" + session);
            }
        }
    }
}
