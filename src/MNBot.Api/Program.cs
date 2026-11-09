using System.Net;
using MNBot.Api.Endpoints;
using MNBot.Api.Infrastructure;
using MNBot.Api.Services;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;
using MNBot.Core.Engine;
using MNBot.Core.Execution;
using MNBot.Core.Risk;
using MNBot.Core.Strategies;
using MNBot.Exchanges.Binance;
using MNBot.Exchanges.Kraken;

var paths = AppPaths.Resolve();
paths.LoadEnvFile();
Directory.CreateDirectory(paths.Data);
Directory.CreateDirectory(paths.Logs);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot"),
});
builder.Configuration.AddJsonFile(paths.Config, optional: false, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables("MNBOT__");
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "yyyy-MM-dd HH:mm:ss "; });
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
builder.Logging.AddFilter("System.Net.Http", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.Hosting.Lifetime", LogLevel.Information);
builder.Logging.AddProvider(new FileLoggerProvider(paths.Logs));

// ---------------------------------------------------------------- configuration
var cfg = builder.Configuration;
var bot = cfg.GetSection("Bot").Get<BotSettings>() ?? new BotSettings();
if (bot.Symbols.Count == 0) bot.Symbols.AddRange(new[] { "BTC/EUR", "ETH/EUR" });
bot.Symbols = bot.Symbols.Distinct().ToList();
var risk = cfg.GetSection("Risk").Get<RiskSettings>() ?? new RiskSettings();
var strategies = cfg.GetSection("Strategies").Get<List<StrategyDefinition>>() ?? new List<StrategyDefinition>();
if (strategies.Count == 0) strategies.Add(new StrategyDefinition());
var backtest = cfg.GetSection("Backtest").Get<BacktestSettings>() ?? new BacktestSettings();
var server = cfg.GetSection("Server").Get<ServerSettings>() ?? new ServerSettings();
var ai = cfg.GetSection("Ai").Get<AiSettings>() ?? new AiSettings();
var notifications = cfg.GetSection("Notifications").Get<NotificationSettings>() ?? new NotificationSettings();
var kraken = cfg.GetSection("Kraken").Get<KrakenOptions>() ?? new KrakenOptions();
kraken.ApiKey = Environment.GetEnvironmentVariable("KRAKEN_API_KEY");
kraken.ApiSecret = Environment.GetEnvironmentVariable("KRAKEN_API_SECRET");
var binance = cfg.GetSection("Binance").Get<BinanceOptions>() ?? new BinanceOptions();
binance.ApiKey = Environment.GetEnvironmentVariable("BINANCE_API_KEY");
binance.ApiSecret = Environment.GetEnvironmentVariable("BINANCE_API_SECRET");
var useBinance = string.Equals(bot.Exchange, "Binance", StringComparison.OrdinalIgnoreCase);
if (!useBinance && !string.Equals(bot.Exchange, "Kraken", StringComparison.OrdinalIgnoreCase))
{
    Console.Error.WriteLine($"REFUS DE DÉMARRER : plateforme inconnue « {bot.Exchange} » (Binance ou Kraken).");
    return 5;
}

var dashboardPassword = Environment.GetEnvironmentVariable("MNBOT_DASHBOARD_PASSWORD");
var urls = Environment.GetEnvironmentVariable("MNBOT_URLS") ?? server.Urls;
if (string.IsNullOrWhiteSpace(dashboardPassword) && !IsLoopbackOnly(urls))
{
    Console.Error.WriteLine($"REFUS DE DÉMARRER : le dashboard écoute sur {urls} sans mot de passe. Définissez MNBOT_DASHBOARD_PASSWORD dans .env ou utilisez 127.0.0.1.");
    return 2;
}

// Garde-fou du mode réel : deux verrous indépendants en plus de la confirmation dans le dashboard
if (bot.Mode == TradingMode.Live)
{
    if (!string.Equals(Environment.GetEnvironmentVariable("MNBOT_LIVE_TRADING_ENABLED"), "true", StringComparison.OrdinalIgnoreCase))
    {
        Console.Error.WriteLine("REFUS DE DÉMARRER : Bot:Mode=Live mais MNBOT_LIVE_TRADING_ENABLED n'est pas égal à true. Voir docs/PASSAGE_EN_REEL.md.");
        return 3;
    }
    if (useBinance ? !binance.HasCredentials : !kraken.HasCredentials)
    {
        Console.Error.WriteLine(useBinance
            ? "REFUS DE DÉMARRER : mode réel demandé mais BINANCE_API_KEY / BINANCE_API_SECRET absents."
            : "REFUS DE DÉMARRER : mode réel demandé mais KRAKEN_API_KEY / KRAKEN_API_SECRET absents.");
        return 4;
    }
}

builder.WebHost.UseUrls(urls);

// ---------------------------------------------------------------- services
builder.Services.AddSingleton(paths);
builder.Services.AddSingleton(bot);
builder.Services.AddSingleton(risk);
builder.Services.AddSingleton(backtest);
builder.Services.AddSingleton(ai);
builder.Services.AddSingleton(notifications);
builder.Services.AddSingleton(kraken);
builder.Services.AddSingleton(new StrategyRegistry(strategies));
builder.Services.AddSingleton(new AuthService(dashboardPassword));
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<EventHub>();
builder.Services.AddSingleton<IEventSink>(sp => sp.GetRequiredService<EventHub>());
builder.Services.AddSingleton(new SqliteRepository(paths.Database));
builder.Services.AddSingleton<ITradingRepository>(sp => sp.GetRequiredService<SqliteRepository>());
builder.Services.AddHttpClient();
builder.Services.AddHttpClient("kraken");
builder.Services.AddSingleton(sp => new KrakenClient(sp.GetRequiredService<IHttpClientFactory>().CreateClient("kraken"), kraken));
builder.Services.AddSingleton(binance);
builder.Services.AddHttpClient("binance");
builder.Services.AddSingleton(sp => new BinanceClient(sp.GetRequiredService<IHttpClientFactory>().CreateClient("binance"), binance));
builder.Services.AddSingleton<IMarketDataProvider>(sp => useBinance
    ? new BinanceMarketDataProvider(sp.GetRequiredService<BinanceClient>())
    : new KrakenMarketDataProvider(sp.GetRequiredService<KrakenClient>()));
builder.Services.AddSingleton<IExecutionVenue>(sp => bot.Mode != TradingMode.Live
    ? new PaperExecutionVenue(risk.TakerFeeRate, risk.SlippageRate, sp.GetRequiredService<IClock>())
    : useBinance
        ? new BinanceExecutionVenue(sp.GetRequiredService<BinanceClient>(), risk.TakerFeeRate)
        : new KrakenExecutionVenue(sp.GetRequiredService<KrakenClient>()));
builder.Services.AddSingleton(sp => new TradingEngine(
    bot, risk,
    sp.GetRequiredService<IMarketDataProvider>(),
    sp.GetRequiredService<IExecutionVenue>(),
    sp.GetRequiredService<ITradingRepository>(),
    sp.GetRequiredService<StrategyRegistry>(),
    sp.GetRequiredService<IEventSink>(),
    sp.GetRequiredService<IClock>(),
    sp.GetRequiredService<ILoggerFactory>().CreateLogger("Engine")));
builder.Services.AddSingleton<HistoryService>();
builder.Services.AddSingleton<BacktestService>();
builder.Services.AddSingleton<AiAdvisor>();
builder.Services.AddHostedService<EngineHostedService>();
builder.Services.AddSingleton<TelegramNotifier>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<TelegramNotifier>());
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
});

var app = builder.Build();

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapMnBotApi();
app.MapFallbackToFile("index.html");

var log = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("MNBot");
log.LogInformation("MNBot démarre — mode {Mode}, dashboard sur {Urls}, données dans {Home}", bot.Mode, urls, paths.Home);
if (string.IsNullOrWhiteSpace(dashboardPassword))
    log.LogWarning("Aucun mot de passe de dashboard (MNBOT_DASHBOARD_PASSWORD) : accès réservé à cette machine.");

app.Run();
return 0;

static bool IsLoopbackOnly(string urls) => urls.Split(';', StringSplitOptions.RemoveEmptyEntries).All(u =>
{
    if (!Uri.TryCreate(u.Replace("*", "0.0.0.0").Replace("+", "0.0.0.0"), UriKind.Absolute, out var uri)) return false;
    return uri.Host == "localhost" || (IPAddress.TryParse(uri.Host.Trim('[', ']'), out var ip) && IPAddress.IsLoopback(ip));
});

public partial class Program { }
