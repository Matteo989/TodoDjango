using System.Diagnostics;
using System.Text.Json;
using MNBot.Api.Infrastructure;
using MNBot.Core.Abstractions;
using MNBot.Core.Backtesting;
using MNBot.Core.Domain;
using MNBot.Core.Engine;
using MNBot.Core.Risk;
using MNBot.Core.Strategies;

namespace MNBot.Api.Services;

public sealed class BacktestRequest
{
    public List<string>? Symbols { get; set; }
    /// <summary>"auto" (la source avec le plus d'historique), "kraken" ou "binance".</summary>
    public string Source { get; set; } = "auto";
    /// <summary>Stratégies / variantes à comparer (toutes par défaut).</summary>
    public List<string>? StrategyIds { get; set; }
    /// <summary>Limiter aux N derniers jours (null = tout l'historique disponible).</summary>
    public int? Days { get; set; }
    public decimal? TrainRatio { get; set; }
}

public sealed record StrategyComparison(
    string StrategyId,
    string StrategyName,
    object Parameters,
    BacktestResult Train,
    BacktestResult Validation);

public sealed record BacktestReport(
    long Id,
    DateTime CreatedUtc,
    string Source,
    IReadOnlyList<string> Symbols,
    DateTime DataFrom,
    DateTime DataTo,
    DateTime SplitTime,
    decimal TrainRatio,
    decimal SpreadPct,
    RiskSettings Risk,
    double DurationSeconds,
    IReadOnlyList<StrategyComparison> Strategies,
    IReadOnlyList<string> Notes);

/// <summary>
/// Backtesting avec séparation chronologique entraînement / validation (pas de mélange des périodes),
/// pour mesurer si une variante choisie sur le passé tient sur des données qu'elle n'a pas « vues ».
/// </summary>
public sealed class BacktestService
{
    private readonly SqliteRepository _repo;
    private readonly IMarketDataProvider _md;
    private readonly StrategyRegistry _registry;
    private readonly RiskSettings _risk;
    private readonly BacktestSettings _settings;
    private readonly BotSettings _bot;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public BacktestService(SqliteRepository repo, IMarketDataProvider md, StrategyRegistry registry, RiskSettings risk, BacktestSettings settings, BotSettings bot)
    {
        _repo = repo; _md = md; _registry = registry; _risk = risk; _settings = settings; _bot = bot;
    }

    public bool IsRunning => _gate.CurrentCount == 0;

    public async Task<BacktestReport> RunAsync(BacktestRequest req, CancellationToken ct)
    {
        if (!await _gate.WaitAsync(0, ct)) throw new InvalidOperationException("Un backtest est déjà en cours.");
        try
        {
            var sw = Stopwatch.StartNew();
            var symbols = req.Symbols is { Count: > 0 } ? req.Symbols : _bot.Symbols;
            var source = req.Source.ToLowerInvariant();
            if (source == "auto") source = PickSource(symbols);
            var trainRatio = Math.Clamp(req.TrainRatio ?? _settings.TrainRatio, 0.3m, 0.9m);
            var notes = new List<string>();

            var markets = new List<BacktestMarketData>();
            foreach (var symbol in symbols)
            {
                var from = req.Days is { } d ? DateTime.UtcNow.AddDays(-d - 60) : (DateTime?)null; // +60 jours de préchauffage des indicateurs
                var h1 = await _repo.GetCandlesAsync(source, symbol, Timeframe.H1, from);
                if (h1.Count < 300) throw new InvalidOperationException($"Historique insuffisant pour {symbol} (source {source} : {h1.Count} bougies 1h). Importez d'abord l'historique.");
                var stored4h = await _repo.GetCandlesAsync(source, symbol, Timeframe.H4);
                IReadOnlyList<Candle> h4 = stored4h.Count >= 250 && source == TradingEngine.SourceName
                    ? stored4h
                    : CandleTools.Aggregate(h1, Timeframe.H1, Timeframe.H4);
                var gaps = CountGaps(h1);
                if (gaps > 0) notes.Add($"{symbol} : {gaps} trou(s) dans les données 1h (bougies manquantes).");
                markets.Add(new BacktestMarketData { Instrument = await _md.GetInstrumentAsync(symbol, ct), EntryCandles = h1, TrendCandles = h4 });
            }

            var dataFrom = markets.Max(m => m.EntryCandles[0].OpenTime);
            var dataTo = markets.Min(m => m.EntryCandles[^1].OpenTime);
            // Les 30 premiers jours servent uniquement au préchauffage des indicateurs
            var tradableFrom = dataFrom.AddDays(30);
            if (req.Days is { } days) tradableFrom = Max(tradableFrom, DateTime.UtcNow.AddDays(-days));
            if (tradableFrom >= dataTo) throw new InvalidOperationException("Période trop courte après préchauffage des indicateurs.");
            var split = tradableFrom + TimeSpan.FromTicks((long)((dataTo - tradableFrom).Ticks * (double)trainRatio));

            var defs = _registry.Definitions.Where(x => req.StrategyIds is null || req.StrategyIds.Count == 0 || req.StrategyIds.Contains(x.Id)).ToList();
            var engine = new BacktestEngine();
            var comparisons = new List<StrategyComparison>();
            await Task.Run(() =>
            {
                Parallel.ForEach(defs, new ParallelOptions { CancellationToken = ct, MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) }, def =>
                {
                    var strategy = StrategyFactory.Create(def);
                    var train = engine.Run(strategy, markets, new BacktestOptions { Risk = _risk, SpreadPct = _settings.SpreadPct, TradeFromUtc = tradableFrom, TradeToUtc = split });
                    var valid = engine.Run(strategy, markets, new BacktestOptions { Risk = _risk, SpreadPct = _settings.SpreadPct, TradeFromUtc = split, TradeToUtc = dataTo.AddHours(1) });
                    lock (comparisons) comparisons.Add(new StrategyComparison(def.Id, def.Name, def.Parameters, train, valid));
                });
            }, ct);
            comparisons = defs.Select(d => comparisons.First(c => c.StrategyId == d.Id)).ToList();

            if (source == "binance") notes.Add("Données Binance (BTC/EUR, ETH/EUR) : proches de Kraken mais pas identiques. Les résultats sont indicatifs.");
            notes.Add("Biais du survivant : seuls BTC et ETH sont testés, deux actifs qui ont survécu et dominé le marché ; les résultats ne se généralisent pas à d'autres cryptomonnaies.");
            notes.Add("Aucun résultat passé ne garantit les résultats futurs. Une variante n'est crédible que si elle reste positive sur la période de validation.");
            if (comparisons.All(c => c.Train.Metrics.Trades + c.Validation.Metrics.Trades < 30))
                notes.Add("Moins de 30 transactions par variante : échantillon statistiquement faible.");

            var report = new BacktestReport(0, DateTime.UtcNow, source, symbols, tradableFrom, dataTo, split, trainRatio, _settings.SpreadPct, _risk,
                sw.Elapsed.TotalSeconds, comparisons, notes);
            var best = comparisons.OrderByDescending(c => c.Validation.Metrics.NetProfit).First();
            var summary = $"{string.Join("+", symbols)} · {source} · {tradableFrom:dd/MM/yy}→{dataTo:dd/MM/yy} · {comparisons.Count} variante(s) · meilleure en validation : {best.StrategyName} ({best.Validation.Metrics.NetProfit:+0.00;-0.00} €)";
            var id = _repo.InsertBacktest(summary, "{}");
            report = report with { Id = id };
            _repo.UpdateBacktestPayload(id, JsonSerializer.Serialize(report, EventHub.JsonOptions));
            return report;
        }
        finally { _gate.Release(); }
    }

    private string PickSource(IReadOnlyList<string> symbols)
    {
        var inv = _repo.GetCandleInventory();
        long Count(string src) => symbols.Select(s => inv.Where(i => i.Source == src && i.Symbol == s && i.Tf == 60).Sum(i => i.Count)).DefaultIfEmpty(0).Min();
        return Count("binance") > Count(TradingEngine.SourceName) ? "binance" : TradingEngine.SourceName;
    }

    private static int CountGaps(IReadOnlyList<Candle> c)
    {
        var gaps = 0;
        for (var i = 1; i < c.Count; i++) if (c[i].OpenTime - c[i - 1].OpenTime > TimeSpan.FromHours(1)) gaps++;
        return gaps;
    }

    private static DateTime Max(DateTime a, DateTime b) => a > b ? a : b;
}
