namespace MNBot.Core.Domain;

/// <summary>Classes d'actifs prises en charge par l'architecture (seul Crypto est actif en V1).</summary>
public enum AssetClass { Crypto, Stock, Etf, Forex, Index }

public enum TradingMode { Paper, Live }

public enum OrderSide { Buy, Sell }

public enum Timeframe
{
    M1 = 1,
    M5 = 5,
    M15 = 15,
    M30 = 30,
    H1 = 60,
    H4 = 240,
    D1 = 1440,
}

public static class TimeframeExtensions
{
    public static TimeSpan ToTimeSpan(this Timeframe tf) => TimeSpan.FromMinutes((int)tf);
    public static int Minutes(this Timeframe tf) => (int)tf;

    public static string Label(this Timeframe tf) => tf switch
    {
        Timeframe.M1 => "1m", Timeframe.M5 => "5m", Timeframe.M15 => "15m", Timeframe.M30 => "30m",
        Timeframe.H1 => "1h", Timeframe.H4 => "4h", Timeframe.D1 => "1d", _ => ((int)tf) + "m",
    };

    public static Timeframe Parse(string s) => s.Trim().ToLowerInvariant() switch
    {
        "1m" => Timeframe.M1, "5m" => Timeframe.M5, "15m" => Timeframe.M15, "30m" => Timeframe.M30,
        "1h" or "60" => Timeframe.H1, "4h" or "240" => Timeframe.H4, "1d" or "1440" => Timeframe.D1,
        _ => throw new ArgumentException($"Unité de temps inconnue : {s}"),
    };

    /// <summary>Début (aligné UTC) de la bougie contenant l'instant donné.</summary>
    public static DateTime Floor(this Timeframe tf, DateTime utc)
    {
        var ticks = tf.ToTimeSpan().Ticks;
        return new DateTime(utc.Ticks - (utc.Ticks % ticks), DateTimeKind.Utc);
    }
}

/// <summary>Bougie japonaise. OpenTime est en UTC.</summary>
public sealed record Candle(DateTime OpenTime, decimal Open, decimal High, decimal Low, decimal Close, decimal Volume)
{
    public DateTime CloseTime(Timeframe tf) => OpenTime + tf.ToTimeSpan();
}

public sealed record Ticker(string Symbol, decimal Bid, decimal Ask, decimal Last, decimal Volume24h, DateTime TimeUtc)
{
    public decimal Mid => (Bid + Ask) / 2m;
    public decimal Spread => Ask - Bid;
    public decimal SpreadPct => Mid == 0 ? 0 : Spread / Mid;
}

public sealed record OrderBookLevel(decimal Price, decimal Quantity);

public sealed record OrderBook(string Symbol, IReadOnlyList<OrderBookLevel> Bids, IReadOnlyList<OrderBookLevel> Asks, DateTime TimeUtc);

/// <summary>Caractéristiques d'un instrument négociable (minimums, précisions).</summary>
public sealed record InstrumentSpec(
    string Symbol,          // symbole interne, ex. "BTC/EUR"
    string ExchangeSymbol,  // symbole de la plateforme, ex. "XBTEUR"
    string BaseAsset,       // ex. "XXBT"
    string QuoteAsset,      // ex. "ZEUR"
    decimal MinQuantity,
    decimal MinCost,
    int QuantityDecimals,
    int PriceDecimals,
    decimal TickSize,
    AssetClass AssetClass = AssetClass.Crypto)
{
    public decimal RoundQuantityDown(decimal qty)
    {
        var factor = Pow10(QuantityDecimals);
        return Math.Floor(qty * factor) / factor;
    }

    public decimal RoundPrice(decimal price)
    {
        if (TickSize <= 0) return Math.Round(price, PriceDecimals);
        return Math.Round(price / TickSize, MidpointRounding.AwayFromZero) * TickSize;
    }

    private static decimal Pow10(int n)
    {
        decimal r = 1m;
        for (var i = 0; i < n; i++) r *= 10m;
        return r;
    }
}

public sealed record OrderRequest(
    string ClientOrderId,
    string Symbol,
    OrderSide Side,
    decimal Quantity,
    string Reason);

public enum OrderStatus { Filled, Rejected, Pending }

public sealed record OrderResult(
    string ClientOrderId,
    string? ExchangeOrderId,
    string Symbol,
    OrderSide Side,
    OrderStatus Status,
    decimal RequestedQuantity,
    decimal FilledQuantity,
    decimal AveragePrice,
    decimal Fee,
    DateTime TimeUtc,
    string? Error = null)
{
    public decimal Notional => FilledQuantity * AveragePrice;
}

public enum PositionStatus { Open, Closed }

/// <summary>Position Spot longue (achat puis revente). Pas de vente à découvert.</summary>
public sealed class Position
{
    public long Id { get; set; }
    public string Symbol { get; set; } = "";
    public string StrategyId { get; set; } = "";
    public TradingMode Mode { get; set; }
    public PositionStatus Status { get; set; } = PositionStatus.Open;
    public decimal Quantity { get; set; }
    public decimal EntryPrice { get; set; }
    public decimal EntryFee { get; set; }
    public DateTime EntryTimeUtc { get; set; }
    public decimal StopLoss { get; set; }
    public decimal TakeProfit { get; set; }
    public decimal InitialRisk { get; set; }   // perte estimée (€) si le stop est touché, frais inclus
    public decimal? ExitPrice { get; set; }
    public decimal ExitFee { get; set; }
    public DateTime? ExitTimeUtc { get; set; }
    public string? ExitReason { get; set; }
    public string EntryOrderId { get; set; } = "";
    public string? ExitOrderId { get; set; }
    public string? EntryReason { get; set; }

    public decimal EntryCost => Quantity * EntryPrice + EntryFee;

    public decimal RealizedPnl => ExitPrice is null ? 0 : Quantity * ExitPrice.Value - ExitFee - EntryCost;

    /// <summary>P&amp;L latent estimé si l'on vendait au prix donné (frais de sortie estimés inclus).</summary>
    public decimal UnrealizedPnl(decimal price, decimal exitFeeRate) =>
        Quantity * price * (1 - exitFeeRate) - EntryCost;

    public decimal RMultiple => InitialRisk <= 0 ? 0 : RealizedPnl / InitialRisk;
}

public enum SignalAction { None, EnterLong, ExitLong }

public sealed record SignalCheck(string Name, bool Passed, string Detail);

public sealed class SignalRecord
{
    public long Id { get; set; }
    public DateTime TimeUtc { get; set; }
    public DateTime CandleTimeUtc { get; set; }
    public string Symbol { get; set; } = "";
    public string StrategyId { get; set; } = "";
    public SignalAction Action { get; set; }
    public decimal Price { get; set; }
    public decimal? StopLoss { get; set; }
    public decimal? TakeProfit { get; set; }
    public string Reason { get; set; } = "";
    public List<SignalCheck> Checks { get; set; } = new();
    public string? Outcome { get; set; } // exécuté, refusé par le risque, etc.
}

public enum AlertLevel { Info, Warning, Critical }

public sealed record Alert(long Id, DateTime TimeUtc, AlertLevel Level, string Category, string Message);
