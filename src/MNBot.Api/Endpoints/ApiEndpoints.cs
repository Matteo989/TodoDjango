using System.Text;
using MNBot.Api.Infrastructure;
using MNBot.Api.Services;
using MNBot.Core.Abstractions;
using MNBot.Core.Analysis;
using MNBot.Core.Domain;
using MNBot.Core.Engine;
using MNBot.Core.Indicators;
using MNBot.Core.Strategies;
using MNBot.Exchanges.Kraken;

namespace MNBot.Api.Endpoints;

public static class ApiEndpoints
{
    public const string LiveConfirmationPhrase = "JE CONFIRME LE TRADING REEL";

    private static string? TokenOf(HttpContext ctx)
    {
        var h = ctx.Request.Headers.Authorization.ToString();
        if (h.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return h[7..].Trim();
        return ctx.Request.Query["token"].FirstOrDefault();
    }

    public static void MapMnBotApi(this WebApplication app)
    {
        // ------------------------------------------------------------ authentification
        app.MapGet("/api/auth/status", (HttpContext ctx, AuthService auth) =>
            Results.Ok(new { enabled = auth.Enabled, authenticated = auth.Validate(TokenOf(ctx)) }));

        app.MapPost("/api/auth/login", (LoginRequest req, HttpContext ctx, AuthService auth) =>
        {
            var token = auth.Login(req.Password ?? "", ctx.Connection.RemoteIpAddress?.ToString() ?? "?");
            return token is null ? Results.Json(new { error = "Mot de passe incorrect (ou trop de tentatives)." }, statusCode: 401) : Results.Ok(new { token });
        });

        app.MapPost("/api/auth/logout", (HttpContext ctx, AuthService auth) => { auth.Logout(TokenOf(ctx)); return Results.Ok(); });

        app.Map("/ws", async (HttpContext ctx, AuthService auth, EventHub hub) =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
            if (!auth.Validate(TokenOf(ctx))) { ctx.Response.StatusCode = 401; return; }
            using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            await hub.HandleAsync(ws, ctx.RequestAborted);
        });

        var api = app.MapGroup("/api").AddEndpointFilter(async (efc, next) =>
        {
            var path = efc.HttpContext.Request.Path.Value ?? "";
            if (path.StartsWith("/api/auth", StringComparison.OrdinalIgnoreCase)) return await next(efc);
            var auth = efc.HttpContext.RequestServices.GetRequiredService<AuthService>();
            if (!auth.Validate(TokenOf(efc.HttpContext))) return Results.Json(new { error = "Authentification requise." }, statusCode: 401);
            try { return await next(efc); }
            catch (InvalidOperationException ex) { return Results.Json(new { error = ex.Message }, statusCode: 409); }
            catch (ArgumentException ex) { return Results.Json(new { error = ex.Message }, statusCode: 400); }
            catch (KeyNotFoundException ex) { return Results.Json(new { error = ex.Message }, statusCode: 404); }
        });

        // ------------------------------------------------------------ statut / bot
        api.MapGet("/status", async (TradingEngine e, SqliteRepository repo, AiAdvisor ai, TelegramNotifier tg, EventHub hub) =>
        {
            var signals = await repo.GetSignalsAsync(1, actionableOnly: true);
            var lastTrade = (await repo.GetClosedPositionsAsync(e.Mode, null, 1)).FirstOrDefault();
            var lastOpen = e.OpenPositions.OrderByDescending(p => p.EntryTimeUtc).FirstOrDefault();
            return Results.Ok(new
            {
                status = e.Status.ToString(),
                mode = e.Mode.ToString(),
                exchange = e.BotSettings.Exchange,
                symbols = e.BotSettings.Symbols,
                startedAt = e.StartedAtUtc,
                lastLoop = e.LastLoopUtc,
                lastError = e.LastError,
                lastErrorAt = e.LastErrorUtc,
                pauseReasons = e.PauseReasons.Values,
                liveConfirmed = e.LiveConfirmed,
                strategies = e.Strategies.Definitions.Select(d => new { d.Id, d.Name, enabled = e.Strategies.IsEnabled(d.Id) }),
                lastSignal = signals.FirstOrDefault(),
                lastTrade = (object?)lastOpen ?? lastTrade,
                aiAvailable = ai.Available,
                telegram = tg.Enabled,
                dashboardClients = hub.ClientCount,
                serverTime = DateTime.UtcNow,
            });
        });

        api.MapPost("/bot/start", async (TradingEngine e) => { await e.StartAsync("dashboard"); return Results.Ok(new { status = e.Status.ToString() }); });
        api.MapPost("/bot/stop", async (TradingEngine e) => { await e.StopAsync("dashboard"); return Results.Ok(new { status = e.Status.ToString() }); });
        api.MapPost("/bot/emergency-stop", async (TradingEngine e) => { await e.EmergencyStopAsync("dashboard"); return Results.Ok(new { status = e.Status.ToString() }); });
        api.MapPost("/bot/rearm", async (TradingEngine e) => { await e.RearmAsync("dashboard"); return Results.Ok(new { status = e.Status.ToString() }); });
        api.MapPost("/positions/{id:long}/close", async (long id, TradingEngine e) => { await e.CloseManuallyAsync(id, "dashboard"); return Results.Ok(); });
        api.MapPost("/strategies/{id}/enabled", async (string id, ToggleRequest req, TradingEngine e) =>
        {
            await e.SetStrategyEnabledAsync(id, req.Enabled);
            return Results.Ok(new { id, enabled = req.Enabled });
        });

        // ------------------------------------------------------------ vue générale
        api.MapGet("/overview", async (TradingEngine e, SqliteRepository repo) =>
        {
            var snap = await e.GetRiskSnapshotAsync();
            var closed = await repo.GetClosedPositionsAsync(e.Mode, null, int.MaxValue);
            var initial = e.RiskSettings.InitialCapital;
            var curve = repo.GetEquity(e.Mode, DateTime.UtcNow.AddDays(-90));
            var wins = closed.Count(p => p.RealizedPnl > 0);
            return Results.Ok(new
            {
                mode = e.Mode.ToString(),
                initialCapital = initial,
                equity = snap.Equity,
                cash = snap.Cash,
                available = snap.AvailableForTrading,
                exposure = snap.Exposure,
                dailyPnl = snap.DailyPnl,
                weeklyPnl = snap.WeeklyPnl,
                totalPnl = snap.TotalPnl,
                dailyPct = initial == 0 ? 0 : snap.DailyPnl / initial,
                weeklyPct = initial == 0 ? 0 : snap.WeeklyPnl / initial,
                totalPct = initial == 0 ? 0 : snap.TotalPnl / initial,
                trades = closed.Count,
                openPositions = snap.OpenPositions,
                winRate = closed.Count == 0 ? 0 : (decimal)wins / closed.Count,
                fees = closed.Sum(p => p.EntryFee + p.ExitFee),
                equityCurve = curve.Select(x => new { time = x.Time, equity = x.Equity }),
            });
        });

        // ------------------------------------------------------------ marché
        api.MapGet("/market/symbols", (TradingEngine e) => Results.Ok(e.Symbols.Select(s => new
        {
            s.Symbol,
            ticker = s.Ticker,
            lastClosedCandle = s.LastClosedCandleUtc,
            lastEvaluation = s.LastEvaluation is null ? null : new
            {
                action = s.LastEvaluation.Action.ToString(),
                s.LastEvaluation.Reason,
                s.LastEvaluation.Checks,
                s.LastEvaluation.Indicators,
                s.LastEvaluation.StopLoss,
                s.LastEvaluation.TakeProfit,
                strategy = s.LastEvaluationStrategy,
                time = s.LastEvaluationTimeUtc,
            },
            instrument = e.Instruments.GetValueOrDefault(s.Symbol),
        })));

        api.MapGet("/market/candles", async (string symbol, string? tf, TradingEngine e, SqliteRepository repo) =>
        {
            var timeframe = TimeframeExtensions.Parse(tf ?? "1h");
            if (!e.BotSettings.Symbols.Contains(symbol)) throw new ArgumentException("Actif non surveillé.");
            var candles = e.GetCachedCandles(symbol, timeframe);
            if (candles.Count == 0) candles = await repo.GetCandlesAsync(TradingEngine.SourceName, symbol, timeframe, DateTime.UtcNow.AddDays(timeframe == Timeframe.H4 ? -150 : -40));
            var closes = candles.Select(c => c.Close).ToArray();
            var ema20 = Ta.Ema(closes, 20); var ema50 = Ta.Ema(closes, 50); var ema200 = Ta.Ema(closes, 200);
            var rsi = Ta.Rsi(closes, 14);
            var take = Math.Min(candles.Count, 500);
            var start = candles.Count - take;
            static long U(DateTime t) => new DateTimeOffset(t, TimeSpan.Zero).ToUnixTimeSeconds();
            object Line(decimal?[] arr) => Enumerable.Range(start, take).Where(i => arr[i] is not null).Select(i => new { time = U(candles[i].OpenTime), value = arr[i] });
            return Results.Ok(new
            {
                symbol,
                timeframe = timeframe.Label(),
                candles = Enumerable.Range(start, take).Select(i => new { time = U(candles[i].OpenTime), open = candles[i].Open, high = candles[i].High, low = candles[i].Low, close = candles[i].Close, volume = candles[i].Volume }),
                ema20 = Line(ema20),
                ema50 = Line(ema50),
                ema200 = Line(ema200),
                rsi = Line(rsi),
            });
        });

        api.MapGet("/market/orderbook", async (string symbol, IMarketDataProvider md) => Results.Ok(await md.GetOrderBookAsync(symbol, 10)));

        // ------------------------------------------------------------ trading
        api.MapGet("/signals", async (int? limit, bool? actionable, SqliteRepository repo) =>
            Results.Ok(await repo.GetSignalsAsync(Math.Clamp(limit ?? 100, 1, 1000), actionable ?? false)));

        api.MapGet("/positions", (TradingEngine e) => Results.Ok(e.OpenPositions.Select(p =>
        {
            var t = e.GetTicker(p.Symbol);
            return new
            {
                p.Id, p.Symbol, p.StrategyId, mode = p.Mode.ToString(), p.Quantity, p.EntryPrice, p.EntryFee, p.EntryTimeUtc,
                p.StopLoss, p.TakeProfit, p.InitialRisk, p.EntryReason,
                currentPrice = t?.Bid,
                unrealizedPnl = t is null ? (decimal?)null : p.UnrealizedPnl(t.Bid, e.RiskSettings.TakerFeeRate),
            };
        })));

        api.MapGet("/trades", async (int? limit, TradingEngine e, SqliteRepository repo) =>
            Results.Ok((await repo.GetClosedPositionsAsync(e.Mode, null, Math.Clamp(limit ?? 200, 1, 5000))).Select(p => new
            {
                p.Id, p.Symbol, p.StrategyId, p.Quantity, p.EntryPrice, p.EntryTimeUtc, p.ExitPrice, p.ExitTimeUtc, p.ExitReason,
                fees = p.EntryFee + p.ExitFee, pnl = p.RealizedPnl, r = p.RMultiple, p.EntryReason,
            })));

        api.MapGet("/orders", (int? limit, SqliteRepository repo) => Results.Ok(repo.GetOrders(Math.Clamp(limit ?? 200, 1, 2000))));

        // ------------------------------------------------------------ risque
        api.MapGet("/risk", async (TradingEngine e) =>
        {
            var snap = await e.GetRiskSnapshotAsync();
            var s = e.RiskSettings;
            return Results.Ok(new
            {
                snapshot = snap,
                limits = new
                {
                    s.InitialCapital, s.MaxTradingCapital, s.Reserve, s.SafetyMargin, s.RiskPerTrade, s.MaxDailyLoss, s.MaxWeeklyLoss,
                    s.MaxOpenPositions, s.TakerFeeRate, s.SlippageRate, s.MinNetRewardRisk, s.MaxFeeShareOfReward, s.MaxSpreadPct, s.TimeZone,
                },
                positions = e.OpenPositions.Select(p => new { p.Id, p.Symbol, p.InitialRisk, exposure = p.EntryCost, p.StopLoss }),
                pauseReasons = e.PauseReasons.Values,
            });
        });

        // ------------------------------------------------------------ alertes / journal
        api.MapGet("/alerts", (int? limit, string? level, SqliteRepository repo) =>
        {
            AlertLevel? min = Enum.TryParse<AlertLevel>(level, true, out var l) ? l : null;
            return Results.Ok(repo.GetAlerts(Math.Clamp(limit ?? 100, 1, 1000), min));
        });

        // ------------------------------------------------------------ configuration
        api.MapGet("/config", (TradingEngine e, BacktestSettings bt, AiSettings ai, AppPaths paths, KrakenOptions k) => Results.Ok(new
        {
            configFile = paths.Config,
            bot = e.BotSettings,
            risk = e.RiskSettings,
            strategies = e.Strategies.Definitions.Select(d => new { d.Id, d.Name, d.Type, enabled = e.Strategies.IsEnabled(d.Id), d.Parameters }),
            backtest = bt,
            ai = new { ai.Enabled, ai.Model },
            kraken = new { k.BaseUrl, k.ValidateOrdersOnly, credentialsConfigured = k.HasCredentials },
        }));

        // ------------------------------------------------------------ analyse (IA)
        api.MapGet("/analysis/market", (TradingEngine e) => Results.Ok(e.BotSettings.Symbols.Select(s =>
            MarketAnalyst.Summarize(s, e.GetCachedCandles(s, Timeframe.H1), e.GetCachedCandles(s, Timeframe.H4), e.GetTicker(s)))));

        api.MapGet("/analysis/performance", async (TradingEngine e, SqliteRepository repo) =>
            Results.Ok(MarketAnalyst.ReviewPerformance(await repo.GetClosedPositionsAsync(e.Mode, null, int.MaxValue))));

        api.MapGet("/analysis/signal/{id:long}", async (long id, SqliteRepository repo) =>
        {
            var s = (await repo.GetSignalsAsync(5000)).FirstOrDefault(x => x.Id == id) ?? throw new KeyNotFoundException("Signal introuvable.");
            return Results.Ok(new { text = MarketAnalyst.ExplainSignal(s) });
        });

        api.MapPost("/analysis/ai", async (TradingEngine e, SqliteRepository repo, AiAdvisor ai, CancellationToken ct) =>
        {
            var sb = new StringBuilder();
            foreach (var s in e.BotSettings.Symbols)
                sb.AppendLine(MarketAnalyst.Summarize(s, e.GetCachedCandles(s, Timeframe.H1), e.GetCachedCandles(s, Timeframe.H4), e.GetTicker(s)).Text);
            var review = MarketAnalyst.ReviewPerformance(await repo.GetClosedPositionsAsync(e.Mode, null, int.MaxValue));
            sb.AppendLine().AppendLine("Performances : " + string.Join(" ", review.Observations));
            var signals = await repo.GetSignalsAsync(6);
            sb.AppendLine().AppendLine("Dernières évaluations de la stratégie :");
            foreach (var s in signals) sb.AppendLine($"- {s.CandleTimeUtc:dd/MM HH:mm} {s.Symbol} : {s.Reason} {s.Outcome}");
            var snap = await e.GetRiskSnapshotAsync();
            sb.AppendLine().AppendLine($"Risque : capital {snap.Equity:0.00} €, perte du jour {snap.DailyPnl:0.00} €, semaine {snap.WeeklyPnl:0.00} €, blocages : {string.Join(" ", snap.BlockingReasons)}");
            var context = sb.ToString();
            var comment = await ai.CommentAsync(context, ct);
            return Results.Ok(new { context, comment, model = ai.Available ? "claude" : null });
        });

        // ------------------------------------------------------------ données historiques & backtest
        api.MapGet("/data/inventory", (SqliteRepository repo) => Results.Ok(repo.GetCandleInventory().Select(i => new
        {
            i.Source, i.Symbol, timeframe = ((Timeframe)i.Tf).Label(), i.Count,
            from = DateTimeOffset.FromUnixTimeSeconds(i.First).UtcDateTime, to = DateTimeOffset.FromUnixTimeSeconds(i.Last).UtcDateTime,
        })));

        api.MapPost("/data/import", async (ImportRequest req, HistoryService hist, TradingEngine e, BacktestSettings bt, CancellationToken ct) =>
        {
            var symbols = req.Symbols is { Count: > 0 } ? req.Symbols : e.BotSettings.Symbols;
            var results = new List<object>();
            foreach (var s in symbols) results.Add(await hist.ImportAsync(s, req.Source ?? "binance", req.Days ?? bt.DefaultHistoryDays, ct));
            return Results.Ok(results);
        });

        api.MapPost("/backtest/run", async (BacktestRequest req, BacktestService svc, CancellationToken ct) => Results.Ok(await svc.RunAsync(req, ct)));
        api.MapGet("/backtest/runs", (SqliteRepository repo) => Results.Ok(repo.ListBacktests(50).Select(r => new { id = r.Id, time = r.Time, summary = r.Summary })));
        api.MapGet("/backtest/runs/{id:long}", (long id, SqliteRepository repo) =>
        {
            var payload = repo.GetBacktest(id);
            return payload is null ? Results.NotFound() : Results.Text(payload, "application/json");
        });

        // ------------------------------------------------------------ validation & passage en réel
        api.MapGet("/validation", async (TradingEngine e, SqliteRepository repo) => Results.Ok(await ComputeValidation(e, repo)));

        api.MapPost("/live/confirm", async (LiveConfirmRequest req, TradingEngine e, SqliteRepository repo, AuthService auth) =>
        {
            if (e.Mode != TradingMode.Live)
                throw new InvalidOperationException("Le bot est en mode simulation. Suivez docs/PASSAGE_EN_REEL.md pour activer le mode réel.");
            if (!string.Equals(req.Phrase?.Trim(), LiveConfirmationPhrase, StringComparison.Ordinal))
                throw new ArgumentException($"Phrase de confirmation incorrecte. Tapez exactement : {LiveConfirmationPhrase}");
            if (auth.Enabled && !auth.CheckPassword(req.Password))
                return Results.Json(new { error = "Mot de passe incorrect." }, statusCode: 401);
            var v = await ComputeValidation(e, repo);
            if (!v.Passed && !e.BotSettings.AllowLiveWithoutValidation)
                throw new InvalidOperationException("Validation du paper trading non atteinte : " + string.Join(" ", v.Missing));
            await e.ConfirmLiveAsync("dashboard");
            return Results.Ok(new { confirmed = true });
        });
    }

    public sealed record ValidationStatus(int Days, int RequiredDays, int Trades, int RequiredTrades, decimal NetPnl, decimal ProfitFactor, bool Passed, IReadOnlyList<string> Missing);

    private static async Task<ValidationStatus> ComputeValidation(TradingEngine e, SqliteRepository repo)
    {
        var first = repo.FirstEquityTime(TradingMode.Paper);
        var days = first is null ? 0 : (int)(DateTime.UtcNow - first.Value).TotalDays;
        var closed = await repo.GetClosedPositionsAsync(TradingMode.Paper, null, int.MaxValue);
        var net = closed.Sum(p => p.RealizedPnl);
        var gw = closed.Where(p => p.RealizedPnl > 0).Sum(p => p.RealizedPnl);
        var gl = -closed.Where(p => p.RealizedPnl <= 0).Sum(p => p.RealizedPnl);
        var pf = gl == 0 ? (gw > 0 ? 999m : 0m) : gw / gl;
        var missing = new List<string>();
        if (days < e.BotSettings.PaperValidationMinDays) missing.Add($"{days}/{e.BotSettings.PaperValidationMinDays} jours de paper trading.");
        if (closed.Count < e.BotSettings.PaperValidationMinTrades) missing.Add($"{closed.Count}/{e.BotSettings.PaperValidationMinTrades} transactions simulées.");
        if (closed.Count > 0 && net < 0) missing.Add($"Résultat simulé négatif ({net:0.00} €).");
        return new ValidationStatus(days, e.BotSettings.PaperValidationMinDays, closed.Count, e.BotSettings.PaperValidationMinTrades, net, pf, missing.Count == 0, missing);
    }

    public sealed record LoginRequest(string? Password);
    public sealed record ToggleRequest(bool Enabled);
    public sealed record ImportRequest(List<string>? Symbols, string? Source, int? Days);
    public sealed record LiveConfirmRequest(string? Phrase, string? Password);
}
