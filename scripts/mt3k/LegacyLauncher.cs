using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// Transitional compatibility for mt3k.16 and mt3k.17. REMOVE in mt3k.18
// (two releases after introduction), together with include-legacy-stub.cjs.
// Old update helpers and Xbox manifests require the ORBIT.exe filename.
internal static class LegacyLauncher
{
    // Windows CRT quoting: retain empty arguments, quotes and trailing slashes.
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); }
            else { result.Append('\\', slashes); }
            result.Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string executable = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "MT3KLauncher.exe");
            var arguments = new StringBuilder();
            foreach (string arg in args)
            {
                if (arguments.Length > 0) arguments.Append(' ');
                arguments.Append(Quote(arg));
            }
            Process.Start(new ProcessStartInfo(executable, arguments.ToString()) {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Environment.CurrentDirectory
            });
            return 0;
        }
        catch { return 1; }
    }
}
