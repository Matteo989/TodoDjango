using MNBot.Core.Domain;
using MNBot.Core.Indicators;

/// <summary>
/// Simulateur de portefeuille pour comparer des familles de robots populaires (grille, DCA, filtre de tendance,
/// rotation par momentum) avec les mêmes coûts : frais + glissement + demi-spread à chaque ordre.
/// Les décisions sont prises à la clôture (quotidienne ou horaire) et exécutées au prix d'ouverture suivant.
/// </summary>
public static class PortfolioLab
{
    public sealed record Result(string Name, decimal Final, decimal Cagr, decimal MaxDd, int Orders, decimal InMarket, decimal Fees);

    public static decimal CostRate = 0.001m + 0.0005m + 0.00025m;

    // ------------------------------------------------------------------ références

    public static Result Savings(DateTime from, DateTime to, decimal rate = 0.03m)
    {
        var years = (decimal)(to - from).TotalDays / 365m;
        var final = 100m * (decimal)Math.Pow(1 + (double)rate, (double)years);
        return new("Livret 3 %", final, rate, 0, 0, 0, 0);
    }

    /// <summary>Stratégie à pondérations quotidiennes : weights(date, index par actif) renvoie la part du capital par actif.</summary>
    public static Result RunWeights(string name, Dictionary<string, List<Candle>> daily, DateTime from, DateTime to,
        Func<int, Dictionary<string, decimal>> targetAt, decimal rebalanceThreshold = 0.05m)
    {
        var symbols = daily.Keys.ToList();
        var dates = daily.Values.SelectMany(c => c.Select(x => x.OpenTime)).Where(t => t >= from && t < to).Distinct().OrderBy(t => t).ToList();
        var index = symbols.ToDictionary(s => s, s => daily[s].Select((c, i) => (c.OpenTime, i)).ToDictionary(x => x.OpenTime, x => x.i));
        decimal cash = 100m, fees = 0, peak = 100m, maxDd = 0;
        var qty = symbols.ToDictionary(s => s, _ => 0m);
        Dictionary<string, decimal>? pending = null;
        int orders = 0, daysIn = 0;

        var lastKnown = symbols.ToDictionary(s => s, _ => 0m);
        // Actif sans cotation ce jour-là (pas encore listé ou retiré) : dernier prix connu
        decimal Price(string s, DateTime d, bool open) =>
            index[s].TryGetValue(d, out var i) ? (open ? daily[s][i].Open : lastKnown[s] = daily[s][i].Close) : lastKnown[s];

        foreach (var d in dates)
        {
            // exécution à l'ouverture des pondérations décidées la veille
            if (pending is not null)
            {
                var equityOpen = cash + symbols.Sum(s => qty[s] * Price(s, d, true));
                foreach (var s in symbols.OrderBy(s => pending.GetValueOrDefault(s) - (Price(s, d, true) * qty[s]) / Math.Max(equityOpen, 0.01m))) // ventes d'abord
                {
                    var px = Price(s, d, true);
                    if (px <= 0 || !index[s].ContainsKey(d)) continue;
                    var target = pending.GetValueOrDefault(s) * equityOpen;
                    var current = qty[s] * px;
                    var diff = target - current;
                    if (Math.Abs(diff) < rebalanceThreshold * equityOpen && !(target == 0 && current > 0)) continue;
                    if (Math.Abs(diff) < 1m) continue;
                    if (diff > 0) diff = Math.Min(diff, cash / (1 + CostRate));
                    var fee = Math.Abs(diff) * CostRate;
                    qty[s] += diff / px;
                    cash -= diff + fee;
                    fees += fee;
                    orders++;
                }
                pending = null;
            }
            var equity = cash + symbols.Sum(s => qty[s] * Price(s, d, false));
            if (symbols.Any(s => qty[s] * Price(s, d, false) > 1)) daysIn++;
            peak = Math.Max(peak, equity);
            maxDd = Math.Max(maxDd, (peak - equity) / peak);
            // décision à la clôture
            var idx = dates.IndexOf(d);
            pending = targetAt(idx) is var w ? w : null;
            _ = idx;
        }
        var finalEq = cash + symbols.Sum(s => qty[s] * Price(s, dates[^1], false));
        return Summarize(name, finalEq, from, to, maxDd, orders, (decimal)daysIn / dates.Count, fees);
    }

    public static Result Summarize(string name, decimal final, DateTime from, DateTime to, decimal maxDd, int orders, decimal inMarket, decimal fees)
    {
        var years = (to - from).TotalDays / 365.0;
        var cagr = final <= 0 ? -1m : (decimal)(Math.Pow((double)final / 100.0, 1.0 / years) - 1);
        return new(name, final, cagr, maxDd, orders, inMarket, fees);
    }

    /// <summary>Construit une fonction de pondérations à partir d'une règle par date (avec accès aux bougies clôturées).</summary>
    public static Func<int, Dictionary<string, decimal>> Rule(Dictionary<string, List<Candle>> daily, DateTime from, DateTime to,
        Func<DateTime, Func<string, int>, Dictionary<string, decimal>> rule)
    {
        var dates = daily.Values.SelectMany(c => c.Select(x => x.OpenTime)).Where(t => t >= from && t < to).Distinct().OrderBy(t => t).ToList();
        var idx = daily.ToDictionary(kv => kv.Key, kv => kv.Value.Select((c, i) => (c.OpenTime, i)).ToDictionary(x => x.OpenTime, x => x.i));
        return i =>
        {
            var d = dates[i];
            return rule(d, s => idx[s].TryGetValue(d, out var k) ? k : -1);
        };
    }

    // ------------------------------------------------------------------ robots horaires (grille, DCA)

    /// <summary>
    /// Bot de grille « suiveur » (type Pionex/Binance) : grille géométrique ±range autour du prix, recentrée quand le prix
    /// sort de la grille. Chaque niveau croisé à la baisse achète une part, à la hausse revend la part achetée au niveau inférieur.
    /// </summary>
    public static Result Grid(string name, List<Candle> h1, DateTime from, DateTime to, decimal budget = 70m, decimal rangePct = 0.15m, int levels = 20, bool sellOnDownExit = true)
    {
        var bars = h1.Where(c => c.OpenTime >= from && c.OpenTime < to).ToList();
        decimal cash = 100m, qty = 0, fees = 0, peak = 100m, maxDd = 0;
        int orders = 0, hoursIn = 0;
        var perLevel = budget / levels;
        decimal[] grid = Array.Empty<decimal>();
        var holding = new Dictionary<int, decimal>(); // niveau d'achat → quantité
        void Build(decimal center)
        {
            // on solde les positions de la grille précédente au prix courant
            if (qty > 0) { var fee = qty * center * CostRate; cash += qty * center - fee; fees += fee; orders++; qty = 0; holding.Clear(); }
            grid = Enumerable.Range(0, levels + 1).Select(k => center * (1 - rangePct) * (decimal)Math.Pow((double)((1 + rangePct) / (1 - rangePct)), (double)k / levels)).ToArray();
        }
        int LevelOf(decimal p) { var k = 0; while (k < grid.Length - 1 && grid[k + 1] <= p) k++; return k; }
        Build(bars[0].Open);
        var last = LevelOf(bars[0].Open);
        foreach (var b in bars)
        {
            var path = b.Close >= b.Open ? new[] { b.Open, b.Low, b.High, b.Close } : new[] { b.Open, b.High, b.Low, b.Close };
            foreach (var p in path)
            {
                var below = p < grid[0] * 0.97m;
                if ((below && (sellOnDownExit || qty == 0)) || p > grid[^1] * 1.03m) { Build(p); last = LevelOf(p); continue; }
                if (below) continue; // on garde les achats et on attend le retour du prix dans la grille
                var lv = LevelOf(p);
                while (lv < last) // baisse : achat sur chaque ligne franchie
                {
                    var line = last; last--;
                    var px = grid[line];
                    if (!holding.ContainsKey(line) && cash - perLevel * (1 + CostRate) >= 100m - budget)
                    {
                        var q = perLevel / px; var fee = perLevel * CostRate;
                        cash -= perLevel + fee; fees += fee; qty += q; holding[line] = q; orders++;
                    }
                }
                while (lv > last) // hausse : revente un niveau au-dessus du prix d'achat
                {
                    var line = last + 1;
                    if (holding.TryGetValue(last, out var q))
                    {
                        var px = grid[line]; var fee = q * px * CostRate;
                        cash += q * px - fee; fees += fee; qty -= q; holding.Remove(last); orders++;
                    }
                    last++;
                }
            }
            var eq = cash + qty * b.Close;
            if (qty > 0) hoursIn++;
            peak = Math.Max(peak, eq); maxDd = Math.Max(maxDd, (peak - eq) / peak);
        }
        return Summarize(name, cash + qty * bars[^1].Close, from, to, maxDd, orders, (decimal)hoursIn / bars.Count, fees);
    }

    /// <summary>
    /// Bot DCA type 3Commas : ordre de base, puis ordres de sécurité de plus en plus gros à chaque baisse,
    /// revente de tout dès +TP au-dessus du prix moyen. Aucun stop-loss (c'est ainsi que fonctionnent ces bots).
    /// </summary>
    public static Result Dca(string name, List<Candle> h1, DateTime from, DateTime to, decimal baseOrder = 5m, decimal step = 0.025m, decimal scale = 1.5m, int safetyOrders = 5, decimal tp = 0.02m)
    {
        var bars = h1.Where(c => c.OpenTime >= from && c.OpenTime < to).ToList();
        decimal cash = 100m, qty = 0, cost = 0, fees = 0, peak = 100m, maxDd = 0, lastBuy = 0;
        int orders = 0, filled = 0, hoursIn = 0;
        foreach (var b in bars)
        {
            if (qty == 0)
            {
                var amt = baseOrder; var fee = amt * CostRate;
                cash -= amt + fee; fees += fee; qty = amt / b.Open; cost = amt; lastBuy = b.Open; filled = 0; orders++;
            }
            var avg = cost / qty;
            if (b.High >= avg * (1 + tp))
            {
                var px = avg * (1 + tp); var fee = qty * px * CostRate;
                cash += qty * px - fee; fees += fee; qty = 0; cost = 0; orders++;
            }
            else
            {
                while (filled < safetyOrders && b.Low <= lastBuy * (1 - step))
                {
                    var px = lastBuy * (1 - step);
                    var amt = baseOrder * (decimal)Math.Pow((double)scale, filled + 1);
                    if (cash < amt * (1 + CostRate) + 30m) break; // la réserve de 30 € n'est jamais utilisée
                    var fee = amt * CostRate;
                    cash -= amt + fee; fees += fee; qty += amt / px; cost += amt; lastBuy = px; filled++; orders++;
                }
            }
            var eq = cash + qty * b.Close;
            if (qty > 0) hoursIn++;
            peak = Math.Max(peak, eq); maxDd = Math.Max(maxDd, (peak - eq) / peak);
        }
        return Summarize(name, cash + qty * bars[^1].Close, from, to, maxDd, orders, (decimal)hoursIn / bars.Count, fees);
    }

    // ------------------------------------------------------------------ indicateurs utilitaires

    public static decimal? SmaAt(List<Candle> c, int i, int n)
    {
        if (i < n - 1) return null;
        decimal s = 0;
        for (var k = i - n + 1; k <= i; k++) s += c[k].Close;
        return s / n;
    }

    public static decimal? ReturnAt(List<Candle> c, int i, int n) => i < n ? null : c[i].Close / c[i - n].Close - 1;
}
