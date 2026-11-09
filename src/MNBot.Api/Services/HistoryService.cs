using System.Globalization;
using System.Text.Json;
using MNBot.Api.Infrastructure;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;
using MNBot.Core.Engine;

namespace MNBot.Api.Services;

/// <summary>
/// Import d'historique pour le backtesting.
///  - "kraken" : 720 dernières bougies 1h (~30 jours) et 4h (~120 jours) via l'API publique Kraken ;
///  - "binance" : historique long en 1h via l'API publique de données Binance (data-api.binance.vision),
///    utile pour tester sur plusieurs années. Les prix diffèrent très légèrement de Kraken : à garder en tête.
/// </summary>
public sealed class HistoryService
{
    private readonly IMarketDataProvider _kraken;
    private readonly SqliteRepository _repo;
    private readonly HttpClient _http;
    private readonly ILogger<HistoryService> _log;

    public HistoryService(IMarketDataProvider kraken, SqliteRepository repo, IHttpClientFactory httpFactory, ILogger<HistoryService> log)
    {
        _kraken = kraken;
        _repo = repo;
        _http = httpFactory.CreateClient("history");
        _log = log;
    }

    public async Task<object> ImportAsync(string symbol, string source, int days, CancellationToken ct)
    {
        source = source.ToLowerInvariant();
        if (source == "kraken")
        {
            var h1 = await _kraken.GetCandlesAsync(symbol, Timeframe.H1, null, ct);
            var h4 = await _kraken.GetCandlesAsync(symbol, Timeframe.H4, null, ct);
            var now = DateTime.UtcNow;
            var c1 = h1.Where(c => c.CloseTime(Timeframe.H1) <= now).ToList();
            var c4 = h4.Where(c => c.CloseTime(Timeframe.H4) <= now).ToList();
            await _repo.UpsertCandlesAsync(TradingEngine.SourceName, symbol, Timeframe.H1, c1);
            await _repo.UpsertCandlesAsync(TradingEngine.SourceName, symbol, Timeframe.H4, c4);
            return new { symbol, source, candles1h = c1.Count, candles4h = c4.Count };
        }
        if (source == "binance")
        {
            var count = await ImportBinanceAsync(symbol, days, ct);
            return new { symbol, source, candles1h = count, candles4h = 0 };
        }
        throw new ArgumentException("Source inconnue (kraken ou binance).");
    }

    private async Task<int> ImportBinanceAsync(string symbol, int days, CancellationToken ct)
    {
        var bSymbol = symbol.Replace("/", "").ToUpperInvariant();
        var start = DateTimeOffset.UtcNow.AddDays(-days).ToUnixTimeMilliseconds();
        var now = DateTime.UtcNow;
        var total = 0;
        for (var page = 0; page < 200; page++)
        {
            var url = $"https://data-api.binance.vision/api/v3/klines?symbol={bSymbol}&interval=1h&startTime={start}&limit=1000";
            using var resp = await _http.GetAsync(url, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode) throw new InvalidOperationException($"Binance HTTP {(int)resp.StatusCode} : {body[..Math.Min(200, body.Length)]}");
            using var doc = JsonDocument.Parse(body);
            var rows = doc.RootElement;
            if (rows.GetArrayLength() == 0) break;
            var candles = new List<Candle>();
            long lastOpen = 0;
            foreach (var r in rows.EnumerateArray())
            {
                lastOpen = r[0].GetInt64();
                var t = DateTimeOffset.FromUnixTimeMilliseconds(lastOpen).UtcDateTime;
                if (t + TimeSpan.FromHours(1) > now) continue; // bougie non clôturée
                candles.Add(new Candle(t, Dec(r[1]), Dec(r[2]), Dec(r[3]), Dec(r[4]), Dec(r[5])));
            }
            await _repo.UpsertCandlesAsync("binance", symbol, Timeframe.H1, candles);
            total += candles.Count;
            if (rows.GetArrayLength() < 1000) break;
            start = lastOpen + 3_600_000;
            await Task.Delay(250, ct);
        }
        _log.LogInformation("Import Binance {Symbol} : {Count} bougies 1h", symbol, total);
        return total;
    }

    private static decimal Dec(JsonElement e) => decimal.Parse(e.GetString()!, NumberStyles.Float, CultureInfo.InvariantCulture);
}
