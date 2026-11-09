using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MNBot.Exchanges.Kraken;

public sealed class KrakenOptions
{
    public string BaseUrl { get; set; } = "https://api.kraken.com";
    /// <summary>Clé API (lue depuis la variable d'environnement KRAKEN_API_KEY, jamais depuis le code).</summary>
    public string? ApiKey { get; set; }
    /// <summary>Secret API (variable d'environnement KRAKEN_API_SECRET).</summary>
    public string? ApiSecret { get; set; }
    public int TimeoutSeconds { get; set; } = 15;
    /// <summary>Si vrai, les ordres réels sont envoyés avec validate=true : Kraken les vérifie sans les exécuter.</summary>
    public bool ValidateOrdersOnly { get; set; } = false;

    public bool HasCredentials => !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(ApiSecret);
}

public sealed class KrakenApiException : Exception
{
    public KrakenApiException(string message) : base(message) { }
}

/// <summary>Client bas niveau de l'API REST Kraken (publique et privée).</summary>
public sealed class KrakenClient
{
    private readonly HttpClient _http;
    private readonly KrakenOptions _options;
    private long _lastNonce;
    private readonly SemaphoreSlim _privateGate = new(1, 1);
    private readonly SemaphoreSlim _publicGate = new(1, 1);
    private DateTime _lastPublicCall = DateTime.MinValue;

    public KrakenClient(HttpClient http, KrakenOptions options)
    {
        _http = http;
        _options = options;
        if (_http.BaseAddress is null) _http.BaseAddress = new Uri(options.BaseUrl);
        _http.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds);
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("MNBot", "1.0"));
    }

    public KrakenOptions Options => _options;

    public async Task<JsonElement> PublicAsync(string method, IDictionary<string, string>? query = null, CancellationToken ct = default)
    {
        var qs = query is null || query.Count == 0 ? "" : "?" + string.Join("&", query.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));
        // Limitation douce : au plus ~2 appels publics par seconde
        await _publicGate.WaitAsync(ct);
        try
        {
            var wait = TimeSpan.FromMilliseconds(500) - (DateTime.UtcNow - _lastPublicCall);
            if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
            _lastPublicCall = DateTime.UtcNow;
        }
        finally { _publicGate.Release(); }

        using var resp = await _http.GetAsync($"/0/public/{method}{qs}", ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode) throw new KrakenApiException($"HTTP {(int)resp.StatusCode} sur {method}");
        return ParseResult(body, method);
    }

    public async Task<JsonElement> PrivateAsync(string method, IDictionary<string, string>? parameters = null, CancellationToken ct = default)
    {
        if (!_options.HasCredentials)
            throw new KrakenApiException("Clés API Kraken absentes (variables KRAKEN_API_KEY / KRAKEN_API_SECRET).");

        await _privateGate.WaitAsync(ct);
        try
        {
            var nonce = NextNonce();
            var data = new List<KeyValuePair<string, string>> { new("nonce", nonce.ToString(CultureInfo.InvariantCulture)) };
            if (parameters is not null) data.AddRange(parameters);
            var postData = string.Join("&", data.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));
            var path = $"/0/private/{method}";
            var signature = Sign(path, nonce.ToString(CultureInfo.InvariantCulture), postData, _options.ApiSecret!);

            using var req = new HttpRequestMessage(HttpMethod.Post, path)
            {
                Content = new StringContent(postData, Encoding.UTF8, "application/x-www-form-urlencoded"),
            };
            req.Headers.Add("API-Key", _options.ApiKey);
            req.Headers.Add("API-Sign", signature);
            using var resp = await _http.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode) throw new KrakenApiException($"HTTP {(int)resp.StatusCode} sur {method}");
            return ParseResult(body, method);
        }
        finally { _privateGate.Release(); }
    }

    private long NextNonce()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() * 1000;
        while (true)
        {
            var last = Interlocked.Read(ref _lastNonce);
            var next = Math.Max(now, last + 1);
            if (Interlocked.CompareExchange(ref _lastNonce, next, last) == last) return next;
        }
    }

    /// <summary>Signature Kraken : HMAC-SHA512(base64decode(secret), path + SHA256(nonce + postdata)).</summary>
    public static string Sign(string path, string nonce, string postData, string base64Secret)
    {
        var sha = SHA256.HashData(Encoding.UTF8.GetBytes(nonce + postData));
        var pathBytes = Encoding.UTF8.GetBytes(path);
        var message = new byte[pathBytes.Length + sha.Length];
        Buffer.BlockCopy(pathBytes, 0, message, 0, pathBytes.Length);
        Buffer.BlockCopy(sha, 0, message, pathBytes.Length, sha.Length);
        using var hmac = new HMACSHA512(Convert.FromBase64String(base64Secret));
        return Convert.ToBase64String(hmac.ComputeHash(message));
    }

    public static JsonElement ParseResult(string body, string method)
    {
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        if (root.TryGetProperty("error", out var errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
        {
            var msg = string.Join("; ", errors.EnumerateArray().Select(e => e.GetString()));
            throw new KrakenApiException($"Kraken {method} : {msg}");
        }
        if (!root.TryGetProperty("result", out var result))
            throw new KrakenApiException($"Réponse Kraken inattendue pour {method}");
        return result.Clone();
    }

    public static decimal Dec(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Number => e.GetDecimal(),
        JsonValueKind.String => decimal.Parse(e.GetString()!, NumberStyles.Float, CultureInfo.InvariantCulture),
        _ => 0m,
    };
}
