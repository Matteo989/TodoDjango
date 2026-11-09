namespace MNBot.Core.Risk;

/// <summary>Règles de gestion du capital (section "Risk" de config/mnbot.json).</summary>
public sealed class RiskSettings
{
    /// <summary>Capital initial du compte (€).</summary>
    public decimal InitialCapital { get; set; } = 100m;
    /// <summary>Capital maximum engagé dans le trading (€). Ne s'accroît jamais automatiquement, même après des gains.</summary>
    public decimal MaxTradingCapital { get; set; } = 70m;
    /// <summary>Réserve jamais utilisée (€).</summary>
    public decimal Reserve { get; set; } = 20m;
    /// <summary>Marge de sécurité jamais utilisée (€).</summary>
    public decimal SafetyMargin { get; set; } = 10m;
    /// <summary>Perte maximale visée par transaction (€), frais et glissement inclus.</summary>
    public decimal RiskPerTrade { get; set; } = 0.50m;
    /// <summary>Perte maximale par jour (€). Au-delà : plus aucune nouvelle position jusqu'au lendemain.</summary>
    public decimal MaxDailyLoss { get; set; } = 1.50m;
    /// <summary>Perte maximale par semaine (€). Au-delà : plus aucune nouvelle position jusqu'à la semaine suivante.</summary>
    public decimal MaxWeeklyLoss { get; set; } = 3.00m;
    public int MaxOpenPositions { get; set; } = 1;

    /// <summary>Frais « taker » (ordres au marché). Kraken Spot, palier de départ : 0,40 %.</summary>
    public decimal TakerFeeRate { get; set; } = 0.0040m;
    /// <summary>Glissement de prix estimé par ordre (fraction du prix).</summary>
    public decimal SlippageRate { get; set; } = 0.0005m;

    /// <summary>Rapport minimal gain net / perte nette (après frais) pour accepter une transaction.</summary>
    public decimal MinNetRewardRisk { get; set; } = 1.3m;
    /// <summary>Part maximale du gain brut visé que les frais peuvent consommer.</summary>
    public decimal MaxFeeShareOfReward { get; set; } = 0.40m;
    /// <summary>Spread maximal accepté au moment de l'entrée (fraction).</summary>
    public decimal MaxSpreadPct { get; set; } = 0.003m;

    /// <summary>Fuseau horaire utilisé pour le calcul des limites journalières/hebdomadaires.</summary>
    public string TimeZone { get; set; } = "Europe/Paris";

    /// <summary>Âge maximal (secondes) des prix avant de considérer les données comme figées.</summary>
    public int MaxTickerAgeSeconds { get; set; } = 60;
    /// <summary>Variation de prix (fraction) entre deux relevés au-delà de laquelle on suspecte une anomalie.</summary>
    public decimal MaxPriceJumpPct { get; set; } = 0.08m;
    /// <summary>Nombre d'erreurs API consécutives avant mise en pause automatique des nouvelles entrées.</summary>
    public int MaxConsecutiveApiErrors { get; set; } = 5;

    public decimal ProtectedCapital => Reserve + SafetyMargin;

    public IEnumerable<string> Validate()
    {
        if (MaxTradingCapital + Reserve + SafetyMargin > InitialCapital + 0.0001m)
            yield return "Capital de trading + réserve + marge dépasse le capital initial.";
        if (RiskPerTrade <= 0) yield return "RiskPerTrade doit être positif.";
        if (RiskPerTrade > MaxDailyLoss) yield return "RiskPerTrade ne peut pas dépasser MaxDailyLoss.";
        if (MaxDailyLoss > MaxWeeklyLoss) yield return "MaxDailyLoss ne peut pas dépasser MaxWeeklyLoss.";
        if (MaxOpenPositions < 1) yield return "MaxOpenPositions doit être au moins 1.";
        if (TakerFeeRate < 0 || SlippageRate < 0) yield return "Frais et glissement doivent être positifs.";
    }
}
