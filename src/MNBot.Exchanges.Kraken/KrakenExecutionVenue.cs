using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;

namespace MNBot.Exchanges.Kraken;

/// <summary>
/// Exécution RÉELLE sur Kraken (ordres au marché Spot, sans levier).
/// N'est instanciée que si Bot:Mode = Live ET MNBOT_LIVE_TRADING_ENABLED=true ; le moteur exige en plus
/// une confirmation manuelle dans le dashboard avant le premier ordre.
///
/// ATTENTION : ce module n'a pas pu être testé avec un compte réel pendant le développement.
/// Utilisez d'abord ValidateOrdersOnly=true (Kraken vérifie l'ordre sans l'exécuter).
/// </summary>
public sealed class KrakenExecutionVenue : IExecutionVenue
{
    private readonly KrakenClient _client;

    public KrakenExecutionVenue(KrakenClient client)
    {
        _client = client;
        if (!client.Options.HasCredentials)
            throw new InvalidOperationException("Mode réel impossible : clés API Kraken absentes.");
    }

    public TradingMode Mode => TradingMode.Live;

    public async Task<IReadOnlyDictionary<string, decimal>> GetBalancesAsync(CancellationToken ct = default)
    {
        var result = await _client.PrivateAsync("Balance", null, ct);
        var balances = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in result.EnumerateObject())
        {
            if (p.Name.Contains('.')) continue; // soldes en staking / earn : non utilisés
            var asset = KrakenSymbols.NormalizeAsset(p.Name);
            balances[asset] = balances.GetValueOrDefault(asset) + KrakenClient.Dec(p.Value);
        }
        return balances;
    }

    public async Task<OrderResult> SubmitMarketOrderAsync(OrderRequest req, InstrumentSpec instrument, Ticker reference, CancellationToken ct = default)
    {
        var volume = instrument.RoundQuantityDown(req.Quantity);
        var parameters = new Dictionary<string, string>
        {
            ["pair"] = instrument.ExchangeSymbol,
            ["type"] = req.Side == OrderSide.Buy ? "buy" : "sell",
            ["ordertype"] = "market",
            ["volume"] = volume.ToString(CultureInfo.InvariantCulture),
            ["oflags"] = "fciq",                     // frais prélevés en EUR
            ["userref"] = UserRef(req.ClientOrderId).ToString(CultureInfo.InvariantCulture),
        };
        if (_client.Options.ValidateOrdersOnly) parameters["validate"] = "true";

        var add = await _client.PrivateAsync("AddOrder", parameters, ct);
        if (_client.Options.ValidateOrdersOnly)
        {
            return new OrderResult(req.ClientOrderId, null, req.Symbol, req.Side, OrderStatus.Rejected, volume, 0, 0, 0, DateTime.UtcNow,
                "Mode validation : ordre vérifié par Kraken mais non exécuté.");
        }

        var txid = add.GetProperty("txid")[0].GetString()!;
        // Suivi de l'exécution
        for (var attempt = 0; attempt < 15; attempt++)
        {
            await Task.Delay(TimeSpan.FromSeconds(attempt == 0 ? 1 : 2), ct);
            var q = await _client.PrivateAsync("QueryOrders", new Dictionary<string, string> { ["txid"] = txid, ["trades"] = "false" }, ct);
            var o = q.GetProperty(txid);
            var status = o.GetProperty("status").GetString();
            var volExec = KrakenClient.Dec(o.GetProperty("vol_exec"));
            var price = KrakenClient.Dec(o.GetProperty("price"));
            var fee = KrakenClient.Dec(o.GetProperty("fee"));
            if (status == "closed")
                return new OrderResult(req.ClientOrderId, txid, req.Symbol, req.Side, OrderStatus.Filled, volume, volExec, price, fee, DateTime.UtcNow);
            if (status is "canceled" or "expired")
                return new OrderResult(req.ClientOrderId, txid, req.Symbol, req.Side,
                    volExec > 0 ? OrderStatus.Filled : OrderStatus.Rejected, volume, volExec, price, fee, DateTime.UtcNow,
                    volExec > 0 ? "Exécution partielle" : $"Ordre {status}");
        }
        throw new KrakenApiException($"Ordre {txid} toujours non exécuté après 30 s : vérification manuelle nécessaire.");
    }

    /// <summary>Référence numérique stable dérivée de l'identifiant client (traçabilité / anti-doublon).</summary>
    public static int UserRef(string clientOrderId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(clientOrderId));
        return BitConverter.ToInt32(hash, 0) & 0x7FFFFFFF;
    }
}
