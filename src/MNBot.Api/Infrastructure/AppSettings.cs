namespace MNBot.Api.Infrastructure;

public sealed class BacktestSettings
{
    /// <summary>Spread moyen simulé (fraction).</summary>
    public decimal SpreadPct { get; set; } = 0.0005m;
    /// <summary>Part des données utilisée pour l'échantillon d'entraînement (le reste sert à la validation).</summary>
    public decimal TrainRatio { get; set; } = 0.7m;
    /// <summary>Profondeur d'historique par défaut (jours) lors d'un import.</summary>
    public int DefaultHistoryDays { get; set; } = 730;
}

public sealed class ServerSettings
{
    /// <summary>Adresse d'écoute. 127.0.0.1 = accessible uniquement depuis la machine (recommandé sur un VPS, via tunnel SSH).</summary>
    public string Urls { get; set; } = "http://127.0.0.1:5080";
}

public sealed class AiSettings
{
    /// <summary>Active les commentaires générés par Claude (nécessite ANTHROPIC_API_KEY). Lecture seule : aucun accès aux ordres.</summary>
    public bool Enabled { get; set; } = true;
    public string Model { get; set; } = "claude-opus-5-5";
    public int MaxTokens { get; set; } = 2000;
}

public sealed class NotificationSettings
{
    /// <summary>Niveau minimal des alertes envoyées sur Telegram : Info, Warning ou Critical.</summary>
    public string TelegramMinLevel { get; set; } = "Warning";
}

/// <summary>Emplacements des fichiers (racine = variable MNBOT_HOME ou dossier courant).</summary>
public sealed class AppPaths
{
    public AppPaths(string home)
    {
        Home = Path.GetFullPath(home);
        Config = Path.Combine(Home, "config", "mnbot.json");
        Data = Path.Combine(Home, "data");
        Database = Path.Combine(Data, "mnbot.db");
        Logs = Path.Combine(Home, "logs");
        EnvFile = Path.Combine(Home, ".env");
    }

    public string Home { get; }
    public string Config { get; }
    public string Data { get; }
    public string Database { get; }
    public string Logs { get; }
    public string EnvFile { get; }

    public static AppPaths Resolve()
    {
        var env = Environment.GetEnvironmentVariable("MNBOT_HOME");
        if (!string.IsNullOrWhiteSpace(env)) return new AppPaths(env);
        // Recherche du dossier contenant config/mnbot.json en remontant depuis le dossier courant puis depuis l'exécutable
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var dir = new DirectoryInfo(start);
            while (dir is not null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "config", "mnbot.json"))) return new AppPaths(dir.FullName);
                dir = dir.Parent;
            }
        }
        return new AppPaths(Directory.GetCurrentDirectory());
    }

    /// <summary>Charge un fichier .env (CLE=valeur) dans les variables d'environnement, sans écraser celles déjà définies.</summary>
    public void LoadEnvFile()
    {
        if (!File.Exists(EnvFile)) return;
        foreach (var raw in File.ReadAllLines(EnvFile))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var eq = line.IndexOf('=');
            if (eq <= 0) continue;
            var key = line[..eq].Trim();
            var value = line[(eq + 1)..].Trim().Trim('"', '\'');
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                Environment.SetEnvironmentVariable(key, value);
        }
    }
}
