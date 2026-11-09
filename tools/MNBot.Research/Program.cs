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

if (args.Length > 3 && args[3] == "portfolio") { RunPortfolio(repo); return; }
if (args.Length > 3 && args[3] == "assets") { RunAssets(repo); return; }

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

static void RunPortfolio(SqliteRepository repo)
{
    var universe = new[] { "BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "LTC", "LINK", "DOGE", "TRX" };
    // Principales cryptos de janvier 2018 (sans connaître l'avenir), y compris celles qui se sont effondrées depuis
    var universe2018 = new[] { "BTC", "ETH", "XRP", "BCH", "ADA", "LTC", "XLM", "NEO", "EOS", "IOTA", "TRX", "QTUM", "ETC", "BNB" };
    var all = universe.Concat(universe2018).Distinct().ToArray();
    var h1 = all.ToDictionary(u => u, u => repo.GetCandlesAsync("binance", u + "/USDT", Timeframe.H1).Result.ToList());
    var daily = h1.ToDictionary(kv => kv.Key, kv => CandleTools.Aggregate(kv.Value, Timeframe.H1, Timeframe.D1));
    Dictionary<string, List<Candle>> Sub(params string[] s) => s.ToDictionary(x => x, x => daily[x]);

    var periods = new[]
    {
        ("ENTRAÎNEMENT 2018-06 → 2022-12 (BTC −45 %, deux krachs)", new DateTime(2018, 6, 1), new DateTime(2023, 1, 1)),
        ("TEST 2023-01 → 2026-11", new DateTime(2023, 1, 1), new DateTime(2026, 11, 9)),
        ("TOUT 2018-06 → 2026-11", new DateTime(2018, 6, 1), new DateTime(2026, 11, 9)),
    };
    const decimal Alloc = 0.70m;

    foreach (var (label, from, to) in periods)
    {
        var results = new List<PortfolioLab.Result> { PortfolioLab.Savings(from, to) };
        PortfolioLab.Result W(string name, Dictionary<string, List<Candle>> data, Func<DateTime, Func<string, int>, Dictionary<string, decimal>> rule, decimal th = 0.05m) =>
            PortfolioLab.RunWeights(name, data, from, to, PortfolioLab.Rule(data, from, to, rule), th);

        // Références
        results.Add(W("Achat-conservation BTC (70 €)", Sub("BTC"), (d, ix) => new() { ["BTC"] = Alloc }, 0.5m));
        results.Add(W("Achat-conservation BTC+ETH (70 €)", Sub("BTC", "ETH"), (d, ix) => new() { ["BTC"] = Alloc / 2, ["ETH"] = Alloc / 2 }, 0.3m));

        // Filtre de tendance (« time-series momentum ») : investi quand le prix est au-dessus de sa moyenne
        foreach (var n in new[] { 50, 100, 200 })
            results.Add(W($"Tendance BTC (moyenne {n} j)", Sub("BTC"), (d, ix) =>
            {
                var i = ix("BTC"); var sma = PortfolioLab.SmaAt(daily["BTC"], i, n);
                return new() { ["BTC"] = sma is { } m && daily["BTC"][i].Close > m ? Alloc : 0 };
            }));
        results.Add(W("Tendance BTC+ETH (moyenne 100 j)", Sub("BTC", "ETH"), (d, ix) =>
        {
            var w = new Dictionary<string, decimal>();
            foreach (var s in new[] { "BTC", "ETH" })
            {
                var i = ix(s); var sma = PortfolioLab.SmaAt(daily[s], i, 100);
                w[s] = sma is { } m && daily[s][i].Close > m ? Alloc / 2 : 0;
            }
            return w;
        }));

        // Double momentum BTC/ETH : le plus fort des deux sur 30 j, s'il est en tendance
        results.Add(W("Double momentum BTC/ETH (30 j)", Sub("BTC", "ETH"), (d, ix) =>
        {
            var best = new[] { "BTC", "ETH" }.Select(s => (s, r: PortfolioLab.ReturnAt(daily[s], ix(s), 30), sma: PortfolioLab.SmaAt(daily[s], ix(s), 100)))
                .Where(x => x.r is not null && x.sma is not null && daily[x.s][ix(x.s)].Close > x.sma).OrderByDescending(x => x.r).FirstOrDefault();
            return best.s is null ? new() : new() { [best.s] = Alloc };
        }, 0.10m));

        // Rotation (momentum transversal) : chaque lundi, les N cryptos les plus fortes, uniquement si en tendance
        foreach (var (look, top, filter, uni, tag) in new[] {
            (30, 3, true, universe, "U26"), (14, 3, true, universe, "U26"), (60, 3, true, universe, "U26"), (30, 2, true, universe, "U26"), (30, 5, true, universe, "U26"), (30, 3, false, universe, "U26"),
            (30, 3, true, universe2018, "U18"), (14, 3, true, universe2018, "U18"), (60, 3, true, universe2018, "U18"), (30, 5, true, universe2018, "U18"), (30, 3, false, universe2018, "U18") })
        {
            Dictionary<string, decimal> current = new();
            var data = uni.ToDictionary(x => x, x => daily[x]);
            results.Add(W($"Rotation {tag} top {top} / {look} j{(filter ? "" : " sans filtre")}", data, (d, ix) =>
            {
                if (d.DayOfWeek != DayOfWeek.Monday) return current;
                var ranked = uni.Select(s => (s, i: ix(s))).Where(x => x.i >= 100)
                    .Select(x => (x.s, r: PortfolioLab.ReturnAt(daily[x.s], x.i, look), sma: PortfolioLab.SmaAt(daily[x.s], x.i, 100), close: daily[x.s][x.i].Close))
                    .Where(x => x.r is not null && (!filter || x.close > x.sma))
                    .OrderByDescending(x => x.r).Take(top).ToList();
                current = ranked.ToDictionary(x => x.s, _ => Alloc / top);
                return current;
            }, 0.10m));
        }

        // Robots populaires horaires
        results.Add(PortfolioLab.Grid("Grille BTC ±15 % / 20 niveaux", h1["BTC"], from, to));
        results.Add(PortfolioLab.Grid("Grille BTC ±8 % / 10 niveaux", h1["BTC"], from, to, rangePct: 0.08m, levels: 10));
        results.Add(PortfolioLab.Grid("Grille ETH ±15 % / 20 niveaux", h1["ETH"], from, to));
        results.Add(PortfolioLab.Grid("Grille BTC ±15 % sans vente forcée", h1["BTC"], from, to, sellOnDownExit: false));
        results.Add(PortfolioLab.Grid("Grille ETH ±15 % sans vente forcée", h1["ETH"], from, to, sellOnDownExit: false));
        results.Add(PortfolioLab.Dca("DCA type 3Commas BTC (TP 2 %)", h1["BTC"], from, to));
        results.Add(PortfolioLab.Dca("DCA type 3Commas ETH (TP 2 %)", h1["ETH"], from, to));
        results.Add(PortfolioLab.Dca("DCA type 3Commas DOGE (TP 2 %)", h1["DOGE"], from, to));

        Console.WriteLine();
        Console.WriteLine($"=== {label} — capital 100, 70 max investis, frais 0,175 % par ordre");
        Console.WriteLine($"{"Stratégie",-38}{"Final",9}{"Par an",9}{"Baisse max",12}{"Ordres",8}{"Investi",9}{"Frais",8}");
        foreach (var r in results)
            Console.WriteLine($"{r.Name,-38}{r.Final,9:0.0}{r.Cagr,9:P1}{-r.MaxDd,12:P0}{r.Orders,8}{r.InMarket,9:P0}{r.Fees,8:0.0}");
    }
}

static void RunAssets(SqliteRepository repo)
{
    var u26 = new[] { "BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "LTC", "LINK", "DOGE", "TRX" };
    var u18 = new[] { "BTC", "ETH", "XRP", "BCH", "ADA", "LTC", "XLM", "NEO", "EOS", "IOTA", "TRX", "QTUM", "ETC", "BNB" };
    var etfs = new[] { "SPY/USD", "QQQ/USD", "GLD/USD", "TLT/USD", "EEM/USD", "CW8/EUR", "IWDA/EUR" };
    var data = new Dictionary<string, List<Candle>>();
    foreach (var c in u26.Concat(u18).Distinct())
        data[c] = CandleTools.Aggregate(repo.GetCandlesAsync("binance", c + "/USDT", Timeframe.H1).Result, Timeframe.H1, Timeframe.D1);
    foreach (var e in etfs) data[e] = repo.GetCandlesAsync("yahoo", e, Timeframe.D1).Result.ToList();
    var dates = data.ToDictionary(kv => kv.Key, kv => kv.Value.Select(x => x.OpenTime).ToArray());
    // dernière bougie clôturée à la date d (week-ends et jours fériés pour les ETF)
    int At(string s, DateTime d) { var i = Array.BinarySearch(dates[s], d); return i >= 0 ? i : ~i - 1; }
    bool Up(string s, DateTime d, int n) { var i = At(s, d); var m = PortfolioLab.SmaAt(data[s], i, n); return m is { } v && i >= 0 && data[s][i].Close > v; }
    Dictionary<string, List<Candle>> Sub(IEnumerable<string> s) => s.ToDictionary(x => x, x => data[x]);
    const decimal A = 0.70m;

    Dictionary<string, decimal> TrendBasket(IEnumerable<string> names, DateTime d, int n, decimal budget)
    {
        var listed = names.Where(s => At(s, d) >= n).ToList();
        if (listed.Count == 0) return new();
        return listed.ToDictionary(s => s, s => Up(s, d, n) ? budget / listed.Count : 0m);
    }

    var periods = new[]
    {
        ("ENTRAÎNEMENT 2018-06 → 2022-12", new DateTime(2018, 6, 1), new DateTime(2023, 1, 1)),
        ("TEST 2023-01 → 2026-11", new DateTime(2023, 1, 1), new DateTime(2026, 11, 7)),
        ("TOUT 2018-06 → 2026-11", new DateTime(2018, 6, 1), new DateTime(2026, 11, 7)),
    };
    foreach (var (label, from, to) in periods)
    {
        var res = new List<PortfolioLab.Result> { PortfolioLab.Savings(from, to) };
        PortfolioLab.Result W(string name, IEnumerable<string> syms, Func<DateTime, Dictionary<string, decimal>> rule, decimal th = 0.05m)
        {
            var sub = Sub(syms);
            return PortfolioLab.RunWeights(name, sub, from, to, PortfolioLab.Rule(sub, from, to, (d, _) => rule(d)), th);
        }

        // ---- Crypto
        res.Add(W("Tendance BTC seul (100 j)", new[] { "BTC" }, d => TrendBasket(new[] { "BTC" }, d, 100, A)));
        res.Add(W("Tendance panier U26 (10 cryptos, 100 j)", u26, d => TrendBasket(u26, d, 100, A)));
        res.Add(W("Tendance panier U18 (14 cryptos, 100 j)", u18, d => TrendBasket(u18, d, 100, A)));
        res.Add(W("Tendance panier U18 (14 cryptos, 50 j)", u18, d => TrendBasket(u18, d, 50, A)));
        var top6 = new[] { "BTC", "ETH", "XRP", "BNB", "ADA", "LTC" }; // présentes dans le top en 2018 ET en 2026
        res.Add(W("Tendance 6 grandes cryptos (100 j)", top6, d => TrendBasket(top6, d, 100, A)));
        // BTC filtre de marché : les altcoins ne sont achetés que si BTC est lui-même en tendance
        res.Add(W("Panier U18 si BTC en tendance (100 j)", u18, d => Up("BTC", d, 100) ? TrendBasket(u18, d, 100, A) : new()));

        // ---- Actions / ETF
        res.Add(W("Achat-conservation S&P 500 (SPY)", new[] { "SPY/USD" }, d => new() { ["SPY/USD"] = A }, 0.5m));
        res.Add(W("Achat-conservation MSCI World € (CW8)", new[] { "CW8/EUR" }, d => new() { ["CW8/EUR"] = A }, 0.5m));
        res.Add(W("Tendance S&P 500 (200 j)", new[] { "SPY/USD" }, d => TrendBasket(new[] { "SPY/USD" }, d, 200, A)));
        res.Add(W("Tendance Nasdaq (200 j)", new[] { "QQQ/USD" }, d => TrendBasket(new[] { "QQQ/USD" }, d, 200, A)));
        var gtaa = new[] { "SPY/USD", "QQQ/USD", "EEM/USD", "GLD/USD", "TLT/USD" };
        res.Add(W("Multi-actifs ETF + or + oblig. (200 j)", gtaa, d => TrendBasket(gtaa, d, 200, A)));
        res.Add(W("Achat-conservation multi-actifs", gtaa, d => gtaa.ToDictionary(s => s, _ => A / gtaa.Length), 0.1m));
        res.Add(W("Mix : tendance BTC / or (moitié-moitié)", new[] { "BTC", "GLD/USD" }, d =>
        {
            var w = TrendBasket(new[] { "BTC" }, d, 100, A / 2);
            foreach (var kv in TrendBasket(new[] { "GLD/USD" }, d, 200, A / 2)) w[kv.Key] = kv.Value;
            return w;
        }));

        // ---- Mélange crypto + actifs classiques
        var mix = new[] { "BTC", "ETH" }.Concat(gtaa).ToArray();
        res.Add(W("Mix : tendance BTC+ETH 50 % / multi-actifs 50 %", mix, d =>
        {
            var w = TrendBasket(new[] { "BTC", "ETH" }, d, 100, A / 2);
            foreach (var kv in TrendBasket(gtaa, d, 200, A / 2)) w[kv.Key] = kv.Value;
            return w;
        }));
        var mix2 = new[] { "BTC" }.Concat(new[] { "SPY/USD", "GLD/USD" }).ToArray();
        res.Add(W("Mix : tendance BTC / S&P 500 / or (1/3 chacun)", mix2, d =>
        {
            var w = TrendBasket(new[] { "BTC" }, d, 100, A / 3);
            foreach (var kv in TrendBasket(new[] { "SPY/USD", "GLD/USD" }, d, 200, A * 2 / 3)) w[kv.Key] = kv.Value;
            return w;
        }));

        Console.WriteLine();
        Console.WriteLine($"=== {label} — capital 100, 70 max investis, coûts 0,175 % par ordre (cours ajustés des dividendes)");
        Console.WriteLine($"{"Stratégie",-48}{"Final",8}{"Par an",9}{"Baisse max",12}{"Ordres",8}{"Investi",9}");
        foreach (var r in res)
            Console.WriteLine($"{r.Name,-48}{r.Final,8:0.0}{r.Cagr,9:P1}{-r.MaxDd,12:P0}{r.Orders,8}{r.InMarket,9:P0}");
    }
}
