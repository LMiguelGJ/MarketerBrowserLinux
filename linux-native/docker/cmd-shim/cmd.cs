// Compatibility shim for cmd.exe.
//
// The application starts an interactive cmd.exe, runs a helper in it and parses the
// text that comes back. It expects the banner of a real Windows console:
//
//   Microsoft Windows [Version 10.0.19045.5011]
//   (c) Microsoft Corporation. All rights reserved.
//
// The cmd.exe that ships with Wine prints a different banner, so the parsing fails
// and the application refuses to start a browser profile ("Failed to analyze IP").
//
// This program sits in the application folder, which Windows searches before the
// system folder. In interactive mode it prints the Windows banner and then hands
// over to the real cmd.exe with its own banner suppressed. With arguments (for
// example "cmd.exe /c ...") it is a transparent pass-through.
using System;
using System.Diagnostics;
using System.IO;

internal static class CmdShim
{
    private const string Banner =
        "Microsoft Windows [Version 10.0.19045.5011]\r\n" +
        "(c) Microsoft Corporation. All rights reserved.\r\n";
    // The blank line that follows in a real console is emitted by the "rem" below.

    private static int Main(string[] args)
    {
        string windir = Environment.GetEnvironmentVariable("windir") ?? @"C:\windows";
        string realCmd = Path.Combine(windir, @"system32\cmd.exe");

        // Everything after the program name in the original command line, untouched,
        // so quoting is preserved exactly.
        string commandLine = Environment.CommandLine;
        string rest = "";
        if (commandLine.StartsWith("\""))
        {
            int close = commandLine.IndexOf('"', 1);
            if (close >= 0) rest = commandLine.Substring(close + 1).Trim();
        }
        else
        {
            int space = commandLine.IndexOf(' ');
            if (space >= 0) rest = commandLine.Substring(space + 1).Trim();
        }

        bool interactive = rest.Length == 0;
        if (interactive)
        {
            Console.Out.Write(Banner);
            Console.Out.Flush();
            // "/k rem" keeps the shell open but stops it from printing its own banner.
            rest = "/k rem";
        }

        var info = new ProcessStartInfo(realCmd, rest) { UseShellExecute = false };
        using (Process child = Process.Start(info))
        {
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
