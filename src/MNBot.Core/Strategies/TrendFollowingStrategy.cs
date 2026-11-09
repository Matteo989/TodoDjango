using System.Globalization;
using MNBot.Core.Domain;
using MNBot.Core.Indicators;

namespace MNBot.Core.Strategies;

/// <summary>Paramètres des stratégies de suivi de tendance « lentes » (cassure de Donchian, croisement de moyennes).</summary>
public sealed class TrendFollowingParameters
{
    /// <summary>"Breakout" : achat sur cassure du plus haut des N dernières bougies. "EmaCross" : achat quand l'EMA rapide croise au-dessus de l'EMA lente.</summary>
    public string Mode { get; set; } = "Breakout";
    /// <summary>Unité de temps de décision ("4h" ou "1d").</summary>
    public string Timeframe { get; set; } = "1d";
    /// <summary>Breakout : nombre de bougies du canal d'entrée.</summary>
    public int EntryLookback { get; set; } = 20;
    /// <summary>Breakout : sortie si la clôture passe sous le plus bas des N dernières bougies.</summary>
    public int ExitLookback { get; set; } = 10;
    public int EmaFast { get; set; } = 20;
    public int EmaSlow { get; set; } = 50;
    /// <summary>Filtre de tendance de fond : clôture au-dessus de cette EMA (0 = pas de filtre).</summary>
    public int EmaTrend { get; set; } = 200;
    public int AtrPeriod { get; set; } = 14;
    /// <summary>Stop de protection initial (en ATR) : sert au calcul de la taille et protège contre une chute brutale.</summary>
    public decimal StopAtrMultiplier { get; set; } = 3.0m;
    /// <summary>Stop suiveur (en ATR) sous la plus haute clôture depuis l'entrée (0 = désactivé).</summary>
    public decimal TrailingAtrMultiplier { get; set; } = 4.0m;
    /// <summary>Objectif nominal (en R) utilisé seulement par les filtres de frais ; la sortie se fait par les règles de tendance.</summary>
    public decimal NominalRewardRisk { get; set; } = 3.0m;

    public TrendFollowingParameters Clone() => (TrendFollowingParameters)MemberwiseClone();
}

/// <summary>
/// Suivi de tendance long uniquement sur unité de temps longue (4h ou 1 jour).
/// Peu de transactions, des pertes petites et fréquentes, et quelques gains importants quand une tendance dure :
/// c'est ce profil qui supporte le mieux les frais sur un petit capital.
/// Les sorties se font sur les règles de tendance (clôture), le stop de protection reste actif en permanence.
/// </summary>
public sealed class TrendFollowingStrategy : IStrategy
{
    private readonly TrendFollowingParameters _p;

    public TrendFollowingStrategy(TrendFollowingParameters? parameters = null, string id = "trend-following", string? name = null)
    {
        _p = parameters ?? new TrendFollowingParameters();
        Id = id;
        Name = name ?? (_p.Mode == "EmaCross" ? $"Croisement EMA {_p.EmaFast}/{_p.EmaSlow} ({_p.Timeframe})" : $"Cassure {_p.EntryLookback} bougies ({_p.Timeframe})");
    }

    public string Id { get; }
    public string Name { get; }
    public string Description => _p.Mode == "EmaCross"
        ? $"Achat quand l'EMA{_p.EmaFast} croise au-dessus de l'EMA{_p.EmaSlow} avec le prix au-dessus de l'EMA{_p.EmaTrend} ; vente au croisement inverse ou sur stop suiveur."
        : $"Achat quand la clôture dépasse le plus haut des {_p.EntryLookback} dernières bougies (prix au-dessus de l'EMA{_p.EmaTrend}) ; vente sous le plus bas des {_p.ExitLookback} dernières bougies ou sur stop suiveur.";
    public Timeframe EntryTimeframe => TimeframeExtensions.Parse(_p.Timeframe);
    public Timeframe TrendTimeframe => EntryTimeframe;
    public int RequiredEntryCandles => Math.Max(Math.Max(_p.EmaTrend, _p.EmaSlow) + 20, _p.EntryLookback + 5);
    public int RequiredTrendCandles => 0;
    public object Parameters => _p;
    private int Window => Math.Max(_p.EmaTrend, _p.EmaSlow) * 3 + 50;

    public StrategyEvaluation Evaluate(StrategyContext ctx)
    {
        var all = ctx.EntryCandles;
        if (all.Count < RequiredEntryCandles)
            return StrategyEvaluation.NotEnoughData($"Historique {_p.Timeframe} insuffisant ({all.Count}/{RequiredEntryCandles} bougies).");
        var n = Math.Min(all.Count, Window);
        var c = new Candle[n];
        for (var k = 0; k < n; k++) c[k] = all[all.Count - n + k];

        var closes = c.Select(x => x.Close).ToArray();
        var atrArr = Ta.Atr(c.Select(x => x.High).ToArray(), c.Select(x => x.Low).ToArray(), closes, _p.AtrPeriod);
        var emaFast = Ta.Ema(closes, _p.EmaFast);
        var emaSlow = Ta.Ema(closes, _p.EmaSlow);
        var emaTrend = _p.EmaTrend > 0 ? Ta.Ema(closes, _p.EmaTrend) : null;
        var i = n - 1;
        var price = closes[i];
        var atr = atrArr[i];
        var trendLevel = emaTrend?[i];
        if (atr is null || emaFast[i] is null || emaSlow[i] is null || (emaTrend is not null && trendLevel is null))
            return StrategyEvaluation.NotEnoughData("Indicateurs pas encore disponibles.");

        var upper = Max(c, i - _p.EntryLookback, i - 1, x => x.High);
        var lower = Min(c, i - _p.ExitLookback, i - 1, x => x.Low);
        var indicators = new Dictionary<string, decimal?>
        {
            ["close"] = price, ["atr14"] = atr, ["emaFast"] = emaFast[i], ["emaSlow"] = emaSlow[i], ["emaTrend"] = trendLevel,
            ["channelHigh"] = upper, ["channelLow"] = lower,
        };
        var trendOk = trendLevel is null || price > trendLevel.Value;

        // ---- sortie
        if (ctx.OpenPosition is { } pos)
        {
            var reasons = new List<string>();
            if (_p.Mode == "EmaCross" && emaFast[i] < emaSlow[i]) reasons.Add($"EMA{_p.EmaFast} repassée sous l'EMA{_p.EmaSlow}");
            if (_p.Mode != "EmaCross" && price < lower) reasons.Add($"clôture sous le plus bas des {_p.ExitLookback} dernières bougies ({F(lower)})");
            if (_p.TrailingAtrMultiplier > 0)
            {
                var highest = pos.EntryPrice;
                for (var k = 0; k <= i; k++) if (c[k].OpenTime >= pos.EntryTimeUtc && c[k].Close > highest) highest = c[k].Close;
                var trail = highest - _p.TrailingAtrMultiplier * atr.Value;
                indicators["trailingStop"] = trail;
                if (price < trail) reasons.Add($"stop suiveur touché ({F(trail)})");
            }
            var checks = new List<SignalCheck> { new("Tendance intacte", reasons.Count == 0, reasons.Count == 0 ? "Aucune règle de sortie déclenchée" : string.Join(", ", reasons)) };
            return reasons.Count > 0
                ? new StrategyEvaluation(SignalAction.ExitLong, price, null, null, null, 0, checks, "Sortie : " + string.Join(", ", reasons) + ".", indicators)
                : new StrategyEvaluation(SignalAction.None, price, null, null, null, 0, checks, "Position ouverte : la tendance se poursuit.", indicators);
        }

        // ---- entrée
        List<SignalCheck> entryChecks;
        if (_p.Mode == "EmaCross")
        {
            var crossed = emaFast[i] > emaSlow[i] && emaFast[i - 1] <= emaSlow[i - 1];
            entryChecks = new()
            {
                new($"EMA{_p.EmaFast} croise au-dessus de l'EMA{_p.EmaSlow}", crossed, $"{F(emaFast[i - 1]!.Value)}/{F(emaSlow[i - 1]!.Value)} → {F(emaFast[i]!.Value)}/{F(emaSlow[i]!.Value)}"),
            };
        }
        else
        {
            entryChecks = new()
            {
                new($"Cassure du plus haut {_p.EntryLookback} bougies", price > upper, $"Clôture {F(price)} vs plus haut {F(upper)}"),
            };
        }
        entryChecks.Add(new("Tendance de fond haussière", trendOk, trendLevel is null ? "Filtre désactivé" : $"Clôture {F(price)} vs EMA{_p.EmaTrend} {F(trendLevel.Value)}"));
        entryChecks.Add(new("Bougie clôturée", true, $"Bougie {_p.Timeframe} de {c[i].OpenTime:yyyy-MM-dd HH:mm} UTC"));

        var stopDistance = _p.StopAtrMultiplier * atr.Value;
        var stop = price - stopDistance;
        var tp = price + _p.NominalRewardRisk * stopDistance;
        if (entryChecks.All(x => x.Passed))
            return new StrategyEvaluation(SignalAction.EnterLong, price, stopDistance, stop, tp, _p.NominalRewardRisk, entryChecks,
                "Signal d'achat : " + entryChecks[0].Name.ToLowerInvariant() + " en tendance haussière.", indicators);
        return new StrategyEvaluation(SignalAction.None, price, stopDistance, stop, tp, _p.NominalRewardRisk, entryChecks,
            "Pas de signal : " + string.Join(", ", entryChecks.Where(x => !x.Passed).Select(x => x.Name)) + ".", indicators);
    }

    private static decimal Max(Candle[] c, int from, int to, Func<Candle, decimal> f)
    {
        var m = decimal.MinValue;
        for (var k = Math.Max(0, from); k <= to; k++) m = Math.Max(m, f(c[k]));
        return m;
    }

    private static decimal Min(Candle[] c, int from, int to, Func<Candle, decimal> f)
    {
        var m = decimal.MaxValue;
        for (var k = Math.Max(0, from); k <= to; k++) m = Math.Min(m, f(c[k]));
        return m;
    }

    private static string F(decimal v) => Math.Round(v, 2).ToString(CultureInfo.InvariantCulture);
}
