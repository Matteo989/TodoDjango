using System.Collections.Concurrent;
using System.Text;

namespace MNBot.Api.Infrastructure;

/// <summary>Journal fichier quotidien (logs/mnbot-AAAAMMJJ.log), conservé 30 jours.</summary>
public sealed class FileLoggerProvider : ILoggerProvider
{
    private readonly string _dir;
    private readonly object _lock = new();
    private readonly ConcurrentDictionary<string, FileLogger> _loggers = new();

    public FileLoggerProvider(string dir)
    {
        _dir = dir;
        Directory.CreateDirectory(dir);
        try
        {
            foreach (var f in Directory.GetFiles(dir, "mnbot-*.log"))
                if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddDays(-30)) File.Delete(f);
        }
        catch { /* nettoyage facultatif */ }
    }

    public ILogger CreateLogger(string categoryName) => _loggers.GetOrAdd(categoryName, n => new FileLogger(this, n));

    internal void Write(string line)
    {
        lock (_lock)
        {
            try { File.AppendAllText(Path.Combine(_dir, $"mnbot-{DateTime.UtcNow:yyyyMMdd}.log"), line + Environment.NewLine, Encoding.UTF8); }
            catch { /* le journal ne doit jamais faire tomber le bot */ }
        }
    }

    public void Dispose() { }

    private sealed class FileLogger : ILogger
    {
        private readonly FileLoggerProvider _p;
        private readonly string _name;
        public FileLogger(FileLoggerProvider p, string name) { _p = p; _name = name; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information &&
            !(_name.StartsWith("Microsoft.", StringComparison.Ordinal) && logLevel < LogLevel.Warning) &&
            !(_name.StartsWith("System.Net.Http", StringComparison.Ordinal) && logLevel < LogLevel.Warning);
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var msg = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}Z [{logLevel}] {_name}: {formatter(state, exception)}";
            if (exception is not null) msg += Environment.NewLine + exception;
            _p.Write(msg);
        }
    }
}
