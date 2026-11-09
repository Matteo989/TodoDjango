using System.Globalization;
using System.Text;
using MNBot.Core.Domain;
using MNBot.Core.Indicators;

namespace MNBot.Core.Analysis;

public sealed record MarketSummary(
    string Symbol,
    decimal Price,
    string Trend4h,
    string Trend1h,
    string Momentum,
    decimal? Rsi,
    decimal? AtrPct,
    string Volatility,
    decimal Change24hPct,
    decimal? DistanceToEma20Pct,
    string VolumeState,
    IReadOnlyList<string> Anomalies,
    string Text);

public sealed record PerformanceReview(
    int Trades,
    decimal WinRate,
    decimal NetPnl,
    decimal TotalFees,
    decimal ProfitFactor,
    decimal AverageR,
    IReadOnlyList<string> Observations,
    IReadOnlyList<string> Suggestions);

/// <summary>
/// Module d'analyse complémentaire (« IA » déterministe). Il observe et explique, mais
/// n'a AUCUN accès à l'exécution des ordres ni aux règles de risque : il ne peut que produire du texte.
/// </summary>
public static class MarketAnalyst
{
    private static readonly CultureInfo Fr = CultureInfo.GetCultureInfo("fr-FR");

    public static MarketSummary Summarize(string symbol, IReadOnlyList<Candle> h1, IReadOnlyList<Candle> h4, Ticker? ticker)
    {
        var anomalies = new List<string>();
        if (h1.Count < 60 || h4.Count < 210)
        {
            return new MarketSummary(symbol, ticker?.Last ?? h1.LastOrDefault()?.Close ?? 0, "inconnue", "inconnue", "inconnu",
                null, null, "inconnue", 0, null, "inconnu", new[] { "Historique insuffisant pour l'analyse." },
                $"{symbol} : historique insuffisant pour produire une analyse fiable.");
        }

        var c1 = h1.Select(c => c.Close).ToArray();
        var ema20 = Ta.Ema(c1, 20)[^1]!.Value;
        var ema50 = Ta.Ema(c1, 50)[^1]!.Value;
        var rsiArr = Ta.Rsi(c1, 14);
        var rsi = rsiArr[^1];
        var atr = Ta.Atr(h1.Select(c => c.High).ToArray(), h1.Select(c => c.Low).ToArray(), c1, 14)[^1];
        var c4 = h4.Select(c => c.Close).ToArray();
        var ema200_4h = Ta.Ema(c4, 200)[^1]!.Value;

        var price = ticker?.Last ?? c1[^1];
        var trend4h = c4[^1] > ema200_4h ? "haussière" : "baissière";
        var trend1h = ema20 > ema50 ? "haussière" : "baissière";
        var momentum = rsi switch
        {
            null => "inconnu",
            > 70 => "suracheté",
            > 55 => "positif",
            >= 45 => "neutre",
            >= 30 => "négatif",
            _ => "survendu",
        };
        var atrPct = atr is { } a && price > 0 ? a / price : (decimal?)null;
        var volatility = atrPct switch
        {
            null => "inconnue",
            < 0.004m => "faible",
            < 0.01m => "modérée",
            _ => "élevée",
        };
        var change24 = h1.Count >= 25 && c1[^25] != 0 ? (c1[^1] - c1[^25]) / c1[^25] : 0;
        var dist = ema20 == 0 ? (decimal?)null : (price - ema20) / ema20;

        var vols = h1.Select(c => c.Volume).ToArray();
        var volAvg = Ta.Sma(vols, 20)[^2];
        var volState = volAvg is { } va && va > 0
            ? (vols[^1] > va * 2.5m ? "très élevé" : vols[^1] > va ? "supérieur à la moyenne" : "inférieur à la moyenne")
            : "inconnu";

        // Anomalies
        if (volAvg is { } v2 && v2 > 0 && vols[^1] > v2 * 4) anomalies.Add("Volume exceptionnel sur la dernière bougie (×4 la moyenne).");
        if (atr is { } at && Math.Abs(h1[^1].Close - h1[^1].Open) > at * 3) anomalies.Add("Bougie 1h de taille anormale (> 3 ATR).");
        for (var i = 1; i < h1.Count; i++)
            if (h1[i].OpenTime - h1[i - 1].OpenTime > TimeSpan.FromHours(1) && i > h1.Count - 48)
            { anomalies.Add($"Trou dans les données 1h vers {h1[i].OpenTime:dd/MM HH:mm} UTC."); break; }
        if (ticker is not null && ticker.SpreadPct > 0.002m) anomalies.Add($"Spread inhabituellement large ({ticker.SpreadPct:P2}).");

        var sb = new StringBuilder();
        sb.Append($"{symbol} cote {price.ToString("N2", Fr)} € ({(change24 >= 0 ? "+" : "")}{(change24 * 100).ToString("N2", Fr)} % sur 24h). ");
        sb.Append($"Tendance de fond (4h) {trend4h}, tendance courte (1h) {trend1h}. ");
        sb.Append($"Momentum {momentum}{(rsi is { } r ? $" (RSI {r.ToString("N1", Fr)})" : "")}, volatilité {volatility}");
        if (atrPct is { } ap) sb.Append($" (ATR ≈ {(ap * 100).ToString("N2", Fr)} % du prix)");
        sb.Append(". ");
        if (dist is { } d) sb.Append($"Le prix est à {(d * 100).ToString("N2", Fr)} % de l'EMA20 1h. ");
        if (trend4h == "haussière" && trend1h == "haussière")
            sb.Append(dist is { } dd && dd < 0.003m ? "Contexte favorable : repli en cours vers l'EMA20, à surveiller." : "Contexte favorable mais le prix est éloigné de la zone d'entrée (EMA20).");
        else if (trend4h == "baissière")
            sb.Append("La stratégie reste à l'écart : la tendance de fond n'est pas haussière.");
        else
            sb.Append("Tendance courte défavorable : pas d'entrée tant que l'EMA20 est sous l'EMA50.");

        return new MarketSummary(symbol, price, trend4h, trend1h, momentum, rsi, atrPct, volatility, change24, dist, volState, anomalies, sb.ToString());
    }

    public static string ExplainSignal(SignalRecord s)
    {
        var sb = new StringBuilder();
        sb.AppendLine(s.Action switch
        {
            SignalAction.EnterLong => $"Signal d'ACHAT sur {s.Symbol} à la clôture de la bougie de {s.CandleTimeUtc:dd/MM HH:mm} UTC.",
            SignalAction.ExitLong => $"Signal de VENTE sur {s.Symbol}.",
            _ => $"Aucun signal sur {s.Symbol} pour la bougie de {s.CandleTimeUtc:dd/MM HH:mm} UTC.",
        });
        foreach (var c in s.Checks)
            sb.AppendLine($"{(c.Passed ? "✔" : "✘")} {c.Name} — {c.Detail}");
        if (s.StopLoss is { } sl && s.TakeProfit is { } tp && s.Action == SignalAction.EnterLong)
            sb.AppendLine($"Stop-loss prévu {sl.ToString("N2", Fr)} €, objectif {tp.ToString("N2", Fr)} €.");
        if (!string.IsNullOrEmpty(s.Outcome)) sb.AppendLine($"Décision du moteur : {s.Outcome}");
        return sb.ToString().TrimEnd();
    }

    public static PerformanceReview ReviewPerformance(IReadOnlyList<Position> closed)
    {
        var obs = new List<string>();
        var sug = new List<string>();
        var n = closed.Count;
        if (n == 0)
        {
            return new PerformanceReview(0, 0, 0, 0, 0, 0,
                new[] { "Aucune transaction clôturée pour l'instant." },
                new[] { "Laisser tourner le paper trading : au moins 20 à 30 transactions sont nécessaires avant toute conclusion." });
        }
        var wins = closed.Count(p => p.RealizedPnl > 0);
        var net = closed.Sum(p => p.RealizedPnl);
        var fees = closed.Sum(p => p.EntryFee + p.ExitFee);
        var gw = closed.Where(p => p.RealizedPnl > 0).Sum(p => p.RealizedPnl);
        var gl = -closed.Where(p => p.RealizedPnl <= 0).Sum(p => p.RealizedPnl);
        var pf = gl == 0 ? (gw > 0 ? 999 : 0) : gw / gl;
        var avgR = closed.Average(p => p.RMultiple);
        var wr = (decimal)wins / n;

        obs.Add($"{n} transaction(s), taux de réussite {wr:P0}, résultat net {net.ToString("N2", Fr)} €, profit factor {pf:0.00}.");
        obs.Add($"Frais payés : {fees.ToString("N2", Fr)} €{(gw > 0 ? $" ({fees / Math.Max(gw, 0.01m):P0} des gains bruts)" : "")}.");
        var byReason = closed.GroupBy(p => (p.ExitReason ?? "?").Split(' ')[0]).Select(g => $"{g.Key} : {g.Count()}");
        obs.Add("Sorties : " + string.Join(", ", byReason) + ".");

        if (n < 20) sug.Add("Échantillon encore trop petit (< 20 transactions) : les statistiques ne sont pas significatives.");
        if (gw > 0 && fees / gw > 0.3m) sug.Add("Les frais consomment une part importante des gains : envisager des objectifs plus larges (stop/TP en ATR plus grands) ou des ordres limites (frais maker plus faibles). À valider par backtest.");
        if (wr < 0.3m && n >= 10) sug.Add("Taux de réussite faible : tester par backtest un filtre de tendance plus strict ou un RSI de confirmation plus élevé.");
        if (pf < 1 && n >= 20) sug.Add("Profit factor < 1 sur un échantillon suffisant : la stratégie n'est pas rentable dans ces conditions. Ne pas passer en réel.");
        if (pf >= 1.3m && n >= 30) sug.Add("Résultats encourageants : poursuivre le paper trading pour confirmer la stabilité avant tout passage en réel.");
        sug.Add("Toute modification de paramètres doit être testée par backtest (in-sample et out-of-sample) puis validée manuellement avant usage.");

        return new PerformanceReview(n, wr, net, fees, pf, avgR, obs, sug);
    }
}
