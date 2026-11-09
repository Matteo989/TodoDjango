using Microsoft.Extensions.Logging.Abstractions;
using MNBot.Api.Infrastructure;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;
using MNBot.Core.Engine;
using MNBot.Core.Execution;
using MNBot.Core.Risk;
using MNBot.Core.Strategies;

namespace MNBot.Tests;

public sealed class EngineTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "mnbot-tests-" + Guid.NewGuid().ToString("N"));
    private readonly FakeClock _clock = new(new DateTime(2026, 3, 4, 10, 2, 0, DateTimeKind.Utc));
    private readonly FakeMarket _market;

    public EngineTests()
    {
        Directory.CreateDirectory(_dir);
        _market = new FakeMarket(_clock);
    }

    public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    private static RiskSettings Risk() => new() { TakerFeeRate = 0.001m, SlippageRate = 0, MaxFeeShareOfReward = 1, MinNetRewardRisk = 0.5m, TimeZone = "UTC" };

    private (TradingEngine Engine, SqliteRepository Repo, IExecutionVenue Venue) Build(IStrategy strategy, IExecutionVenue? venue = null, bool autoStart = true)
    {
        var repo = new SqliteRepository(Path.Combine(_dir, $"db-{Guid.NewGuid():N}.db"));
        var risk = Risk();
        venue ??= new PaperExecutionVenue(risk.TakerFeeRate, risk.SlippageRate, _clock);
        var registry = new StrategyRegistry(Array.Empty<StrategyDefinition>());
        registry.Register(strategy, true);
        var bot = new BotSettings { Symbols = new() { "ETH/EUR" }, AutoStartPaper = autoStart, CandleRefreshSeconds = 0 };
        var engine = new TradingEngine(bot, risk, _market, venue, repo, registry, NullEventSink.Instance, _clock, NullLogger.Instance);
        return (engine, repo, venue);
    }

    [Fact]
    public async Task Signal_OpensPaperPosition_ThenStopLossClosesIt()
    {
        var (engine, repo, _) = Build(new BuyOnceStrategy());
        await engine.TickAsync(default);

        var open = Assert.Single(engine.OpenPositions);
        Assert.Equal(TradingMode.Paper, open.Mode);
        Assert.Equal(1801m, Math.Round(open.StopLoss)); // entrée = ask 1901 − distance 100
        Assert.True(open.InitialRisk <= 0.51m);

        // Le prix chute sous le stop
        _market.SetPrice(1700m);
        _clock.Advance(TimeSpan.FromSeconds(10));
        await engine.TickAsync(default);

        Assert.Empty(engine.OpenPositions);
        var closed = Assert.Single(await repo.GetClosedPositionsAsync(TradingMode.Paper));
        Assert.StartsWith("Stop-loss", closed.ExitReason);
        Assert.True(closed.RealizedPnl < 0);
        Assert.NotEmpty(repo.GetAlerts(50));
    }

    [Fact]
    public async Task SameCandle_NeverTriggersTwoOrders()
    {
        var (engine, repo, _) = Build(new AlwaysBuyStrategy());
        await engine.TickAsync(default);
        Assert.Single(engine.OpenPositions);
        await engine.CloseManuallyAsync(engine.OpenPositions[0].Id, "test");
        _clock.Advance(TimeSpan.FromSeconds(10));
        await engine.TickAsync(default); // même bougie : pas de nouvelle évaluation, donc pas de nouvel achat
        Assert.Empty(engine.OpenPositions);
        Assert.Single(repo.GetOrders(10).Where(o => ((IDictionary<string, object>)o)["side"].ToString() == "Buy"));
    }

    [Fact]
    public async Task StoppedEngine_IgnoresEntrySignals()
    {
        var (engine, repo, _) = Build(new BuyOnceStrategy(), autoStart: false);
        await engine.TickAsync(default);
        Assert.Equal(EngineStatus.Stopped, engine.Status);
        Assert.Empty(engine.OpenPositions);
        var s = (await repo.GetSignalsAsync(5)).First();
        Assert.Contains("moteur arrêté", s.Outcome);
    }

    [Fact]
    public async Task EmergencyStop_ClosesPositions_AndPersists()
    {
        var (engine, repo, _) = Build(new BuyOnceStrategy());
        await engine.TickAsync(default);
        Assert.Single(engine.OpenPositions);
        await engine.EmergencyStopAsync("test");
        Assert.Empty(engine.OpenPositions);
        Assert.Equal(EngineStatus.EmergencyStopped, engine.Status);
        Assert.Equal("1", await repo.GetStateAsync("emergency_stop"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => engine.StartAsync("test"));
    }

    [Fact]
    public async Task LiveMode_RefusesOrdersUntilManuallyConfirmed()
    {
        var risk = Risk();
        var live = new FakeLiveVenue(new PaperExecutionVenue(risk.TakerFeeRate, 0, _clock));
        var (engine, repo, _) = Build(new BuyOnceStrategy(), live);
        await engine.TickAsync(default);
        Assert.Equal(EngineStatus.Stopped, engine.Status); // le réel ne démarre jamais tout seul
        await engine.StartAsync("test");
        _market.NextCandle();
        _clock.Advance(TimeSpan.FromHours(1));
        await engine.TickAsync(default);
        Assert.Empty(engine.OpenPositions);
        Assert.Equal(0, live.Orders);
        var s = (await repo.GetSignalsAsync(1)).First();
        Assert.Contains("non confirmé", s.Outcome);
    }

    [Fact]
    public async Task DailyLossLimit_SuspendsNewTrades()
    {
        var (engine, repo, _) = Build(new AlwaysBuyStrategy());
        // Trois pertes simulées d'environ 0,5 € la même journée
        for (var i = 0; i < 3; i++)
        {
            await repo.InsertPositionAsync(new Position
            {
                Symbol = "ETH/EUR", StrategyId = "x", Mode = TradingMode.Paper, Status = PositionStatus.Closed, Quantity = 1,
                EntryPrice = 100, ExitPrice = 99.5m, EntryTimeUtc = _clock.UtcNow.AddHours(-2), ExitTimeUtc = _clock.UtcNow.AddHours(-1), EntryOrderId = $"o{i}",
            });
        }
        await engine.TickAsync(default);
        Assert.Empty(engine.OpenPositions);
        var s = (await repo.GetSignalsAsync(1)).First();
        Assert.Contains("quotidienne", s.Outcome);
    }

    // ------------------------------------------------------------------ doubles de test

    private sealed class FakeClock : IClock
    {
        public FakeClock(DateTime t) { UtcNow = t; }
        public DateTime UtcNow { get; private set; }
        public void Advance(TimeSpan d) => UtcNow += d;
    }

    private sealed class FakeMarket : IMarketDataProvider
    {
        private readonly FakeClock _clock;
        private decimal _price = 1900m;
        private int _extra;
        public FakeMarket(FakeClock clock) { _clock = clock; }
        public string Name => "fake";
        public IReadOnlyCollection<AssetClass> SupportedAssetClasses { get; } = new[] { AssetClass.Crypto };
        public void SetPrice(decimal p) => _price = p;
        public void NextCandle() => _extra++;
        public Task<InstrumentSpec> GetInstrumentAsync(string symbol, CancellationToken ct = default) => Task.FromResult(TestData.Eth);
        public Task<Ticker> GetTickerAsync(string symbol, CancellationToken ct = default) =>
            Task.FromResult(new Ticker(symbol, _price - 1, _price + 1, _price, 0, _clock.UtcNow));
        public async Task<IReadOnlyList<Ticker>> GetTickersAsync(IEnumerable<string> symbols, CancellationToken ct = default) =>
            new[] { await GetTickerAsync(symbols.First(), ct) };
        public Task<IReadOnlyList<Candle>> GetCandlesAsync(string symbol, Timeframe tf, DateTime? sinceUtc = null, CancellationToken ct = default)
        {
            var last = tf.Floor(_clock.UtcNow); // bougie en cours (non clôturée)
            var list = new List<Candle>();
            for (var i = 300; i >= 0; i--)
            {
                var t = last - tf.ToTimeSpan() * i;
                list.Add(new Candle(t, 1900, 1910, 1890, 1900, 10));
            }
            return Task.FromResult<IReadOnlyList<Candle>>(list);
        }
        public Task<OrderBook> GetOrderBookAsync(string symbol, int depth = 10, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class FakeLiveVenue : IExecutionVenue
    {
        private readonly PaperExecutionVenue _inner;
        public int Orders;
        public FakeLiveVenue(PaperExecutionVenue inner) { _inner = inner; inner.SetBalances(new Dictionary<string, decimal> { ["EUR"] = 100m }); }
        public TradingMode Mode => TradingMode.Live;
        public Task<IReadOnlyDictionary<string, decimal>> GetBalancesAsync(CancellationToken ct = default) => _inner.GetBalancesAsync(ct);
        public Task<OrderResult> SubmitMarketOrderAsync(OrderRequest r, InstrumentSpec i, Ticker t, CancellationToken ct = default) { Orders++; return _inner.SubmitMarketOrderAsync(r, i, t, ct); }
    }

    private class AlwaysBuyStrategy : IStrategy
    {
        public string Id => "test"; public string Name => "test"; public string Description => "";
        public Timeframe EntryTimeframe => Timeframe.H1; public Timeframe TrendTimeframe => Timeframe.H4;
        public int RequiredEntryCandles => 1; public int RequiredTrendCandles => 0; public object Parameters => new();
        public virtual StrategyEvaluation Evaluate(StrategyContext ctx) => ctx.OpenPosition is null
            ? new StrategyEvaluation(SignalAction.EnterLong, ctx.EntryCandles[^1].Close, 100m, 1800m, 2100m, 2m, Array.Empty<SignalCheck>(), "test buy", new Dictionary<string, decimal?>())
            : new StrategyEvaluation(SignalAction.None, 0, null, null, null, 0, Array.Empty<SignalCheck>(), "hold", new Dictionary<string, decimal?>());
    }

    private sealed class BuyOnceStrategy : AlwaysBuyStrategy { }
}
