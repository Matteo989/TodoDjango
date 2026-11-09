using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;

namespace MNBot.Exchanges.Binance;

public static class BinanceSymbols
{
    /// <summary>"BTC/EUR" → "BTCEUR".</summary>
    public static string ToPair(string symbol)
    {
        var parts = symbol.ToUpperInvariant().Split('/');
        if (parts.Length != 2) throw new ArgumentException($"Symbole invalide : {symbol}");
        return parts[0] + parts[1];
    }

    public static string Interval(Timeframe tf) => tf switch
    {
        Timeframe.M1 => "1m", Timeframe.M5 => "5m", Timeframe.M15 => "15m", Timeframe.M30 => "30m",
        Timeframe.H1 => "1h", Timeframe.H4 => "4h", Timeframe.D1 => "1d",
        _ => throw new ArgumentException($"Unité de temps non prise en charge par Binance : {tf}"),
    };

    /// <summary>Nombre de décimales d'un pas ("0.00001000" → 5).</summary>
    public static int DecimalsOf(decimal step)
    {
        if (step <= 0) return 8;
        var s = step.ToString(CultureInfo.InvariantCulture);
        var dot = s.IndexOf('.');
        return dot < 0 ? 0 : s.TrimEnd('0').Length - dot - 1;
    }
}

/// <summary>Market Data Engine pour Binance (API publique, aucune clé nécessaire).</summary>
public sealed class BinanceMarketDataProvider : IMarketDataProvider
{
    private readonly BinanceClient _client;
    private readonly ConcurrentDictionary<string, InstrumentSpec> _specs = new();

    public BinanceMarketDataProvider(BinanceClient client) { _client = client; }

    public string Name => "Binance";
    public IReadOnlyCollection<AssetClass> SupportedAssetClasses { get; } = new[] { AssetClass.Crypto };

    public async Task<InstrumentSpec> GetInstrumentAsync(string symbol, CancellationToken ct = default)
    {
        if (_specs.TryGetValue(symbol, out var cached)) return cached;
        var json = await _client.PublicAsync("/api/v3/exchangeInfo", new Dictionary<string, string> { ["symbol"] = BinanceSymbols.ToPair(symbol) }, ct);
        var spec = ParseInstrument(symbol, json.GetProperty("symbols")[0]);
        _specs[symbol] = spec;
        return spec;
    }

    public static InstrumentSpec ParseInstrument(string symbol, JsonElement s)
    {
        if (s.GetProperty("status").GetString() != "TRADING")
            throw new BinanceApiException($"{symbol} n'est pas négociable actuellement sur Binance.");
        decimal minQty = 0, step = 0, tick = 0, minNotional = 0;
        foreach (var f in s.GetProperty("filters").EnumerateArray())
        {
            switch (f.GetProperty("filterType").GetString())
            {
                case "LOT_SIZE": minQty = BinanceClient.Dec(f.GetProperty("minQty")); step = BinanceClient.Dec(f.GetProperty("stepSize")); break;
                case "PRICE_FILTER": tick = BinanceClient.Dec(f.GetProperty("tickSize")); break;
                case "NOTIONAL":
                case "MIN_NOTIONAL": minNotional = Math.Max(minNotional, BinanceClient.Dec(f.GetProperty("minNotional"))); break;
            }
        }
        return new InstrumentSpec(symbol, s.GetProperty("symbol").GetString()!, s.GetProperty("baseAsset").GetString()!, s.GetProperty("quoteAsset").GetString()!,
            minQty, minNotional, BinanceSymbols.DecimalsOf(step), BinanceSymbols.DecimalsOf(tick), tick);
    }

    public async Task<Ticker> GetTickerAsync(string symbol, CancellationToken ct = default) =>
        (await GetTickersAsync(new[] { symbol }, ct)).Single();

    public async Task<IReadOnlyList<Ticker>> GetTickersAsync(IEnumerable<string> symbols, CancellationToken ct = default)
    {
        var list = symbols.ToList();
        var pairs = "[" + string.Join(",", list.Select(s => $"\"{BinanceSymbols.ToPair(s)}\"")) + "]";
        var json = await _client.PublicAsync("/api/v3/ticker/24hr", new Dictionary<string, string> { ["symbols"] = pairs }, ct);
        var now = DateTime.UtcNow;
        var bySymbol = json.EnumerateArray().ToDictionary(e => e.GetProperty("symbol").GetString()!, e => e);
        return list.Select(s => bySymbol.TryGetValue(BinanceSymbols.ToPair(s), out var t)
            ? ParseTicker(s, t, now)
            : throw new BinanceApiException($"Ticker absent pour {s}")).ToList();
    }

    public static Ticker ParseTicker(string symbol, JsonElement t, DateTime now) => new(
        symbol,
        Bid: BinanceClient.Dec(t.GetProperty("bidPrice")),
        Ask: BinanceClient.Dec(t.GetProperty("askPrice")),
        Last: BinanceClient.Dec(t.GetProperty("lastPrice")),
        Volume24h: BinanceClient.Dec(t.GetProperty("volume")),
        TimeUtc: now);

    public async Task<IReadOnlyList<Candle>> GetCandlesAsync(string symbol, Timeframe timeframe, DateTime? sinceUtc = null, CancellationToken ct = default)
    {
        var q = new Dictionary<string, string>
        {
            ["symbol"] = BinanceSymbols.ToPair(symbol),
            ["interval"] = BinanceSymbols.Interval(timeframe),
            ["limit"] = "1000",
        };
        if (sinceUtc is { } since) q["startTime"] = new DateTimeOffset(since, TimeSpan.Zero).ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture);
        return ParseKlines(await _client.PublicAsync("/api/v3/klines", q, ct));
    }

    public static List<Candle> ParseKlines(JsonElement rows)
    {
        // [openTime, open, high, low, close, volume, closeTime, ...]
        var list = new List<Candle>(rows.GetArrayLength());
        foreach (var r in rows.EnumerateArray())
        {
            var t = DateTimeOffset.FromUnixTimeMilliseconds(r[0].GetInt64()).UtcDateTime;
            list.Add(new Candle(t, BinanceClient.Dec(r[1]), BinanceClient.Dec(r[2]), BinanceClient.Dec(r[3]), BinanceClient.Dec(r[4]), BinanceClient.Dec(r[5])));
        }
        return list;
    }

    public async Task<OrderBook> GetOrderBookAsync(string symbol, int depth = 10, CancellationToken ct = default)
    {
        var limit = depth <= 5 ? 5 : depth <= 10 ? 10 : 20;
        var json = await _client.PublicAsync("/api/v3/depth", new Dictionary<string, string> { ["symbol"] = BinanceSymbols.ToPair(symbol), ["limit"] = limit.ToString() }, ct);
        static List<OrderBookLevel> Levels(JsonElement arr) =>
            arr.EnumerateArray().Select(l => new OrderBookLevel(BinanceClient.Dec(l[0]), BinanceClient.Dec(l[1]))).ToList();
        return new OrderBook(symbol, Levels(json.GetProperty("bids")), Levels(json.GetProperty("asks")), DateTime.UtcNow);
    }
}
