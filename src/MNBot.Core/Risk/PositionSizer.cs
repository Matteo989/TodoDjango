using System.Globalization;
using MNBot.Core.Domain;

namespace MNBot.Core.Risk;

public sealed record SizingResult(
    bool Accepted,
    decimal Quantity,
    decimal Notional,
    decimal EstimatedFees,
    decimal NetRisk,
    decimal NetReward,
    string? RejectReason)
{
    public decimal NetRewardRisk => NetRisk <= 0 ? 0 : NetReward / NetRisk;

    public static SizingResult Reject(string reason) => new(false, 0, 0, 0, 0, 0, reason);
}

/// <summary>
/// Calcul de la taille de position à partir du stop-loss : la perte si le stop est touché
/// (écart de prix + frais d'entrée et de sortie + glissement) ne doit pas dépasser le risque autorisé.
/// Refuse la transaction si les minimums de la plateforme ou les frais la rendent non pertinente.
/// </summary>
public static class PositionSizer
{
    public static SizingResult Calculate(
        decimal entryPrice,
        decimal stopLoss,
        decimal takeProfit,
        InstrumentSpec instrument,
        decimal availableCapital,
        RiskSettings settings,
        decimal? riskBudget = null)
    {
        var risk = Math.Min(riskBudget ?? settings.RiskPerTrade, settings.RiskPerTrade);
        if (risk <= 0) return SizingResult.Reject("Aucun budget de risque disponible.");
        if (entryPrice <= 0 || stopLoss <= 0) return SizingResult.Reject("Prix invalides.");
        if (stopLoss >= entryPrice) return SizingResult.Reject("Le stop-loss doit être sous le prix d'entrée (position longue).");
        if (takeProfit <= entryPrice) return SizingResult.Reject("Le take-profit doit être au-dessus du prix d'entrée.");
        if (availableCapital <= 0) return SizingResult.Reject("Aucun capital disponible pour trader.");

        var cost = settings.TakerFeeRate + settings.SlippageRate;
        // Perte par unité si le stop est touché, coûts compris.
        var lossPerUnit = (entryPrice - stopLoss) + entryPrice * cost + stopLoss * cost;
        // Gain net par unité si l'objectif est atteint, coûts compris.
        var gainPerUnit = (takeProfit - entryPrice) - entryPrice * cost - takeProfit * cost;
        if (gainPerUnit <= 0)
            return SizingResult.Reject("Les frais et le glissement absorbent tout le gain potentiel.");

        var qtyByRisk = risk / lossPerUnit;
        var qtyByCapital = availableCapital / (entryPrice * (1 + cost));
        var qty = instrument.RoundQuantityDown(Math.Min(qtyByRisk, qtyByCapital));

        if (qty < instrument.MinQuantity)
        {
            var minRisk = instrument.MinQuantity * lossPerUnit;
            var minCost = instrument.MinQuantity * entryPrice;
            if (minCost > availableCapital)
                return SizingResult.Reject($"Quantité minimale ({instrument.MinQuantity.ToString(CultureInfo.InvariantCulture)}) trop coûteuse : {minCost:0.00} € > capital disponible {availableCapital:0.00} €.");
            return SizingResult.Reject($"Quantité minimale de la plateforme ({instrument.MinQuantity.ToString(CultureInfo.InvariantCulture)}) imposerait un risque de {minRisk:0.00} € > {risk:0.00} € autorisé.");
        }

        var notional = qty * entryPrice;
        if (notional < instrument.MinCost)
            return SizingResult.Reject($"Montant {notional:0.00} € inférieur au minimum de la plateforme ({instrument.MinCost:0.00} €).");

        var fees = notional * settings.TakerFeeRate + qty * takeProfit * settings.TakerFeeRate;
        var netRisk = qty * lossPerUnit;
        var netReward = qty * gainPerUnit;
        var grossReward = qty * (takeProfit - entryPrice);

        if (grossReward > 0 && fees / grossReward > settings.MaxFeeShareOfReward)
            return SizingResult.Reject($"Frais trop élevés : {fees:0.00} € soit {fees / grossReward:P0} du gain visé (max {settings.MaxFeeShareOfReward:P0}).")
                with { Quantity = qty, Notional = notional, EstimatedFees = fees, NetRisk = netRisk, NetReward = netReward };

        if (netReward / netRisk < settings.MinNetRewardRisk)
            return SizingResult.Reject($"Rapport gain/risque net {netReward / netRisk:0.00} inférieur au minimum {settings.MinNetRewardRisk:0.00}.")
                with { Quantity = qty, Notional = notional, EstimatedFees = fees, NetRisk = netRisk, NetReward = netReward };

        return new SizingResult(true, qty, notional, fees, netRisk, netReward, null);
    }
}
