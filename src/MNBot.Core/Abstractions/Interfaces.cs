using MNBot.Core.Domain;

namespace MNBot.Core.Abstractions;

/// <summary>
/// Source de données de marché (Market Data Engine). Une implémentation par plateforme :
/// Kraken aujourd'hui, d'autres connecteurs (actions, forex…) pourront être ajoutés sans toucher au moteur.
/// </summary>
public interface IMarketDataProvider
{
    string Name { get; }
    IReadOnlyCollection<AssetClass> SupportedAssetClasses { get; }

    Task<InstrumentSpec> GetInstrumentAsync(string symbol, CancellationToken ct = default);
    Task<Ticker> GetTickerAsync(string symbol, CancellationToken ct = default);
    Task<IReadOnlyList<Ticker>> GetTickersAsync(IEnumerable<string> symbols, CancellationToken ct = default);

    /// <summary>Bougies triées par date croissante. Peut inclure la bougie en cours (non clôturée).</summary>
    Task<IReadOnlyList<Candle>> GetCandlesAsync(string symbol, Timeframe timeframe, DateTime? sinceUtc = null, CancellationToken ct = default);

    Task<OrderBook> GetOrderBookAsync(string symbol, int depth = 10, CancellationToken ct = default);
}

/// <summary>
/// Lieu d'exécution des ordres (Execution Engine) : simulation (paper) ou compte réel.
/// </summary>
public interface IExecutionVenue
{
    TradingMode Mode { get; }

    /// <summary>Soldes disponibles par actif interne ("EUR", "BTC", "ETH").</summary>
    Task<IReadOnlyDictionary<string, decimal>> GetBalancesAsync(CancellationToken ct = default);

    /// <summary>Envoie un ordre au marché. <paramref name="reference"/> sert à simuler l'exécution en paper trading.</summary>
    Task<OrderResult> SubmitMarketOrderAsync(OrderRequest request, InstrumentSpec instrument, Ticker reference, CancellationToken ct = default);
}

/// <summary>Récepteur d'événements temps réel (dashboard via WebSocket, notifications).</summary>
public interface IEventSink
{
    void Publish(string type, object payload);
}

public sealed class NullEventSink : IEventSink
{
    public static readonly NullEventSink Instance = new();
    public void Publish(string type, object payload) { }
}

/// <summary>Persistance du moteur de trading.</summary>
public interface ITradingRepository
{
    Task UpsertCandlesAsync(string source, string symbol, Timeframe tf, IEnumerable<Candle> candles);
    Task<IReadOnlyList<Candle>> GetCandlesAsync(string source, string symbol, Timeframe tf, DateTime? fromUtc = null, DateTime? toUtc = null);

    Task<long> InsertPositionAsync(Position p);
    Task UpdatePositionAsync(Position p);
    Task<IReadOnlyList<Position>> GetOpenPositionsAsync(TradingMode mode);
    Task<IReadOnlyList<Position>> GetClosedPositionsAsync(TradingMode mode, DateTime? sinceUtc = null, int limit = 1000);

    Task<bool> OrderExistsAsync(string clientOrderId);
    Task InsertOrderAsync(OrderResult order, TradingMode mode, string reason);

    Task<long> InsertSignalAsync(SignalRecord s);
    Task<IReadOnlyList<SignalRecord>> GetSignalsAsync(int limit = 100, bool actionableOnly = false);

    Task<long> InsertAlertAsync(AlertLevel level, string category, string message);
    Task InsertEquitySnapshotAsync(TradingMode mode, DateTime timeUtc, decimal equity, decimal cash);

    Task<string?> GetStateAsync(string key);
    Task SetStateAsync(string key, string value);
}

/// <summary>Horloge injectable (permet les tests et le backtesting).</summary>
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}
