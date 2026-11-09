using System.Text.Json;
using MNBot.Core.Domain;
using MNBot.Core.Execution;
using MNBot.Exchanges.Kraken;

namespace MNBot.Tests;

public class ExecutionAndKrakenTests
{
    [Fact]
    public async Task Paper_BuyThenSell_AppliesSpreadSlippageAndFees()
    {
        var venue = new PaperExecutionVenue(0.004m, 0.0005m);
        venue.SetBalances(new Dictionary<string, decimal> { ["EUR"] = 100m });
        var ticker = new Ticker("ETH/EUR", 1999m, 2001m, 2000m, 0, DateTime.UtcNow);

        var buy = await venue.SubmitMarketOrderAsync(new OrderRequest("b1", "ETH/EUR", OrderSide.Buy, 0.01m, "test"), TestData.Eth, ticker);
        Assert.Equal(OrderStatus.Filled, buy.Status);
        Assert.Equal(2001m * 1.0005m, buy.AveragePrice);
        Assert.Equal(buy.Notional * 0.004m, buy.Fee);

        var sell = await venue.SubmitMarketOrderAsync(new OrderRequest("s1", "ETH/EUR", OrderSide.Sell, 0.01m, "test"), TestData.Eth, ticker);
        Assert.Equal(1999m * 0.9995m, sell.AveragePrice);
        var bal = await venue.GetBalancesAsync();
        Assert.Equal(0m, bal["ETH"]);
        Assert.Equal(100m - buy.Notional - buy.Fee + sell.Notional - sell.Fee, bal["EUR"]);
        Assert.True(bal["EUR"] < 100m); // un aller-retour immédiat coûte toujours de l'argent
    }

    [Fact]
    public async Task Paper_RejectsOrdersWithoutFunds()
    {
        var venue = new PaperExecutionVenue(0.004m, 0m);
        venue.SetBalances(new Dictionary<string, decimal> { ["EUR"] = 10m });
        var ticker = new Ticker("ETH/EUR", 2000m, 2000m, 2000m, 0, DateTime.UtcNow);
        var r = await venue.SubmitMarketOrderAsync(new OrderRequest("b", "ETH/EUR", OrderSide.Buy, 0.01m, ""), TestData.Eth, ticker);
        Assert.Equal(OrderStatus.Rejected, r.Status);
        var s = await venue.SubmitMarketOrderAsync(new OrderRequest("s", "ETH/EUR", OrderSide.Sell, 0.01m, ""), TestData.Eth, ticker);
        Assert.Equal(OrderStatus.Rejected, s.Status);
    }

    [Fact]
    public void Kraken_SignatureMatchesOfficialDocumentationExample()
    {
        // Exemple publié dans la documentation de l'API REST Kraken (authentification).
        var secret = "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==";
        var nonce = "1616492376594";
        var post = "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25";
        var sig = KrakenClient.Sign("/0/private/AddOrder", nonce, post, secret);
        Assert.Equal("4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==", sig);
    }

    [Theory]
    [InlineData("BTC/EUR", "XBTEUR")]
    [InlineData("ETH/EUR", "ETHEUR")]
    [InlineData("SOL/EUR", "SOLEUR")]
    public void Kraken_SymbolMapping(string symbol, string pair) => Assert.Equal(pair, KrakenSymbols.ToPair(symbol));

    [Theory]
    [InlineData("XXBT", "BTC")]
    [InlineData("ZEUR", "EUR")]
    [InlineData("XETH", "ETH")]
    [InlineData("XBT", "BTC")]
    [InlineData("SOL", "SOL")]
    public void Kraken_AssetNormalization(string k, string expected) => Assert.Equal(expected, KrakenSymbols.NormalizeAsset(k));

    [Fact]
    public void Kraken_ParsesOhlcAndTicker()
    {
        var ohlc = JsonDocument.Parse("""[[1794196800,"67067.3","67240.3","66769.4","66875.4","66963.7","7.23557410",603]]""").RootElement;
        var c = KrakenMarketDataProvider.ParseOhlc(ohlc).Single();
        Assert.Equal(new DateTime(2026, 11, 9, 4, 0, 0, DateTimeKind.Utc), c.OpenTime);
        Assert.Equal(67067.3m, c.Open);
        Assert.Equal(66875.4m, c.Close);
        Assert.Equal(7.23557410m, c.Volume);

        var t = JsonDocument.Parse("""{"a":["1913.49000","12","12.000"],"b":["1913.23000","8","8.000"],"c":["1913.90000","0.1"],"v":["476.9","4856.6"]}""").RootElement;
        var tk = KrakenMarketDataProvider.ParseTicker("ETH/EUR", t, DateTime.UtcNow);
        Assert.Equal(1913.23m, tk.Bid);
        Assert.Equal(1913.49m, tk.Ask);
        Assert.Equal(4856.6m, tk.Volume24h);
    }

    [Fact]
    public void Kraken_ErrorsAreSurfaced()
    {
        var ex = Assert.Throws<KrakenApiException>(() => KrakenClient.ParseResult("""{"error":["EAPI:Invalid nonce"]}""", "Balance"));
        Assert.Contains("Invalid nonce", ex.Message);
    }

    [Fact]
    public void Kraken_UserRefIsStableAndPositive()
    {
        var a = KrakenExecutionVenue.UserRef("trend-pullback-BTCEUR-202611090400-BUY");
        Assert.Equal(a, KrakenExecutionVenue.UserRef("trend-pullback-BTCEUR-202611090400-BUY"));
        Assert.True(a >= 0);
    }

    [Fact]
    public void Instrument_RoundsQuantityDown()
    {
        Assert.Equal(0.00041234m, TestData.Btc.RoundQuantityDown(0.000412349m));
        Assert.Equal(66875.4m, TestData.Btc.RoundPrice(66875.43m));
    }
}
