using MNBot.Core.Domain;
using MNBot.Core.Risk;

namespace MNBot.Tests;

public class RiskTests
{
    private static RiskSettings Settings() => new();

    [Fact]
    public void Sizer_LossAtStopNeverExceedsRiskPerTrade()
    {
        var s = Settings();
        // ETH à 2000 €, stop à 1900 € (5 %), objectif 2R
        var r = PositionSizer.Calculate(2000m, 1900m, 2200m, TestData.Eth, 70m, s);
        Assert.True(r.Accepted, r.RejectReason);
        Assert.True(r.NetRisk <= s.RiskPerTrade + 0.0001m, $"risque {r.NetRisk}");
        // Vérification indépendante de la perte au stop, coûts inclus
        var cost = s.TakerFeeRate + s.SlippageRate;
        var loss = r.Quantity * (2000m - 1900m) + r.Quantity * 2000m * cost + r.Quantity * 1900m * cost;
        Assert.True(loss <= 0.50m);
    }

    [Fact]
    public void Sizer_NeverUsesMoreThanAvailableCapital()
    {
        // Stop très serré → la taille calculée par le risque serait énorme : elle est plafonnée par le capital
        var r = PositionSizer.Calculate(2000m, 1999m, 2100m, TestData.Eth, 70m, Settings());
        if (r.Accepted) Assert.True(r.Notional <= 70m);
    }

    [Fact]
    public void Sizer_RejectsWhenFeesEatTheReward()
    {
        // BTC à 66 000 €, stop à 0,6 % → les frais (0,8 % aller-retour) dépassent le gain visé
        var r = PositionSizer.Calculate(66000m, 65600m, 66800m, TestData.Btc, 70m, Settings());
        Assert.False(r.Accepted);
        Assert.Contains("rais", r.RejectReason);
    }

    [Fact]
    public void Sizer_RejectsWhenMinimumQuantityWouldExceedRisk()
    {
        var s = Settings();
        s.RiskPerTrade = 0.05m;
        s.MaxDailyLoss = 1; s.MaxWeeklyLoss = 2;
        var r = PositionSizer.Calculate(66000m, 60000m, 78000m, TestData.Btc, 70m, s);
        Assert.False(r.Accepted);
        Assert.Contains("minimale", r.RejectReason);
    }

    [Fact]
    public void Sizer_RejectsInvalidStops()
    {
        Assert.False(PositionSizer.Calculate(100m, 101m, 110m, TestData.Eth, 70m, Settings()).Accepted);
        Assert.False(PositionSizer.Calculate(100m, 95m, 99m, TestData.Eth, 70m, Settings()).Accepted);
    }

    [Fact]
    public void AvailableCapital_IsCappedAndProtectsReserve()
    {
        var rm = new RiskManager(Settings());
        Assert.Equal(70m, rm.AvailableForTrading(100m, 0));
        Assert.Equal(70m, rm.AvailableForTrading(500m, 0));   // jamais plus que 70 €, même après des gains
        Assert.Equal(60m, rm.AvailableForTrading(90m, 0));    // réserve + marge (30 €) préservées
        Assert.Equal(0m, rm.AvailableForTrading(25m, 0));
        Assert.Equal(20m, rm.AvailableForTrading(100m, 50m)); // exposition déjà engagée
    }

    private static Position Closed(decimal pnl, DateTime exit) => new()
    {
        Symbol = "ETH/EUR", Quantity = 1, EntryPrice = 100, EntryFee = 0, ExitPrice = 100 + pnl, ExitFee = 0,
        ExitTimeUtc = exit, Status = PositionStatus.Closed, EntryTimeUtc = exit.AddHours(-2),
    };

    [Fact]
    public void DailyLossLimit_BlocksNewPositions()
    {
        var s = Settings();
        s.TimeZone = "UTC";
        var rm = new RiskManager(s);
        var now = new DateTime(2026, 3, 4, 15, 0, 0, DateTimeKind.Utc);
        var closed = new List<Position> { Closed(-0.8m, now.AddHours(-3)), Closed(-0.7m, now.AddHours(-1)) };
        var snap = rm.Evaluate(now, 98.5m, Array.Empty<Position>(), closed, _ => null);
        Assert.False(snap.CanOpenNewPosition);
        Assert.Contains(snap.BlockingReasons, r => r.Contains("quotidienne"));

        // Le lendemain, la limite quotidienne est levée
        var tomorrow = rm.Evaluate(now.AddDays(1), 98.5m, Array.Empty<Position>(), closed, _ => null);
        Assert.True(tomorrow.CanOpenNewPosition, string.Join(" ", tomorrow.BlockingReasons));
    }

    [Fact]
    public void WeeklyLossLimit_BlocksNewPositionsUntilMonday()
    {
        var s = Settings();
        s.TimeZone = "UTC";
        var rm = new RiskManager(s);
        var wednesday = new DateTime(2026, 3, 4, 12, 0, 0, DateTimeKind.Utc);
        var closed = new List<Position>
        {
            Closed(-1.2m, wednesday.AddDays(-2)), Closed(-1.2m, wednesday.AddDays(-1)), Closed(-0.6m, wednesday.AddHours(-1)),
        };
        var snap = rm.Evaluate(wednesday, 97m, Array.Empty<Position>(), closed, _ => null);
        Assert.Contains(snap.BlockingReasons, r => r.Contains("hebdomadaire"));
        var nextMonday = rm.Evaluate(new DateTime(2026, 3, 9, 1, 0, 0, DateTimeKind.Utc), 97m, Array.Empty<Position>(), closed, _ => null);
        Assert.True(nextMonday.CanOpenNewPosition);
    }

    [Fact]
    public void RiskBudget_ShrinksNearTheDailyLimit()
    {
        var s = Settings();
        s.TimeZone = "UTC";
        var rm = new RiskManager(s);
        var now = new DateTime(2026, 3, 4, 15, 0, 0, DateTimeKind.Utc);
        var snap = rm.Evaluate(now, 98.8m, Array.Empty<Position>(), new List<Position> { Closed(-1.2m, now.AddHours(-1)) }, _ => null);
        Assert.True(snap.CanOpenNewPosition);
        Assert.Equal(0.30m, snap.RiskBudget);
    }

    [Fact]
    public void MaxOpenPositions_IsEnforced()
    {
        var rm = new RiskManager(Settings());
        var open = new List<Position> { new() { Symbol = "BTC/EUR", Quantity = 0.0005m, EntryPrice = 60000m, StopLoss = 59000m } };
        var snap = rm.Evaluate(DateTime.UtcNow, 70m, open, Array.Empty<Position>(), _ => 60000m);
        Assert.False(snap.CanOpenNewPosition);
        Assert.Contains(snap.BlockingReasons, r => r.Contains("positions ouvertes"));
    }

    [Fact]
    public void DefaultSettings_AreConsistent()
    {
        Assert.Empty(Settings().Validate());
    }
}

