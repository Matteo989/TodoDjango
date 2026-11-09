using MNBot.Core.Backtesting;
using MNBot.Core.Domain;
using MNBot.Core.Indicators;

namespace MNBot.Tests;

public class IndicatorTests
{
    [Fact]
    public void Sma_ComputesRollingAverage()
    {
        var r = Ta.Sma(new decimal[] { 1, 2, 3, 4, 5 }, 3);
        Assert.Equal(new decimal?[] { null, null, 2, 3, 4 }, r);
    }

    [Fact]
    public void Ema_IsSeededWithSmaThenSmoothed()
    {
        // période 3 → k = 0,5 ; graine = moyenne(1,2,3) = 2
        var r = Ta.Ema(new decimal[] { 1, 2, 3, 4, 5 }, 3);
        Assert.Null(r[1]);
        Assert.Equal(2m, r[2]);
        Assert.Equal(3m, r[3]);
        Assert.Equal(4m, r[4]);
    }

    [Fact]
    public void Rsi_Is100OnStrictUptrend_And0OnStrictDowntrend()
    {
        var up = Enumerable.Range(1, 30).Select(i => (decimal)i).ToArray();
        Assert.Equal(100m, Ta.Rsi(up, 14)[^1]);
        var down = up.Reverse().ToArray();
        Assert.Equal(0m, Ta.Rsi(down, 14)[^1]);
    }

    [Fact]
    public void Rsi_MatchesManualWilderComputation()
    {
        decimal[] closes = { 10, 11, 10, 12, 11, 13 };
        var r = Ta.Rsi(closes, 2);
        // Gains/pertes : +1, -1, +2, -1, +2. Graine (2 premiers) : gain 0,5, perte 0,5.
        // i=3 : g=(0,5+2)/2=1,25 ; l=0,25 → RS=5 → RSI=83,33
        Assert.Equal(83.33m, Math.Round(r[3]!.Value, 2));
        // i=4 : g=0,625 ; l=0,625 → 50
        Assert.Equal(50m, Math.Round(r[4]!.Value, 2));
    }

    [Fact]
    public void Atr_EqualsConstantRange()
    {
        var n = 30;
        var high = Enumerable.Repeat(102m, n).ToArray();
        var low = Enumerable.Repeat(98m, n).ToArray();
        var close = Enumerable.Repeat(100m, n).ToArray();
        Assert.Equal(4m, Ta.Atr(high, low, close, 14)[^1]);
    }

    [Fact]
    public void Indicators_DoNotUseFutureData()
    {
        var candles = TestData.RandomWalk(400);
        var closes = candles.Select(c => c.Close).ToArray();
        var full = Ta.Ema(closes, 20);
        var prefix = Ta.Ema(closes.Take(250).ToArray(), 20);
        for (var i = 0; i < 250; i++) Assert.Equal(prefix[i], full[i]);
        var fullRsi = Ta.Rsi(closes, 14);
        var prefixRsi = Ta.Rsi(closes.Take(250).ToArray(), 14);
        for (var i = 0; i < 250; i++) Assert.Equal(prefixRsi[i], fullRsi[i]);
    }

    [Fact]
    public void Aggregate_Builds4hCandlesAlignedOnUtc_AndSkipsIncomplete()
    {
        var h1 = TestData.RandomWalk(10, from: new DateTime(2024, 1, 1, 2, 0, 0, DateTimeKind.Utc));
        var h4 = CandleTools.Aggregate(h1, Timeframe.H1, Timeframe.H4);
        // 02h-03h incomplet, 04h-07h complet, 08h-11h complet → 2 bougies
        Assert.Equal(2, h4.Count);
        Assert.Equal(new DateTime(2024, 1, 1, 4, 0, 0, DateTimeKind.Utc), h4[0].OpenTime);
        var src = h1.Skip(2).Take(4).ToList();
        Assert.Equal(src[0].Open, h4[0].Open);
        Assert.Equal(src[^1].Close, h4[0].Close);
        Assert.Equal(src.Max(c => c.High), h4[0].High);
        Assert.Equal(src.Min(c => c.Low), h4[0].Low);
        Assert.Equal(src.Sum(c => c.Volume), h4[0].Volume);
    }
}
