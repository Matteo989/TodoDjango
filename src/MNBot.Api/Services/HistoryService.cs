using System.Globalization;
using System.Text.Json;
using MNBot.Api.Infrastructure;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;
using MNBot.Core.Engine;

namespace MNBot.Api.Services;

/// <summary>
/// Import d'historique pour le backtesting.
///  - "exchange" : dernières bougies 1h/4h/1j de la plateforme connectée (Kraken : 720 bougies maximum) ;
///  - "binance" : historique long en 1h via l'API publique de données Binance (data-api.binance.vision),
///    utile pour tester sur plusieurs années (identique aux prix réels si le bot trade sur Binance).
/// </summary>
public sealed class HistoryService
{
    private readonly IMarketDataProvider _md;
    private readonly SqliteRepository _repo;
    private readonly HttpClient _http;
    private readonly ILogger<HistoryService> _log;

    public HistoryService(IMarketDataProvider md, SqliteRepository repo, IHttpClientFactory httpFactory, ILogger<HistoryService> log)
    {
        _md = md;
        _repo = repo;
        _http = httpFactory.CreateClient("history");
        _log = log;
    }

    public async Task<object> ImportAsync(string symbol, string source, int days, CancellationToken ct)
    {
        source = source.ToLowerInvariant();
        if (source == "exchange" || source == _md.Name.ToLowerInvariant() && source != "binance")
        {
            // Dernières bougies disponibles directement auprès de la plateforme connectée
            var now = DateTime.UtcNow;
            var counts = new Dictionary<string, int>();
            foreach (var tf in new[] { Timeframe.H1, Timeframe.H4, Timeframe.D1 })
            {
                var candles = (await _md.GetCandlesAsync(symbol, tf, null, ct)).Where(c => c.CloseTime(tf) <= now).ToList();
                await _repo.UpsertCandlesAsync(_md.Name.ToLowerInvariant(), symbol, tf, candles);
                counts[tf.Label()] = candles.Count;
            }
            return new { symbol, source = _md.Name.ToLowerInvariant(), candles = counts };
        }
        if (source == "binance")
        {
            var count = await ImportBinanceAsync(symbol, days, ct);
            return new { symbol, source, candles = new Dictionary<string, int> { ["1h"] = count } };
        }
        throw new ArgumentException("Source inconnue (exchange ou binance).");
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
