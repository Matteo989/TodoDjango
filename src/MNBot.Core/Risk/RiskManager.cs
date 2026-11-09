using MNBot.Core.Domain;

namespace MNBot.Core.Risk;

public sealed record RiskSnapshot(
    decimal Equity,
    decimal Cash,
    decimal AvailableForTrading,
    decimal Exposure,
    decimal OpenRisk,
    decimal DailyPnl,
    decimal WeeklyPnl,
    decimal TotalPnl,
    decimal DailyLossLimit,
    decimal WeeklyLossLimit,
    int OpenPositions,
    int MaxOpenPositions,
    bool CanOpenNewPosition,
    IReadOnlyList<string> BlockingReasons,
    decimal RiskBudget);

/// <summary>
/// Gardien du capital. Décide de façon déterministe si une nouvelle position peut être ouverte.
/// Aucune autre partie du système (y compris le module d'IA) ne peut contourner ces règles.
/// </summary>
public sealed class RiskManager
{
    private readonly RiskSettings _s;
    private readonly TimeZoneInfo _tz;

    public RiskManager(RiskSettings settings)
    {
        _s = settings;
        _tz = ResolveTimeZone(settings.TimeZone);
    }

    public RiskSettings Settings => _s;

    public static TimeZoneInfo ResolveTimeZone(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch { return TimeZoneInfo.Utc; }
    }

    /// <summary>Début (UTC) du jour courant dans le fuseau configuré.</summary>
    public DateTime DayStartUtc(DateTime nowUtc)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, _tz);
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local.Date, DateTimeKind.Unspecified), _tz);
    }

    /// <summary>Début (UTC) de la semaine courante (lundi) dans le fuseau configuré.</summary>
    public DateTime WeekStartUtc(DateTime nowUtc)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, _tz);
        var diff = ((int)local.DayOfWeek + 6) % 7;
        var monday = local.Date.AddDays(-diff);
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(monday, DateTimeKind.Unspecified), _tz);
    }

    /// <summary>
    /// Capital utilisable pour une nouvelle position : jamais plus que MaxTradingCapital,
    /// et toujours en laissant intactes la réserve et la marge de sécurité.
    /// </summary>
    public decimal AvailableForTrading(decimal cash, decimal exposure)
    {
        var byCap = _s.MaxTradingCapital - exposure;
        var byCash = cash - _s.ProtectedCapital;
        return Math.Max(0, Math.Min(byCap, byCash));
    }

    public RiskSnapshot Evaluate(
        DateTime nowUtc,
        decimal cash,
        IReadOnlyList<Position> openPositions,
        IReadOnlyList<Position> closedPositions,
        Func<string, decimal?> priceOf,
        IEnumerable<string>? externalBlocks = null)
    {
        var dayStart = DayStartUtc(nowUtc);
        var weekStart = WeekStartUtc(nowUtc);

        decimal exposure = 0, openRisk = 0, unrealized = 0, marketValue = 0;
        foreach (var p in openPositions)
        {
            var price = priceOf(p.Symbol) ?? p.EntryPrice;
            exposure += p.EntryCost;
            marketValue += p.Quantity * price;
            var u = p.UnrealizedPnl(price, _s.TakerFeeRate);
            unrealized += u;
            // risque restant : perte additionnelle si le stop est touché maintenant
            var lossAtStop = p.EntryCost - p.Quantity * p.StopLoss * (1 - _s.TakerFeeRate - _s.SlippageRate);
            openRisk += Math.Max(0, lossAtStop);
        }

        var realizedDay = closedPositions.Where(p => p.ExitTimeUtc >= dayStart).Sum(p => p.RealizedPnl);
        var realizedWeek = closedPositions.Where(p => p.ExitTimeUtc >= weekStart).Sum(p => p.RealizedPnl);
        var realizedTotal = closedPositions.Sum(p => p.RealizedPnl);
        var openLoss = Math.Min(0, unrealized); // seules les pertes latentes comptent dans les limites

        var dailyPnl = realizedDay + openLoss;
        var weeklyPnl = realizedWeek + openLoss;

        var reasons = new List<string>();
        if (externalBlocks is not null) reasons.AddRange(externalBlocks);
        if (-dailyPnl >= _s.MaxDailyLoss)
            reasons.Add($"Limite de perte quotidienne atteinte ({-dailyPnl:0.00} € / {_s.MaxDailyLoss:0.00} €).");
        if (-weeklyPnl >= _s.MaxWeeklyLoss)
            reasons.Add($"Limite de perte hebdomadaire atteinte ({-weeklyPnl:0.00} € / {_s.MaxWeeklyLoss:0.00} €).");
        if (openPositions.Count >= _s.MaxOpenPositions)
            reasons.Add($"Nombre maximal de positions ouvertes atteint ({openPositions.Count}/{_s.MaxOpenPositions}).");

        var available = AvailableForTrading(cash, exposure);
        if (available <= 0) reasons.Add("Aucun capital disponible hors réserve et marge de sécurité.");

        // Le risque d'une nouvelle position ne doit jamais faire dépasser les limites restantes.
        var remainingDay = _s.MaxDailyLoss + dailyPnl;
        var remainingWeek = _s.MaxWeeklyLoss + weeklyPnl;
        var budget = Math.Max(0, Math.Min(_s.RiskPerTrade, Math.Min(remainingDay, remainingWeek)));

        var equity = cash + marketValue * (1 - _s.TakerFeeRate);
        return new RiskSnapshot(
            Equity: equity,
            Cash: cash,
            AvailableForTrading: available,
            Exposure: exposure,
            OpenRisk: openRisk,
            DailyPnl: dailyPnl,
            WeeklyPnl: weeklyPnl,
            TotalPnl: realizedTotal + unrealized,
            DailyLossLimit: _s.MaxDailyLoss,
            WeeklyLossLimit: _s.MaxWeeklyLoss,
            OpenPositions: openPositions.Count,
            MaxOpenPositions: _s.MaxOpenPositions,
            CanOpenNewPosition: reasons.Count == 0,
            BlockingReasons: reasons,
            RiskBudget: budget);
    }
}
