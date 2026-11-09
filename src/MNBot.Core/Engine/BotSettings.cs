using MNBot.Core.Domain;

namespace MNBot.Core.Engine;

/// <summary>Paramètres généraux du bot (section "Bot" de config/mnbot.json).</summary>
public sealed class BotSettings
{
    /// <summary>"Paper" (simulation, par défaut) ou "Live" (argent réel, voir docs/PASSAGE_EN_REEL.md).</summary>
    public TradingMode Mode { get; set; } = TradingMode.Paper;
    public string Exchange { get; set; } = "Kraken";
    /// <summary>Actifs surveillés (BTC/EUR et ETH/EUR si la liste est vide).</summary>
    public List<string> Symbols { get; set; } = new();
    /// <summary>Fréquence de surveillance des prix et des stops (secondes).</summary>
    public int LoopIntervalSeconds { get; set; } = 10;
    /// <summary>Fréquence de rafraîchissement des bougies (secondes).</summary>
    public int CandleRefreshSeconds { get; set; } = 60;
    /// <summary>Un signal d'entrée n'est exécuté que si la bougie s'est clôturée il y a moins de N minutes.</summary>
    public int SignalMaxAgeMinutes { get; set; } = 15;
    /// <summary>Démarrer automatiquement le moteur au lancement, en mode Paper uniquement.</summary>
    public bool AutoStartPaper { get; set; } = true;
    /// <summary>Durée minimale de paper trading avant d'autoriser le réel.</summary>
    public int PaperValidationMinDays { get; set; } = 30;
    /// <summary>Nombre minimal de transactions simulées avant d'autoriser le réel.</summary>
    public int PaperValidationMinTrades { get; set; } = 20;
    /// <summary>Contourner la validation paper (déconseillé). Une confirmation manuelle reste obligatoire.</summary>
    public bool AllowLiveWithoutValidation { get; set; } = false;
}

public enum EngineStatus { Stopped, Running, EmergencyStopped }
