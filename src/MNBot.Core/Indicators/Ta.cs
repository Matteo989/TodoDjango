namespace MNBot.Core.Indicators;

/// <summary>
/// Indicateurs techniques. Chaque fonction renvoie un tableau aligné sur l'entrée ;
/// les valeurs non encore « chauffées » sont null. Aucune valeur n'utilise de donnée future.
/// </summary>
public static class Ta
{
    /// <summary>Moyenne mobile simple.</summary>
    public static decimal?[] Sma(IReadOnlyList<decimal> values, int period)
    {
        var result = new decimal?[values.Count];
        if (period <= 0) throw new ArgumentOutOfRangeException(nameof(period));
        decimal sum = 0;
        for (var i = 0; i < values.Count; i++)
        {
            sum += values[i];
            if (i >= period) sum -= values[i - period];
            if (i >= period - 1) result[i] = sum / period;
        }
        return result;
    }

    /// <summary>Moyenne mobile exponentielle, initialisée par la SMA des <paramref name="period"/> premières valeurs.</summary>
    public static decimal?[] Ema(IReadOnlyList<decimal> values, int period)
    {
        var result = new decimal?[values.Count];
        if (period <= 0) throw new ArgumentOutOfRangeException(nameof(period));
        if (values.Count < period) return result;
        var k = 2m / (period + 1);
        decimal seed = 0;
        for (var i = 0; i < period; i++) seed += values[i];
        var ema = seed / period;
        result[period - 1] = ema;
        for (var i = period; i < values.Count; i++)
        {
            ema = (values[i] - ema) * k + ema;
            result[i] = ema;
        }
        return result;
    }

    /// <summary>RSI de Wilder.</summary>
    public static decimal?[] Rsi(IReadOnlyList<decimal> closes, int period = 14)
    {
        var result = new decimal?[closes.Count];
        if (closes.Count <= period) return result;
        decimal gain = 0, loss = 0;
        for (var i = 1; i <= period; i++)
        {
            var d = closes[i] - closes[i - 1];
            if (d > 0) gain += d; else loss -= d;
        }
        var avgGain = gain / period;
        var avgLoss = loss / period;
        result[period] = ToRsi(avgGain, avgLoss);
        for (var i = period + 1; i < closes.Count; i++)
        {
            var d = closes[i] - closes[i - 1];
            var g = d > 0 ? d : 0;
            var l = d < 0 ? -d : 0;
            avgGain = (avgGain * (period - 1) + g) / period;
            avgLoss = (avgLoss * (period - 1) + l) / period;
            result[i] = ToRsi(avgGain, avgLoss);
        }
        return result;
    }

    private static decimal ToRsi(decimal avgGain, decimal avgLoss)
    {
        if (avgLoss == 0) return avgGain == 0 ? 50m : 100m;
        var rs = avgGain / avgLoss;
        return 100m - 100m / (1 + rs);
    }

    /// <summary>True Range.</summary>
    public static decimal[] TrueRange(IReadOnlyList<decimal> high, IReadOnlyList<decimal> low, IReadOnlyList<decimal> close)
    {
        var tr = new decimal[high.Count];
        for (var i = 0; i < high.Count; i++)
        {
            var hl = high[i] - low[i];
            if (i == 0) { tr[i] = hl; continue; }
            var hc = Math.Abs(high[i] - close[i - 1]);
            var lc = Math.Abs(low[i] - close[i - 1]);
            tr[i] = Math.Max(hl, Math.Max(hc, lc));
        }
        return tr;
    }

    /// <summary>Average True Range (lissage de Wilder).</summary>
    public static decimal?[] Atr(IReadOnlyList<decimal> high, IReadOnlyList<decimal> low, IReadOnlyList<decimal> close, int period = 14)
    {
        var result = new decimal?[high.Count];
        if (high.Count <= period) return result;
        var tr = TrueRange(high, low, close);
        decimal sum = 0;
        for (var i = 1; i <= period; i++) sum += tr[i];
        var atr = sum / period;
        result[period] = atr;
        for (var i = period + 1; i < high.Count; i++)
        {
            atr = (atr * (period - 1) + tr[i]) / period;
            result[i] = atr;
        }
        return result;
    }
}
