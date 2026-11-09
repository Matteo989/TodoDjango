using System.Text.Json;
using MNBot.Core.Backtesting;
using MNBot.Core.Domain;
using MNBot.Core.Strategies;
using MNBot.Exchanges.Binance;

namespace MNBot.Tests;

public class BinanceAndTrendTests
{
    private static readonly InstrumentSpec BtcEur = new("BTC/EUR", "BTCEUR", "BTC", "EUR", 0.00001m, 5m, 5, 2, 0.01m);

    [Fact]
    public void Binance_SignatureMatchesOfficialDocumentationExample()
    {
        // Exemple de la documentation de l'API Spot Binance (signature HMAC SHA256).
        var sig = BinanceClient.Sign(
            "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559",
            "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j");
        Assert.Equal("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71", sig);
    }

    [Theory]
    [InlineData("0.00001000", 5)]
    [InlineData("0.01000000", 2)]
    [InlineData("1.00000000", 0)]
    [InlineData("0.00010000", 4)]
    public void Binance_StepDecimals(string step, int decimals) =>
        Assert.Equal(decimals, BinanceSymbols.DecimalsOf(decimal.Parse(step, System.Globalization.CultureInfo.InvariantCulture)));

    [Fact]
    public void Binance_ParsesExchangeInfoFilters()
    {
        var json = JsonDocument.Parse("""
            {"symbol":"BTCEUR","status":"TRADING","baseAsset":"BTC","quoteAsset":"EUR","filters":[
              {"filterType":"PRICE_FILTER","minPrice":"0.01","maxPrice":"1000000","tickSize":"0.01000000"},
              {"filterType":"LOT_SIZE","minQty":"0.00001000","maxQty":"9000","stepSize":"0.00001000"},
              {"filterType":"NOTIONAL","minNotional":"5.00000000","applyMinToMarket":true}]}
            """).RootElement;
        var spec = BinanceMarketDataProvider.ParseInstrument("BTC/EUR", json);
        Assert.Equal("BTCEUR", spec.ExchangeSymbol);
        Assert.Equal(0.00001m, spec.MinQuantity);
        Assert.Equal(5m, spec.MinCost);
        Assert.Equal(5, spec.QuantityDecimals);
        Assert.Equal(0.00041m, spec.RoundQuantityDown(0.000419999m));
    }

    [Fact]
    public void Binance_ParsesKlinesAndTicker()
    {
        var k = JsonDocument.Parse("""[[1794196800000,"66894.41","67059.83","66707.03","66797.08","2.04277",1794200399999,"136736.3",644,"0.79","53023.1","0"]]""").RootElement;
        var c = BinanceMarketDataProvider.ParseKlines(k).Single();
        Assert.Equal(new DateTime(2026, 11, 9, 4, 0, 0, DateTimeKind.Utc), c.OpenTime);
        Assert.Equal(66797.08m, c.Close);
        Assert.Equal(2.04277m, c.Volume);
        var t = JsonDocument.Parse("""{"symbol":"BTCEUR","lastPrice":"66504.04","bidPrice":"66544.23","askPrice":"66544.24","volume":"123.4"}""").RootElement;
        var tk = BinanceMarketDataProvider.ParseTicker("BTC/EUR", t, DateTime.UtcNow);
        Assert.Equal(66544.23m, tk.Bid);
        Assert.Equal(66544.24m, tk.Ask);
    }

    [Fact]
    public void Binance_BuyWithFeeInBaseAsset_ReducesHeldQuantity()
    {
        var json = JsonDocument.Parse("""
            {"orderId":42,"status":"FILLED","executedQty":"0.00050000","cummulativeQuoteQty":"33.00000000",
             "fills":[{"price":"66000","qty":"0.0005","commission":"0.00000050","commissionAsset":"BTC"}]}
            """).RootElement;
        var r = BinanceExecutionVenue.ParseOrder(new OrderRequest("x", "BTC/EUR", OrderSide.Buy, 0.0005m, ""), BtcEur, json, 0.001m);
        Assert.Equal(OrderStatus.Filled, r.Status);
        Assert.Equal(66000m, r.AveragePrice);
        Assert.Equal(0.0005m - 0.0000005m, r.FilledQuantity);
        Assert.Equal(0.033m, r.Fee);
    }

    [Fact]
    public void Binance_SellWithFeeInEur()
    {
        var json = JsonDocument.Parse("""
            {"orderId":43,"status":"FILLED","executedQty":"0.00050000","cummulativeQuoteQty":"34.00000000",
             "fills":[{"price":"68000","qty":"0.0005","commission":"0.034","commissionAsset":"EUR"}]}
            """).RootElement;
        var r = BinanceExecutionVenue.ParseOrder(new OrderRequest("y", "BTC/EUR", OrderSide.Sell, 0.0005m, ""), BtcEur, json, 0.001m);
        Assert.Equal(0.0005m, r.FilledQuantity);
        Assert.Equal(0.034m, r.Fee);
    }

    [Fact]
    public void Binance_UnfilledOrderIsRejected()
    {
        var json = JsonDocument.Parse("""{"orderId":44,"status":"EXPIRED","executedQty":"0","cummulativeQuoteQty":"0","fills":[]}""").RootElement;
        var r = BinanceExecutionVenue.ParseOrder(new OrderRequest("z", "BTC/EUR", OrderSide.Buy, 0.0005m, ""), BtcEur, json, 0.001m);
        Assert.Equal(OrderStatus.Rejected, r.Status);
    }

    [Fact]
    public void Binance_ClientIdIsSanitizedAndBounded()
    {
        var id = BinanceExecutionVenue.SafeClientId("breakout-4h-BTCEUR-202611090400-BUY-with-a-very-long-suffix");
        Assert.True(id.Length <= 36);
        Assert.Matches("^[A-Za-z0-9._:/-]+$", id);
        Assert.Equal(id, BinanceExecutionVenue.SafeClientId("breakout-4h-BTCEUR-202611090400-BUY-with-a-very-long-suffix"));
        Assert.Equal("POS12-SELL", BinanceExecutionVenue.SafeClientId("POS12-SELL"));
    }

    // ------------------------------------------------------------------ stratégie de cassure

    private static List<Candle> H4Walk(int n, int seed, double drift) =>
        CandleTools.Aggregate(TestData.RandomWalk(n * 4, drift: drift, seed: seed), Timeframe.H1, Timeframe.H4);

    [Fact]
    public void Breakout_EntriesRespectChannelAndTrendFilter()
    {
        var c = H4Walk(1500, 9, 0.0004);
        var s = new TrendFollowingStrategy(new TrendFollowingParameters { Timeframe = "4h" });
        var found = 0;
        for (var i = 300; i < c.Count; i++)
        {
            var e = s.Evaluate(new StrategyContext("BTC/EUR", new PrefixView<Candle>(c, i + 1), Array.Empty<Candle>(), null, c[i].CloseTime(Timeframe.H4)));
            if (e.Action != SignalAction.EnterLong) continue;
            found++;
            var prevHigh = c.Skip(i - 20).Take(20).Max(x => x.High);
            Assert.True(c[i].Close > prevHigh);
            Assert.True(e.Indicators["close"] > e.Indicators["emaTrend"]);
            Assert.Equal(Math.Round(3m * e.Indicators["atr14"]!.Value, 8), Math.Round(e.StopDistance!.Value, 8));
        }
        Assert.True(found > 0);
    }

    [Fact]
    public void Breakout_ExitsWhenCloseBreaksLowerChannel()
    {
        var c = H4Walk(1500, 13, 0.0);
        var s = new TrendFollowingStrategy(new TrendFollowingParameters { Timeframe = "4h", TrailingAtrMultiplier = 0 });
        var pos = new Position { Symbol = "BTC/EUR", EntryPrice = c[300].Close, EntryTimeUtc = c[300].OpenTime, Quantity = 0.001m };
        var exits = 0;
        for (var i = 301; i < c.Count; i++)
        {
            var e = s.Evaluate(new StrategyContext("BTC/EUR", new PrefixView<Candle>(c, i + 1), Array.Empty<Candle>(), pos, c[i].CloseTime(Timeframe.H4)));
            Assert.NotEqual(SignalAction.EnterLong, e.Action);
            var lowest = c.Skip(i - 10).Take(10).Min(x => x.Low);
            Assert.Equal(c[i].Close < lowest, e.Action == SignalAction.ExitLong);
            if (e.Action == SignalAction.ExitLong) exits++;
        }
        Assert.True(exits > 0);
    }

    [Fact]
    public void Registry_BuildsTrendFollowingFromConfiguration()
    {
        var reg = new StrategyRegistry(new[] { new StrategyDefinition { Id = "b", Type = "TrendFollowing", Trend = new TrendFollowingParameters { Timeframe = "1d" } } });
        Assert.Equal(Timeframe.D1, reg.Get("b").EntryTimeframe);
    }
}
