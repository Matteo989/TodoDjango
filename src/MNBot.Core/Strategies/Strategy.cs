using MNBot.Core.Domain;

namespace MNBot.Core.Strategies;

/// <summary>
/// Données fournies à une stratégie. Ne contient QUE des bougies clôturées à l'instant de décision,
/// ce qui interdit tout biais de look-ahead (en réel comme en backtest).
/// </summary>
public sealed record StrategyContext(
    string Symbol,
    IReadOnlyList<Candle> EntryCandles,   // bougies clôturées de l'unité d'entrée (1h)
    IReadOnlyList<Candle> TrendCandles,   // bougies clôturées de l'unité de tendance (4h)
    Position? OpenPosition,
    DateTime DecisionTimeUtc);

public sealed record StrategyEvaluation(
    SignalAction Action,
    decimal Price,
    decimal? StopDistance,
    decimal? StopLoss,
    decimal? TakeProfit,
    decimal RewardRisk,
    IReadOnlyList<SignalCheck> Checks,
    string Reason,
    IReadOnlyDictionary<string, decimal?> Indicators)
{
    public static StrategyEvaluation NotEnoughData(string reason) =>
        new(SignalAction.None, 0, null, null, null, 0, Array.Empty<SignalCheck>(), reason, new Dictionary<string, decimal?>());
}

public interface IStrategy
{
    string Id { get; }
    string Name { get; }
    string Description { get; }
    Timeframe EntryTimeframe { get; }
    Timeframe TrendTimeframe { get; }

    /// <summary>Nombre de bougies d'historique nécessaires pour des indicateurs fiables.</summary>
    int RequiredEntryCandles { get; }
    int RequiredTrendCandles { get; }

    object Parameters { get; }

    StrategyEvaluation Evaluate(StrategyContext context);
}
