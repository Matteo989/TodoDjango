using System.Collections.Concurrent;
using System.Text.Json;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;

namespace MNBot.Exchanges.Kraken;

/// <summary>Correspondance entre symboles internes ("BTC/EUR") et codes Kraken ("XBTEUR", "XXBT"…).</summary>
public static class KrakenSymbols
{
    private static readonly Dictionary<string, string> ToKrakenAsset = new(StringComparer.OrdinalIgnoreCase)
    {
        ["BTC"] = "XBT",
        ["DOGE"] = "XDG",
    };

    public static string ToPair(string symbol)
    {
        var parts = symbol.ToUpperInvariant().Split('/');
        if (parts.Length != 2) throw new ArgumentException($"Symbole invalide : {symbol}");
        string Map(string a) => ToKrakenAsset.TryGetValue(a, out var k) ? k : a;
        return Map(parts[0]) + Map(parts[1]);
    }

    /// <summary>Normalise un code d'actif Kraken ("XXBT", "ZEUR", "XETH", "XBT") en code interne ("BTC", "EUR", "ETH").</summary>
    public static string NormalizeAsset(string krakenAsset)
    {
        var a = krakenAsset.ToUpperInvariant();
        if (a.Length == 4 && (a[0] == 'X' || a[0] == 'Z')) a = a[1..];
        return a switch { "XBT" => "BTC", "XDG" => "DOGE", _ => a };
    }
}

/// <summary>Market Data Engine pour Kraken (API publique, aucune clé nécessaire).</summary>
public sealed class KrakenMarketDataProvider : IMarketDataProvider
{
    private readonly KrakenClient _client;
    private readonly ConcurrentDictionary<string, InstrumentSpec> _specs = new();
    private readonly ConcurrentDictionary<string, string> _resultKeyBySymbol = new();

    public KrakenMarketDataProvider(KrakenClient client) { _client = client; }

    public string Name => "Kraken";
    public IReadOnlyCollection<AssetClass> SupportedAssetClasses { get; } = new[] { AssetClass.Crypto };

    public async Task<InstrumentSpec> GetInstrumentAsync(string symbol, CancellationToken ct = default)
    {
        if (_specs.TryGetValue(symbol, out var cached)) return cached;
        var pair = KrakenSymbols.ToPair(symbol);
        var result = await _client.PublicAsync("AssetPairs", new Dictionary<string, string> { ["pair"] = pair }, ct);
        var prop = result.EnumerateObject().First();
        var v = prop.Value;
        var spec = new InstrumentSpec(
            Symbol: symbol,
            ExchangeSymbol: v.GetProperty("altname").GetString()!,
            BaseAsset: v.GetProperty("base").GetString()!,
            QuoteAsset: v.GetProperty("quote").GetString()!,
            MinQuantity: KrakenClient.Dec(v.GetProperty("ordermin")),
            MinCost: v.TryGetProperty("costmin", out var cm) ? KrakenClient.Dec(cm) : 0m,
            QuantityDecimals: v.GetProperty("lot_decimals").GetInt32(),
            PriceDecimals: v.GetProperty("pair_decimals").GetInt32(),
            TickSize: v.TryGetProperty("tick_size", out var ts) ? KrakenClient.Dec(ts) : 0m);
        _specs[symbol] = spec;
        _resultKeyBySymbol[symbol] = prop.Name;
        return spec;
    }

    public async Task<Ticker> GetTickerAsync(string symbol, CancellationToken ct = default) =>
        (await GetTickersAsync(new[] { symbol }, ct)).Single();

    public async Task<IReadOnlyList<Ticker>> GetTickersAsync(IEnumerable<string> symbols, CancellationToken ct = default)
    {
        var list = symbols.ToList();
        foreach (var s in list) await GetInstrumentAsync(s, ct);
        var pairs = string.Join(",", list.Select(KrakenSymbols.ToPair));
        var result = await _client.PublicAsync("Ticker", new Dictionary<string, string> { ["pair"] = pairs }, ct);
        var now = DateTime.UtcNow;
        var tickers = new List<Ticker>();
        foreach (var s in list)
        {
            var key = _resultKeyBySymbol[s];
            if (!result.TryGetProperty(key, out var t) && !result.TryGetProperty(KrakenSymbols.ToPair(s), out t))
                throw new KrakenApiException($"Ticker absent pour {s}");
            tickers.Add(ParseTicker(s, t, now));
        }
        return tickers;
    }

    public static Ticker ParseTicker(string symbol, JsonElement t, DateTime now) => new(
        symbol,
        Bid: KrakenClient.Dec(t.GetProperty("b")[0]),
        Ask: KrakenClient.Dec(t.GetProperty("a")[0]),
        Last: KrakenClient.Dec(t.GetProperty("c")[0]),
        Volume24h: KrakenClient.Dec(t.GetProperty("v")[1]),
        TimeUtc: now);

    public async Task<IReadOnlyList<Candle>> GetCandlesAsync(string symbol, Timeframe timeframe, DateTime? sinceUtc = null, CancellationToken ct = default)
    {
        await GetInstrumentAsync(symbol, ct);
        var q = new Dictionary<string, string>
        {
            ["pair"] = KrakenSymbols.ToPair(symbol),
            ["interval"] = ((int)timeframe).ToString(),
        };
        if (sinceUtc is { } since) q["since"] = new DateTimeOffset(since, TimeSpan.Zero).ToUnixTimeSeconds().ToString();
        var result = await _client.PublicAsync("OHLC", q, ct);
        var key = result.EnumerateObject().First(p => p.Name != "last").Name;
        return ParseOhlc(result.GetProperty(key));
    }

    public static List<Candle> ParseOhlc(JsonElement rows)
    {
        // [time, open, high, low, close, vwap, volume, count]
        var list = new List<Candle>(rows.GetArrayLength());
        foreach (var r in rows.EnumerateArray())
        {
            var time = DateTimeOffset.FromUnixTimeSeconds(r[0].GetInt64()).UtcDateTime;
            list.Add(new Candle(time, KrakenClient.Dec(r[1]), KrakenClient.Dec(r[2]), KrakenClient.Dec(r[3]), KrakenClient.Dec(r[4]), KrakenClient.Dec(r[6])));
        }
        return list;
    }

    public async Task<OrderBook> GetOrderBookAsync(string symbol, int depth = 10, CancellationToken ct = default)
    {
        await GetInstrumentAsync(symbol, ct);
        var result = await _client.PublicAsync("Depth", new Dictionary<string, string>
        {
            ["pair"] = KrakenSymbols.ToPair(symbol),
            ["count"] = depth.ToString(),
        }, ct);
        var book = result.EnumerateObject().First().Value;
        static List<OrderBookLevel> Levels(JsonElement arr) =>
            arr.EnumerateArray().Select(l => new OrderBookLevel(KrakenClient.Dec(l[0]), KrakenClient.Dec(l[1]))).ToList();
        return new OrderBook(symbol, Levels(book.GetProperty("bids")), Levels(book.GetProperty("asks")), DateTime.UtcNow);
    }
}
