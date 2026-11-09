using MNBot.Core.Abstractions;
using MNBot.Core.Domain;

namespace MNBot.Core.Execution;

/// <summary>
/// Exécution simulée (paper trading) : aucun argent réel n'est engagé.
/// Achat au prix vendeur (ask) + glissement, vente au prix acheteur (bid) − glissement, frais taker déduits en EUR.
/// </summary>
public sealed class PaperExecutionVenue : IExecutionVenue
{
    private readonly object _lock = new();
    private readonly Dictionary<string, decimal> _balances = new(StringComparer.OrdinalIgnoreCase);
    private readonly decimal _feeRate;
    private readonly decimal _slippage;
    private readonly IClock _clock;
    private long _seq;

    public PaperExecutionVenue(decimal feeRate, decimal slippageRate, IClock? clock = null)
    {
        _feeRate = feeRate;
        _slippage = slippageRate;
        _clock = clock ?? new SystemClock();
    }

    public TradingMode Mode => TradingMode.Paper;

    public void SetBalances(IReadOnlyDictionary<string, decimal> balances)
    {
        lock (_lock)
        {
            _balances.Clear();
            foreach (var kv in balances) _balances[kv.Key] = kv.Value;
        }
    }

    public Task<IReadOnlyDictionary<string, decimal>> GetBalancesAsync(CancellationToken ct = default)
    {
        lock (_lock) return Task.FromResult<IReadOnlyDictionary<string, decimal>>(new Dictionary<string, decimal>(_balances));
    }

    public Task<OrderResult> SubmitMarketOrderAsync(OrderRequest req, InstrumentSpec instrument, Ticker reference, CancellationToken ct = default)
    {
        var (baseAsset, quoteAsset) = SymbolHelper.Split(req.Symbol);
        lock (_lock)
        {
            var now = _clock.UtcNow;
            OrderResult Reject(string why) => new(req.ClientOrderId, null, req.Symbol, req.Side, OrderStatus.Rejected,
                req.Quantity, 0, 0, 0, now, why);

            if (req.Quantity <= 0) return Task.FromResult(Reject("Quantité nulle."));
            if (req.Quantity < instrument.MinQuantity) return Task.FromResult(Reject("Quantité inférieure au minimum."));

            var id = $"PAPER-{Interlocked.Increment(ref _seq)}-{now:yyyyMMddHHmmss}";
            if (req.Side == OrderSide.Buy)
            {
                var price = reference.Ask * (1 + _slippage);
                var notional = req.Quantity * price;
                var fee = notional * _feeRate;
                var cash = _balances.GetValueOrDefault(quoteAsset);
                if (cash < notional + fee) return Task.FromResult(Reject($"Solde {quoteAsset} insuffisant ({cash:0.00} < {notional + fee:0.00})."));
                _balances[quoteAsset] = cash - notional - fee;
                _balances[baseAsset] = _balances.GetValueOrDefault(baseAsset) + req.Quantity;
                return Task.FromResult(new OrderResult(req.ClientOrderId, id, req.Symbol, req.Side, OrderStatus.Filled,
                    req.Quantity, req.Quantity, price, fee, now));
            }
            else
            {
                var held = _balances.GetValueOrDefault(baseAsset);
                if (held + 1e-12m < req.Quantity) return Task.FromResult(Reject($"Solde {baseAsset} insuffisant ({held} < {req.Quantity})."));
                var price = reference.Bid * (1 - _slippage);
                var notional = req.Quantity * price;
                var fee = notional * _feeRate;
                _balances[baseAsset] = held - req.Quantity;
                _balances[quoteAsset] = _balances.GetValueOrDefault(quoteAsset) + notional - fee;
                return Task.FromResult(new OrderResult(req.ClientOrderId, id, req.Symbol, req.Side, OrderStatus.Filled,
                    req.Quantity, req.Quantity, price, fee, now));
            }
        }
    }
}

public static class SymbolHelper
{
    /// <summary>"BTC/EUR" → ("BTC", "EUR").</summary>
    public static (string Base, string Quote) Split(string symbol)
    {
        var parts = symbol.Split('/');
        if (parts.Length != 2) throw new ArgumentException($"Symbole invalide : {symbol} (format attendu BASE/QUOTE).");
        return (parts[0].ToUpperInvariant(), parts[1].ToUpperInvariant());
    }
}
