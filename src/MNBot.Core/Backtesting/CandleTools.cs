using System.Collections;
using MNBot.Core.Domain;

namespace MNBot.Core.Backtesting;

public static class CandleTools
{
    /// <summary>
    /// Agrège des bougies (ex. 1h) en une unité supérieure (ex. 4h) alignée UTC.
    /// Une bougie agrégée n'est produite que si elle est complète (aucune bougie manquante), sauf <paramref name="allowPartial"/>.
    /// </summary>
    public static List<Candle> Aggregate(IReadOnlyList<Candle> source, Timeframe from, Timeframe to, bool allowPartial = false)
    {
        var result = new List<Candle>();
        if (source.Count == 0) return result;
        var ratio = to.Minutes() / from.Minutes();
        DateTime? bucket = null;
        decimal o = 0, h = 0, l = 0, c = 0, v = 0;
        var count = 0;
        foreach (var x in source)
        {
            var b = to.Floor(x.OpenTime);
            if (bucket != b)
            {
                if (bucket is not null && (allowPartial || count == ratio))
                    result.Add(new Candle(bucket.Value, o, h, l, c, v));
                bucket = b; o = x.Open; h = x.High; l = x.Low; c = x.Close; v = x.Volume; count = 1;
            }
            else
            {
                h = Math.Max(h, x.High); l = Math.Min(l, x.Low); c = x.Close; v += x.Volume; count++;
            }
        }
        if (bucket is not null && (allowPartial || count == ratio))
            result.Add(new Candle(bucket.Value, o, h, l, c, v));
        return result;
    }

    /// <summary>Ne garde que les bougies clôturées à l'instant donné.</summary>
    public static List<Candle> ClosedOnly(IEnumerable<Candle> candles, Timeframe tf, DateTime nowUtc) =>
        candles.Where(c => c.CloseTime(tf) <= nowUtc).ToList();
}

/// <summary>Vue en lecture seule sur le début d'une liste (sans copie), utilisée pour garantir l'absence de look-ahead.</summary>
public sealed class PrefixView<T> : IReadOnlyList<T>
{
    private readonly IReadOnlyList<T> _source;
    public PrefixView(IReadOnlyList<T> source, int count)
    {
        _source = source;
        Count = Math.Clamp(count, 0, source.Count);
    }
    public int Count { get; }
    public T this[int index] => (uint)index < (uint)Count ? _source[index] : throw new ArgumentOutOfRangeException(nameof(index));
    public IEnumerator<T> GetEnumerator() { for (var i = 0; i < Count; i++) yield return _source[i]; }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
