using MNBot.Core.Domain;

namespace MNBot.Tests;

public static class TestData
{
    public static readonly InstrumentSpec Btc = new("BTC/EUR", "XBTEUR", "XXBT", "ZEUR", 0.00006m, 0.45m, 8, 1, 0.1m);
    public static readonly InstrumentSpec Eth = new("ETH/EUR", "ETHEUR", "XETH", "ZEUR", 0.002m, 0.45m, 8, 2, 0.01m);

    /// <summary>Marche aléatoire déterministe (graine fixe) avec dérive, en bougies 1h.</summary>
    public static List<Candle> RandomWalk(int count, decimal start = 50000m, double drift = 0.0002, double vol = 0.006, int seed = 42, DateTime? from = null)
    {
        var rnd = new Random(seed);
        var t = from ?? new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var list = new List<Candle>(count);
        var price = (double)start;
        for (var i = 0; i < count; i++)
        {
            var open = price;
            var ret = drift + vol * Normal(rnd);
            var close = open * (1 + ret);
            var high = Math.Max(open, close) * (1 + Math.Abs(Normal(rnd)) * vol * 0.5);
            var low = Math.Min(open, close) * (1 - Math.Abs(Normal(rnd)) * vol * 0.5);
            var volume = 10 + Math.Abs(Normal(rnd)) * 10 + (ret > 0 ? 5 : 0);
            list.Add(new Candle(t.AddHours(i), D(open), D(high), D(low), D(close), D(volume)));
            price = close;
        }
        return list;
    }

    private static decimal D(double v) => Math.Round((decimal)v, 4);

    private static double Normal(Random r)
    {
        var u1 = 1.0 - r.NextDouble();
        var u2 = r.NextDouble();
        return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
    }
}
