using System.Globalization;
using System.Text.Json;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;

namespace MNBot.Exchanges.Binance;

/// <summary>
/// Exécution RÉELLE sur Binance Spot (ordres au marché, sans levier ni marge).
/// N'est instanciée que si Bot:Mode = Live ET MNBOT_LIVE_TRADING_ENABLED=true ; le moteur exige en plus une
/// confirmation manuelle dans le dashboard avant le premier ordre.
///
/// ATTENTION : ce module n'a pas pu être testé avec un compte réel pendant le développement.
/// Commencez par ValidateOrdersOnly=true (Binance vérifie l'ordre sans l'exécuter).
/// </summary>
public sealed class BinanceExecutionVenue : IExecutionVenue
{
    private readonly BinanceClient _client;
    private readonly decimal _estimatedFeeRate;

    public BinanceExecutionVenue(BinanceClient client, decimal estimatedFeeRate)
    {
        _client = client;
        _estimatedFeeRate = estimatedFeeRate;
        if (!client.Options.HasCredentials)
            throw new InvalidOperationException("Mode réel impossible : clés API Binance absentes.");
    }

    public TradingMode Mode => TradingMode.Live;

    public async Task<IReadOnlyDictionary<string, decimal>> GetBalancesAsync(CancellationToken ct = default)
    {
        var json = await _client.SignedAsync(HttpMethod.Get, "/api/v3/account", new Dictionary<string, string> { ["omitZeroBalances"] = "true" }, ct);
        if (json.TryGetProperty("canTrade", out var canTrade) && !canTrade.GetBoolean())
            throw new BinanceApiException("La clé API Binance n'a pas le droit de trader (activez « Spot & Margin Trading »).");
        var balances = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var b in json.GetProperty("balances").EnumerateArray())
            balances[b.GetProperty("asset").GetString()!] = BinanceClient.Dec(b.GetProperty("free"));
        return balances;
    }

    public async Task<OrderResult> SubmitMarketOrderAsync(OrderRequest req, InstrumentSpec instrument, Ticker reference, CancellationToken ct = default)
    {
        var qty = instrument.RoundQuantityDown(req.Quantity);
        var clientId = SafeClientId(req.ClientOrderId);
        var p = new Dictionary<string, string>
        {
            ["symbol"] = instrument.ExchangeSymbol,
            ["side"] = req.Side == OrderSide.Buy ? "BUY" : "SELL",
            ["type"] = "MARKET",
            ["quantity"] = qty.ToString(CultureInfo.InvariantCulture),
            ["newClientOrderId"] = clientId,
            ["newOrderRespType"] = "FULL",
        };

        if (_client.Options.ValidateOrdersOnly)
        {
            await _client.SignedAsync(HttpMethod.Post, "/api/v3/order/test", p, ct);
            return new OrderResult(req.ClientOrderId, null, req.Symbol, req.Side, OrderStatus.Rejected, qty, 0, 0, 0, DateTime.UtcNow,
                "Mode validation : ordre vérifié par Binance mais non exécuté.");
        }

        JsonElement json;
        try
        {
            json = await _client.SignedAsync(HttpMethod.Post, "/api/v3/order", p, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            // Réponse perdue : on vérifie si l'ordre a malgré tout été exécuté avant de conclure (évite les doublons).
            json = await _client.SignedAsync(HttpMethod.Get, "/api/v3/order",
                new Dictionary<string, string> { ["symbol"] = instrument.ExchangeSymbol, ["origClientOrderId"] = clientId }, ct);
        }
        return ParseOrder(req, instrument, json, _estimatedFeeRate);
    }

    /// <summary>Interprète la réponse d'un ordre (exécutions, frais) en tenant compte de l'actif dans lequel les frais sont prélevés.</summary>
    public static OrderResult ParseOrder(OrderRequest req, InstrumentSpec instrument, JsonElement json, decimal estimatedFeeRate)
    {
        var status = json.GetProperty("status").GetString();
        var executed = BinanceClient.Dec(json.GetProperty("executedQty"));
        var quote = BinanceClient.Dec(json.GetProperty("cummulativeQuoteQty"));
        var orderId = json.GetProperty("orderId").GetInt64().ToString(CultureInfo.InvariantCulture);
        if (executed <= 0)
            return new OrderResult(req.ClientOrderId, orderId, req.Symbol, req.Side, OrderStatus.Rejected, req.Quantity, 0, 0, 0, DateTime.UtcNow, $"Ordre non exécuté (statut {status}).");

        var avg = quote / executed;
        decimal feeQuote = 0, feeBase = 0, feeOther = 0;
        if (json.TryGetProperty("fills", out var fills))
        {
            foreach (var f in fills.EnumerateArray())
            {
                var c = BinanceClient.Dec(f.GetProperty("commission"));
                var asset = f.GetProperty("commissionAsset").GetString();
                if (asset == instrument.QuoteAsset) feeQuote += c;
                else if (asset == instrument.BaseAsset) feeBase += c;
                else feeOther += c; // ex. BNB
            }
        }
        else feeOther = 1; // détail des frais inconnu (ordre retrouvé après une réponse perdue)

        // Quantité réellement détenue : si les frais sont prélevés sur l'actif acheté, on en reçoit un peu moins.
        var netQty = req.Side == OrderSide.Buy ? executed - feeBase : executed;
        var feeEur = feeQuote + feeBase * avg + (feeOther > 0 ? quote * estimatedFeeRate : 0);
        return new OrderResult(req.ClientOrderId, orderId, req.Symbol, req.Side,
            status is "FILLED" or "PARTIALLY_FILLED" or "EXPIRED" ? OrderStatus.Filled : OrderStatus.Rejected,
            req.Quantity, netQty, avg, feeEur, DateTime.UtcNow, status == "FILLED" ? null : $"Exécution partielle (statut {status}).");
    }

    /// <summary>Binance accepte au plus 36 caractères [A-Za-z0-9._:/-] pour l'identifiant client.</summary>
    public static string SafeClientId(string id)
    {
        var clean = new string(id.Where(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-' or ':' or '/').ToArray());
        if (clean.Length <= 36) return clean;
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(id)))[..10].ToLowerInvariant();
        return clean[..25] + "-" + hash;
    }
}
