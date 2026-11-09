using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MNBot.Exchanges.Binance;

public sealed class BinanceOptions
{
    /// <summary>Point d'accès des données de marché publiques (aucune clé nécessaire).</summary>
    public string MarketDataUrl { get; set; } = "https://data-api.binance.vision";
    /// <summary>Point d'accès des opérations sur le compte (ordres, soldes).</summary>
    public string ApiUrl { get; set; } = "https://api.binance.com";
    /// <summary>Clé API (variable d'environnement BINANCE_API_KEY, jamais dans le code).</summary>
    public string? ApiKey { get; set; }
    /// <summary>Secret API (variable d'environnement BINANCE_API_SECRET).</summary>
    public string? ApiSecret { get; set; }
    public int TimeoutSeconds { get; set; } = 15;
    public int RecvWindowMs { get; set; } = 10000;
    /// <summary>Si vrai, les ordres réels sont envoyés à /api/v3/order/test : Binance les vérifie sans les exécuter.</summary>
    public bool ValidateOrdersOnly { get; set; } = false;

    public bool HasCredentials => !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(ApiSecret);
}

public sealed class BinanceApiException : Exception
{
    public BinanceApiException(string message, int? code = null) : base(message) { Code = code; }
    public int? Code { get; }
}

/// <summary>Client bas niveau de l'API REST Spot de Binance.</summary>
public sealed class BinanceClient
{
    private readonly HttpClient _http;
    private readonly BinanceOptions _options;
    private long _timeOffsetMs;
    private DateTime _lastTimeSync = DateTime.MinValue;

    public BinanceClient(HttpClient http, BinanceOptions options)
    {
        _http = http;
        _options = options;
        _http.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds);
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("MNBot", "1.0"));
    }

    public BinanceOptions Options => _options;

    public async Task<JsonElement> PublicAsync(string path, IDictionary<string, string>? query = null, CancellationToken ct = default)
    {
        var url = _options.MarketDataUrl.TrimEnd('/') + path + BuildQuery(query, prefix: true);
        using var resp = await _http.GetAsync(url, ct);
        return await ReadAsync(resp, path, ct);
    }

    public async Task<JsonElement> SignedAsync(HttpMethod method, string path, IDictionary<string, string>? parameters = null, CancellationToken ct = default)
    {
        if (!_options.HasCredentials)
            throw new BinanceApiException("Clés API Binance absentes (variables BINANCE_API_KEY / BINANCE_API_SECRET).");
        await SyncTimeAsync(ct);
        var p = new List<KeyValuePair<string, string>>();
        if (parameters is not null) p.AddRange(parameters);
        p.Add(new("recvWindow", _options.RecvWindowMs.ToString(CultureInfo.InvariantCulture)));
        p.Add(new("timestamp", (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + _timeOffsetMs).ToString(CultureInfo.InvariantCulture)));
        var query = string.Join("&", p.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));
        var signature = Sign(query, _options.ApiSecret!);
        var url = $"{_options.ApiUrl.TrimEnd('/')}{path}?{query}&signature={signature}";
        using var req = new HttpRequestMessage(method, url);
        req.Headers.Add("X-MBX-APIKEY", _options.ApiKey);
        using var resp = await _http.SendAsync(req, ct);
        return await ReadAsync(resp, path, ct);
    }

    /// <summary>Corrige le décalage d'horloge avec le serveur Binance (au plus une fois par heure).</summary>
    private async Task SyncTimeAsync(CancellationToken ct)
    {
        if (DateTime.UtcNow - _lastTimeSync < TimeSpan.FromHours(1)) return;
        try
        {
            using var resp = await _http.GetAsync(_options.ApiUrl.TrimEnd('/') + "/api/v3/time", ct);
            var json = await ReadAsync(resp, "/api/v3/time", ct);
            _timeOffsetMs = json.GetProperty("serverTime").GetInt64() - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _lastTimeSync = DateTime.UtcNow;
        }
        catch (BinanceApiException) { /* on garde le dernier décalage connu */ }
    }

    /// <summary>Signature Binance : HMAC-SHA256(secret, chaîne de paramètres), en hexadécimal.</summary>
    public static string Sign(string query, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(query))).ToLowerInvariant();
    }

    private static string BuildQuery(IDictionary<string, string>? q, bool prefix) =>
        q is null || q.Count == 0 ? "" : (prefix ? "?" : "") + string.Join("&", q.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage resp, string path, CancellationToken ct)
    {
        var body = await resp.Content.ReadAsStringAsync(ct);
        JsonElement json;
        try { using var doc = JsonDocument.Parse(body); json = doc.RootElement.Clone(); }
        catch (JsonException) { throw new BinanceApiException($"Réponse illisible de Binance sur {path} (HTTP {(int)resp.StatusCode})."); }
        if (!resp.IsSuccessStatusCode || (json.ValueKind == JsonValueKind.Object && json.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.Number && code.GetInt32() < 0))
        {
            var msg = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("msg", out var m) ? m.GetString() : body;
            int? c = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("code", out var cc) && cc.ValueKind == JsonValueKind.Number ? cc.GetInt32() : null;
            throw new BinanceApiException($"Binance {path} : {msg} (HTTP {(int)resp.StatusCode}{(c is null ? "" : $", code {c}")})", c);
        }
        return json;
    }

    public static decimal Dec(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Number => e.GetDecimal(),
        JsonValueKind.String => decimal.Parse(e.GetString()!, NumberStyles.Float, CultureInfo.InvariantCulture),
        _ => 0m,
    };
}
