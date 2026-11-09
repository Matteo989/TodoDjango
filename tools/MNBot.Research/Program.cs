// Banc de recherche : compare des stratégies sur l'historique long (Binance), avec frais réels,
// une période d'entraînement et une période de test jamais utilisée pour choisir.
// Usage : dotnet run --project tools/MNBot.Research -- [chemin de la base] [frais] [risque par trade]
using System.Globalization;
using MNBot.Api.Infrastructure;
using MNBot.Core.Backtesting;
using MNBot.Core.Domain;
using MNBot.Core.Risk;
using MNBot.Core.Strategies;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
var db = args.Length > 0 ? args[0] : "data/mnbot.db";
var fee = args.Length > 1 ? decimal.Parse(args[1], CultureInfo.InvariantCulture) : 0.001m;
var riskPerTrade = args.Length > 2 ? decimal.Parse(args[2], CultureInfo.InvariantCulture) : 0.5m;
var repo = new SqliteRepository(db);

var risk = new RiskSettings
{
    TakerFeeRate = fee, SlippageRate = 0.0005m, TimeZone = "Europe/Paris", RiskPerTrade = riskPerTrade,
    MaxDailyLoss = Math.Max(1.5m, riskPerTrade * 3), MaxWeeklyLoss = Math.Max(3m, riskPerTrade * 6),
};

InstrumentSpec Spec(string s) => s.StartsWith("BTC")
    ? new(s, s, "BTC", "Q", 0.00001m, 5m, 5, 2, 0.01m)
    : new(s, s, "ETH", "Q", 0.0001m, 5m, 4, 2, 0.01m);

var candidates = new List<IStrategy>
{
    new TrendPullbackStrategy(new TrendPullbackParameters(), "A-pullback-1h", "A · Pullback 1h/4h (actuelle)"),
    new TrendPullbackStrategy(new TrendPullbackParameters { EntryTimeframe = "4h", TrendTimeframe = "1d", StopAtrMultiplier = 2m }, "B-pullback-4h", "B · Pullback 4h/1j"),
    new TrendFollowingStrategy(new TrendFollowingParameters { Mode = "Breakout", Timeframe = "1d", EntryLookback = 20, ExitLookback = 10 }, "C-breakout-20", "C · Cassure 20j / sortie 10j"),
    new TrendFollowingStrategy(new TrendFollowingParameters { Mode = "Breakout", Timeframe = "1d", EntryLookback = 55, ExitLookback = 20, TrailingAtrMultiplier = 0 }, "D-breakout-55", "D · Cassure 55j / sortie 20j"),
    new TrendFollowingStrategy(new TrendFollowingParameters { Mode = "Breakout", Timeframe = "4h", EntryLookback = 20, ExitLookback = 10 }, "E-breakout-4h", "E · Cassure 20 bougies 4h"),
    new TrendFollowingStrategy(new TrendFollowingParameters { Mode = "EmaCross", Timeframe = "1d", EmaFast = 20, EmaSlow = 50, TrailingAtrMultiplier = 0 }, "F-ema-20-50", "F · Croisement EMA 20/50 (1j)"),
    new TrendFollowingStrategy(new TrendFollowingParameters { Mode = "EmaCross", Timeframe = "1d", EmaFast = 10, EmaSlow = 30, EmaTrend = 100, TrailingAtrMultiplier = 0 }, "G-ema-10-30", "G · Croisement EMA 10/30 (1j)"),
    new TrendFollowingStrategy(new TrendFollowingParameters { Mode = "Breakout", Timeframe = "1d", EntryLookback = 20, ExitLookback = 10, EmaTrend = 0 }, "H-breakout-nofilter", "H · Cassure 20j sans filtre"),
};

if (args.Length > 3 && args[3] == "sweep")
{
    candidates.Clear();
    foreach (var lb in new[] { 15, 20, 30 })
    foreach (var ex in new[] { 5, 10, 15 })
    foreach (var tr in new[] { 0m, 3m, 4m, 6m })
        candidates.Add(new TrendFollowingStrategy(new TrendFollowingParameters { Mode = "Breakout", Timeframe = "4h", EntryLookback = lb, ExitLookback = ex, TrailingAtrMultiplier = tr },
            $"E-{lb}-{ex}-{tr}", $"E {lb}/{ex} trail {tr}"));
}

var periods = new[]
{
    ("Entraînement 2018-2022 (USDT)", new[] { "BTC/USDT", "ETH/USDT" }, new DateTime(2018, 6, 1), new DateTime(2023, 1, 1)),
    ("Test 2023-2026 (USDT)", new[] { "BTC/USDT", "ETH/USDT" }, new DateTime(2023, 1, 1), new DateTime(2026, 11, 10)),
    ("Test 2023-2026 (EUR)", new[] { "BTC/EUR", "ETH/EUR" }, new DateTime(2023, 1, 1), new DateTime(2026, 11, 10)),
};

var cache = new Dictionary<(string, Timeframe), IReadOnlyList<Candle>>();
IReadOnlyList<Candle> Load(string symbol, Timeframe tf)
{
    if (cache.TryGetValue((symbol, tf), out var c)) return c;
    var h1 = repo.GetCandlesAsync("binance", symbol, Timeframe.H1).Result;
    c = tf == Timeframe.H1 ? h1 : CandleTools.Aggregate(h1, Timeframe.H1, tf);
    cache[(symbol, tf)] = c;
    return c;
}

Console.WriteLine($"Frais {fee:P2} par ordre + glissement 0,05 % + demi-spread 0,025 % · risque {riskPerTrade} par trade · capital 100");
foreach (var (label, symbols, from, to) in periods)
{
    Console.WriteLine();
    Console.WriteLine($"=== {label}");
    foreach (var s in symbols)
    {
        var d = Load(s, Timeframe.D1);
        var a = d.First(x => x.OpenTime >= from); var b = d.Last(x => x.OpenTime < to);
        Console.WriteLine($"    Achat-conservation {s} : {(b.Close / a.Open - 1):P0}");
    }
    Console.WriteLine($"{"Stratégie",-34}{"Trades",7}{"Réussite",9}{"PF",6}{"R moyen",9}{"Net",9}{"DD max",8}{"Frais",8}{"Refus",7}");
    var rows = candidates.AsParallel().Select(st =>
    {
        var markets = symbols.Select(s => new BacktestMarketData
        {
            Instrument = Spec(s), EntryCandles = Load(s, st.EntryTimeframe), TrendCandles = Load(s, st.TrendTimeframe),
        }).ToList();
        var r = new BacktestEngine().Run(st, markets, new BacktestOptions { Risk = risk, SpreadPct = 0.0005m, TradeFromUtc = from, TradeToUtc = to });
        return (st, r);
    }).ToList();
    foreach (var (st, r) in candidates.Select(c => rows.First(x => x.st == c)))
    {
        if (st.Id.StartsWith("E") && candidates.Count < 10)
            Console.WriteLine("      refus (exemples) : " + string.Join(" | ", r.RejectionSamples.Take(4)));
        var m = r.Metrics;
        Console.WriteLine($"{st.Name,-34}{m.Trades,7}{m.WinRate,9:P0}{(m.ProfitFactor >= 999 ? 0 : m.ProfitFactor),6:0.00}{m.AverageR,9:0.00}{m.NetProfit,9:+0.00;-0.00}{m.MaxDrawdown,8:0.00}{m.TotalFees,8:0.00}{m.SignalsRejectedByRisk,7}");
    }
    if (label.StartsWith("Test 2023-2026 (EUR)") && candidates.Count < 10)
    {
        Console.WriteLine();
        Console.WriteLine("    Détail par année (EUR) : résultat net");
        foreach (var st in candidates)
        {
            var line = $"    {st.Id,-22}";
            for (var y = 2023; y <= 2026; y++)
            {
                var markets = symbols.Select(s => new BacktestMarketData { Instrument = Spec(s), EntryCandles = Load(s, st.EntryTimeframe), TrendCandles = Load(s, st.TrendTimeframe) }).ToList();
                var r = new BacktestEngine().Run(st, markets, new BacktestOptions { Risk = risk, SpreadPct = 0.0005m, TradeFromUtc = new DateTime(y, 1, 1), TradeToUtc = new DateTime(y + 1, 1, 1) });
                line += $"  {y}: {r.Metrics.NetProfit,6:+0.00;-0.00} ({r.Metrics.Trades})";
            }
            Console.WriteLine(line);
        }
    }
}
