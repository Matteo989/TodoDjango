using System.Globalization;
using MNBot.Core.Domain;
using MNBot.Core.Indicators;

namespace MNBot.Core.Strategies;

/// <summary>Paramètres de la stratégie Trend Following + Pullback (modifiables dans config/mnbot.json).</summary>
public sealed class TrendPullbackParameters
{
    public int EmaFast { get; set; } = 20;
    public int EmaSlow { get; set; } = 50;
    public int EmaTrend { get; set; } = 200;
    public int RsiPeriod { get; set; } = 14;
    public decimal RsiThreshold { get; set; } = 50m;
    /// <summary>Nombre de bougies dans lesquelles le RSI doit avoir été sous le seuil avant de repasser au-dessus (1 = croisement sur la dernière bougie).</summary>
    public int RsiCrossLookback { get; set; } = 1;
    public int AtrPeriod { get; set; } = 14;
    public int VolumePeriod { get; set; } = 20;
    /// <summary>Le volume de la bougie de signal doit être ≥ multiplicateur × moyenne des volumes précédents.</summary>
    public decimal VolumeMultiplier { get; set; } = 1.0m;
    public bool RequireVolumeConfirmation { get; set; } = true;
    /// <summary>Nombre de bougies 1h examinées pour détecter le retour vers l'EMA20.</summary>
    public int PullbackLookback { get; set; } = 5;
    /// <summary>Tolérance (en %) au-dessus de l'EMA20 pour considérer que le prix l'a « touchée ».</summary>
    public decimal PullbackTolerancePct { get; set; } = 0.2m;
    public decimal StopAtrMultiplier { get; set; } = 1.5m;
    public decimal RewardRiskRatio { get; set; } = 2.0m;
    /// <summary>Sortie anticipée si la tendance se casse (EMA20 &lt; EMA50 en 1h ou clôture 4h sous l'EMA200).</summary>
    public bool ExitOnTrendBreak { get; set; } = true;

    public TrendPullbackParameters Clone() => (TrendPullbackParameters)MemberwiseClone();
}

/// <summary>
/// Stratégie Trend Following + Pullback, long uniquement (Spot).
///
/// Achat (toutes conditions requises, évaluées à la clôture d'une bougie 1h) :
///  1. Clôture 4h &gt; EMA200 (4h)                         → tendance de fond haussière
///  2. EMA20 &gt; EMA50 (1h)                                → tendance court terme haussière
///  3. Une des N dernières bougies 1h a touché l'EMA20     → repli (pullback)
///  4. RSI14 repasse au-dessus de 50                       → reprise du momentum
///  5. Volume ≥ moyenne des 20 derniers volumes            → confirmation
///  6. Clôture au-dessus de l'EMA20                        → le prix a repris sa tendance
///
/// Vente (règles symétriques pour une position Spot) :
///  - Stop-loss à 1,5 ATR sous le prix d'entrée, take-profit à 2 × le risque (gérés par le moteur en temps réel)
///  - Sortie anticipée si EMA20 repasse sous EMA50 (1h) ou si la clôture 4h repasse sous l'EMA200.
/// </summary>
public sealed class TrendPullbackStrategy : IStrategy
{
    private readonly TrendPullbackParameters _p;

    public TrendPullbackStrategy(TrendPullbackParameters? parameters = null, string id = "trend-pullback", string? name = null)
    {
        _p = parameters ?? new TrendPullbackParameters();
        Id = id;
        Name = name ?? "Trend Following + Pullback";
    }

    public string Id { get; }
    public string Name { get; }
    public string Description =>
        "Achat en tendance haussière (4h au-dessus de l'EMA200, EMA20>EMA50 en 1h) après un repli vers l'EMA20, " +
        "quand le RSI repasse au-dessus de 50 avec un volume confirmé. Stop 1,5 ATR, objectif 2R.";
    public Timeframe EntryTimeframe => Timeframe.H1;
    public Timeframe TrendTimeframe => Timeframe.H4;
    public int RequiredEntryCandles => Math.Max(_p.EmaSlow * 3, Math.Max(_p.VolumePeriod, _p.AtrPeriod) + 10);
    public int RequiredTrendCandles => _p.EmaTrend + 50;
    public object Parameters => _p;
    public TrendPullbackParameters Params => _p;

    /// <summary>Taille de la fenêtre glissante utilisée pour les calculs (identique en réel et en backtest).</summary>
    public int EntryWindow => RequiredEntryCandles + 50;
    public int TrendWindow => _p.EmaTrend * 2 + 50;

    public StrategyEvaluation Evaluate(StrategyContext ctx)
    {
        var entry = Tail(ctx.EntryCandles, EntryWindow);
        var trend = Tail(ctx.TrendCandles, TrendWindow);
        if (entry.Count < RequiredEntryCandles)
            return StrategyEvaluation.NotEnoughData($"Historique 1h insuffisant ({entry.Count}/{RequiredEntryCandles} bougies).");
        if (trend.Count < RequiredTrendCandles)
            return StrategyEvaluation.NotEnoughData($"Historique 4h insuffisant ({trend.Count}/{RequiredTrendCandles} bougies).");

        var closes = entry.Select(c => c.Close).ToArray();
        var highs = entry.Select(c => c.High).ToArray();
        var lows = entry.Select(c => c.Low).ToArray();
        var vols = entry.Select(c => c.Volume).ToArray();
        var emaFast = Ta.Ema(closes, _p.EmaFast);
        var emaSlow = Ta.Ema(closes, _p.EmaSlow);
        var rsi = Ta.Rsi(closes, _p.RsiPeriod);
        var atr = Ta.Atr(highs, lows, closes, _p.AtrPeriod);
        var volSma = Ta.Sma(vols, _p.VolumePeriod);

        var trendCloses = trend.Select(c => c.Close).ToArray();
        var emaTrend = Ta.Ema(trendCloses, _p.EmaTrend);

        var i = entry.Count - 1;
        var t = trend.Count - 1;
        var last = entry[i];
        var price = last.Close;

        var e20 = emaFast[i]; var e50 = emaSlow[i]; var r = rsi[i]; var a = atr[i];
        var avgVol = i > 0 ? volSma[i - 1] : null;
        var e200 = emaTrend[t];
        var trendClose = trend[t].Close;

        var indicators = new Dictionary<string, decimal?>
        {
            ["close"] = price,
            ["ema20"] = e20,
            ["ema50"] = e50,
            ["rsi14"] = r,
            ["atr14"] = a,
            ["volume"] = last.Volume,
            ["volumeAvg20"] = avgVol,
            ["close4h"] = trendClose,
            ["ema200_4h"] = e200,
        };

        if (e20 is null || e50 is null || r is null || a is null || e200 is null)
            return StrategyEvaluation.NotEnoughData("Indicateurs pas encore disponibles.");

        var trend4hUp = trendClose > e200.Value;
        var trend1hUp = e20.Value > e50.Value;

        // ---- Position ouverte : règles de sortie anticipée ----
        if (ctx.OpenPosition is not null)
        {
            var exitChecks = new List<SignalCheck>
            {
                new("Tendance 4h intacte", trend4hUp, $"Clôture 4h {F(trendClose)} vs EMA200 {F(e200.Value)}"),
                new("EMA20 > EMA50 (1h)", trend1hUp, $"EMA20 {F(e20.Value)} vs EMA50 {F(e50.Value)}"),
            };
            if (_p.ExitOnTrendBreak && (!trend4hUp || !trend1hUp))
            {
                var why = !trend4hUp ? "la clôture 4h est repassée sous l'EMA200" : "l'EMA20 est repassée sous l'EMA50 en 1h";
                return new StrategyEvaluation(SignalAction.ExitLong, price, null, null, null, 0, exitChecks,
                    $"Sortie anticipée : {why}.", indicators);
            }
            return new StrategyEvaluation(SignalAction.None, price, null, null, null, 0, exitChecks,
                "Position ouverte : tendance intacte, on laisse courir jusqu'au stop ou à l'objectif.", indicators);
        }

        // ---- Pas de position : conditions d'achat ----
        var tol = 1 + _p.PullbackTolerancePct / 100m;
        var pullbackFound = false;
        var pullbackDetail = "Aucun contact avec l'EMA20 récemment";
        for (var k = Math.Max(0, i - _p.PullbackLookback + 1); k <= i; k++)
        {
            if (emaFast[k] is { } ef && lows[k] <= ef * tol)
            {
                pullbackFound = true;
                pullbackDetail = $"Plus bas {F(lows[k])} ≤ EMA20 {F(ef)} (+{_p.PullbackTolerancePct}%) il y a {i - k} bougie(s)";
                break;
            }
        }

        var rsiWasBelow = false;
        for (var k = Math.Max(0, i - _p.RsiCrossLookback); k < i; k++)
            if (rsi[k] is { } rv && rv <= _p.RsiThreshold) rsiWasBelow = true;
        var rsiCross = r.Value > _p.RsiThreshold && rsiWasBelow;
        var prevRsi = i > 0 ? rsi[i - 1] : null;

        var volOk = !_p.RequireVolumeConfirmation || (avgVol is { } av && last.Volume >= av * _p.VolumeMultiplier);
        var closeAbove = price > e20.Value;

        var checks = new List<SignalCheck>
        {
            new("Prix > EMA200 (4h)", trend4hUp, $"Clôture 4h {F(trendClose)} vs EMA200 {F(e200.Value)}"),
            new("EMA20 > EMA50 (1h)", trend1hUp, $"EMA20 {F(e20.Value)} vs EMA50 {F(e50.Value)}"),
            new("Retour vers l'EMA20", pullbackFound, pullbackDetail),
            new("RSI repasse au-dessus de 50", rsiCross, $"RSI {F(prevRsi ?? 0, 1)} → {F(r.Value, 1)}"),
            new("Volume confirmé", volOk, _p.RequireVolumeConfirmation
                ? $"Volume {F(last.Volume, 4)} vs moyenne {F(avgVol ?? 0, 4)} × {_p.VolumeMultiplier}"
                : "Filtre volume désactivé"),
            new("Clôture au-dessus de l'EMA20", closeAbove, $"Clôture {F(price)} vs EMA20 {F(e20.Value)}"),
            new("Bougie clôturée", true, $"Bougie 1h de {last.OpenTime:yyyy-MM-dd HH:mm} UTC"),
        };

        var stopDistance = _p.StopAtrMultiplier * a.Value;
        var stop = price - stopDistance;
        var tp = price + _p.RewardRiskRatio * stopDistance;

        if (checks.All(c => c.Passed))
        {
            return new StrategyEvaluation(SignalAction.EnterLong, price, stopDistance, stop, tp, _p.RewardRiskRatio, checks,
                $"Signal d'achat : tendance haussière 4h et 1h, repli vers l'EMA20 puis reprise (RSI {F(r.Value, 1)}).",
                indicators);
        }

        var failed = checks.Where(c => !c.Passed).Select(c => c.Name);
        return new StrategyEvaluation(SignalAction.None, price, stopDistance, stop, tp, _p.RewardRiskRatio, checks,
            "Pas de signal : " + string.Join(", ", failed) + ".", indicators);
    }

    private static IReadOnlyList<Candle> Tail(IReadOnlyList<Candle> list, int n)
    {
        if (list.Count <= n) return list;
        var arr = new Candle[n];
        for (var k = 0; k < n; k++) arr[k] = list[list.Count - n + k];
        return arr;
    }

    private static string F(decimal v, int decimals = 2) => Math.Round(v, decimals).ToString(CultureInfo.InvariantCulture);
}
