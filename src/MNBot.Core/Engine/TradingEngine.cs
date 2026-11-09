using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;
using MNBot.Core.Execution;
using MNBot.Core.Risk;
using MNBot.Core.Strategies;

namespace MNBot.Core.Engine;

public sealed record SymbolState(
    string Symbol,
    Ticker? Ticker,
    DateTime? LastClosedCandleUtc,
    StrategyEvaluation? LastEvaluation,
    string? LastEvaluationStrategy,
    DateTime? LastEvaluationTimeUtc);

/// <summary>
/// Cœur du bot : orchestre données de marché → stratégie → risque → exécution.
/// Les décisions d'exécution sont 100 % déterministes et vérifiables.
/// </summary>
public sealed class TradingEngine
{
    /// <summary>Nom de la source de données (ex. "binance"), utilisé pour stocker les bougies.</summary>
    public string Source => _md.Name.ToLowerInvariant();

    private readonly BotSettings _bot;
    private readonly RiskManager _risk;
    private readonly IMarketDataProvider _md;
    private readonly IExecutionVenue _venue;
    private readonly ITradingRepository _repo;
    private readonly StrategyRegistry _strategies;
    private readonly IEventSink _events;
    private readonly IClock _clock;
    private readonly ILogger _log;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private readonly ConcurrentDictionary<string, InstrumentSpec> _instruments = new();
    private readonly ConcurrentDictionary<string, Ticker> _tickers = new();
    private readonly ConcurrentDictionary<(string Symbol, Timeframe Tf), List<Candle>> _candles = new();
    private readonly ConcurrentDictionary<string, DateTime> _lastEvaluatedCandle = new();
    private readonly ConcurrentDictionary<string, (StrategyEvaluation Eval, string StrategyId, DateTime Time)> _lastEval = new();
    private readonly ConcurrentDictionary<string, string> _pauseReasons = new();
    private List<Position> _open = new();

    private DateTime _lastCandleRefresh = DateTime.MinValue;
    private DateTime _lastTickerOk = DateTime.MinValue;
    private DateTime _lastEquitySnapshot = DateTime.MinValue;
    private int _consecutiveErrors;
    private bool _initialized;

    public TradingEngine(
        BotSettings bot, RiskSettings risk, IMarketDataProvider marketData, IExecutionVenue venue,
        ITradingRepository repo, StrategyRegistry strategies, IEventSink events, IClock clock, ILogger log)
    {
        _bot = bot;
        _risk = new RiskManager(risk);
        _md = marketData;
        _venue = venue;
        _repo = repo;
        _strategies = strategies;
        _events = events;
        _clock = clock;
        _log = log;
    }

    public EngineStatus Status { get; private set; } = EngineStatus.Stopped;
    public TradingMode Mode => _venue.Mode;
    public DateTime StartedAtUtc { get; } = DateTime.UtcNow;
    public DateTime? LastLoopUtc { get; private set; }
    public string? LastError { get; private set; }
    public DateTime? LastErrorUtc { get; private set; }
    public bool LiveConfirmed { get; private set; }
    public BotSettings BotSettings => _bot;
    public RiskSettings RiskSettings => _risk.Settings;
    public RiskManager Risk => _risk;
    public StrategyRegistry Strategies => _strategies;
    public IReadOnlyList<Position> OpenPositions => _open.ToList();
    public IReadOnlyDictionary<string, string> PauseReasons => _pauseReasons;
    public IReadOnlyDictionary<string, InstrumentSpec> Instruments => _instruments;

    public IReadOnlyList<SymbolState> Symbols => _bot.Symbols.Select(s =>
    {
        _tickers.TryGetValue(s, out var t);
        _lastEvaluatedCandle.TryGetValue(s, out var lc);
        var has = _lastEval.TryGetValue(s, out var e);
        return new SymbolState(s, t, lc == default ? null : lc, has ? e.Eval : null, has ? e.StrategyId : null, has ? e.Time : null);
    }).ToList();

    public IReadOnlyList<Candle> GetCachedCandles(string symbol, Timeframe tf)
    {
        return _candles.TryGetValue((symbol, tf), out var l) ? l.ToList() : Array.Empty<Candle>();
    }

    public Ticker? GetTicker(string symbol) => _tickers.TryGetValue(symbol, out var t) ? t : null;

    // ------------------------------------------------------------------ initialisation

    public async Task InitializeAsync(CancellationToken ct)
    {
        foreach (var w in _risk.Settings.Validate())
            await AlertAsync(AlertLevel.Warning, "config", "Configuration du risque : " + w);

        foreach (var symbol in _bot.Symbols)
        {
            var spec = await _md.GetInstrumentAsync(symbol, ct);
            _instruments[symbol] = spec;
            // Historique déjà stocké : permet de redémarrer sans perte
            foreach (var tf in RequiredTimeframes())
            {
                var stored = await _repo.GetCandlesAsync(Source, symbol, tf, _clock.UtcNow - tf.ToTimeSpan() * KeepCandles);
                _candles[(symbol, tf)] = stored.ToList();
            }
            // Évite de réévaluer (et de rejouer) la même bougie après un redémarrage
            foreach (var def in _strategies.Definitions)
                if (await _repo.GetStateAsync(LastEvalKey(symbol, def.Id)) is { } last && DateTime.TryParse(last, null, System.Globalization.DateTimeStyles.RoundtripKind, out var lastEval))
                    _lastEvaluatedCandle[$"{symbol}|{def.Id}"] = DateTime.SpecifyKind(lastEval, DateTimeKind.Utc);
        }

        _open = (await _repo.GetOpenPositionsAsync(_venue.Mode)).ToList();

        if (_venue is PaperExecutionVenue paper)
        {
            // Le solde simulé est reconstruit à partir de l'historique : cohérent après redémarrage.
            var closed = await _repo.GetClosedPositionsAsync(TradingMode.Paper, null, int.MaxValue);
            var cash = _risk.Settings.InitialCapital + closed.Sum(p => p.RealizedPnl) - _open.Sum(p => p.EntryCost);
            var balances = new Dictionary<string, decimal> { ["EUR"] = cash };
            foreach (var p in _open)
            {
                var (b, _) = SymbolHelper.Split(p.Symbol);
                balances[b] = balances.GetValueOrDefault(b) + p.Quantity;
            }
            paper.SetBalances(balances);
        }

        LiveConfirmed = await _repo.GetStateAsync(LiveConfirmationKey) is not null;

        var enabledState = await _repo.GetStateAsync("strategies_enabled");
        if (enabledState is not null)
            _strategies.LoadEnabledState(enabledState.Split(',', StringSplitOptions.RemoveEmptyEntries));

        var wasEmergency = await _repo.GetStateAsync("emergency_stop") == "1";
        if (wasEmergency)
        {
            Status = EngineStatus.EmergencyStopped;
        }
        else if (_venue.Mode == TradingMode.Paper && _bot.AutoStartPaper)
        {
            Status = EngineStatus.Running;
        }
        else if (_venue.Mode == TradingMode.Live)
        {
            Status = EngineStatus.Stopped; // le réel ne démarre JAMAIS tout seul
            await AlertAsync(AlertLevel.Warning, "mode", "Mode RÉEL chargé : le moteur reste arrêté jusqu'à un démarrage manuel.");
        }

        _initialized = true;
        _log.LogInformation("Moteur initialisé : mode {Mode}, statut {Status}, {Count} position(s) ouverte(s).", _venue.Mode, Status, _open.Count);
        PublishStatus();
    }

    public const string LiveConfirmationKey = "live_confirmed_at";
    private static string LastEvalKey(string symbol, string strategyId) => $"last_eval:{symbol}:{strategyId}";
    private const int KeepCandles = 1000;

    /// <summary>Unités de temps nécessaires à l'ensemble des stratégies déclarées.</summary>
    private IReadOnlyList<Timeframe> RequiredTimeframes() => _strategies.Definitions
        .Select(d => _strategies.Get(d.Id))
        .SelectMany(st => new[] { st.EntryTimeframe, st.TrendTimeframe })
        .Distinct().OrderBy(t => t).ToList();

    // ------------------------------------------------------------------ commandes

    public async Task StartAsync(string by)
    {
        if (Status == EngineStatus.EmergencyStopped)
            throw new InvalidOperationException("Arrêt d'urgence actif : utilisez « Réarmer » avant de redémarrer.");
        Status = EngineStatus.Running;
        await AlertAsync(AlertLevel.Info, "bot", $"Moteur démarré ({by}).");
        PublishStatus();
    }

    public async Task StopAsync(string by)
    {
        if (Status == EngineStatus.EmergencyStopped) return;
        Status = EngineStatus.Stopped;
        await AlertAsync(AlertLevel.Info, "bot", $"Moteur arrêté ({by}). Les positions ouvertes restent protégées par leur stop-loss et take-profit.");
        PublishStatus();
    }

    /// <summary>Arrêt d'urgence : ferme toutes les positions au marché et bloque toute activité.</summary>
    public async Task EmergencyStopAsync(string by, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            Status = EngineStatus.EmergencyStopped;
            await _repo.SetStateAsync("emergency_stop", "1");
            await AlertAsync(AlertLevel.Critical, "bot", $"ARRÊT D'URGENCE déclenché ({by}). Fermeture de toutes les positions.");
            foreach (var p in _open.ToList())
            {
                try { await ClosePositionAsync(p, "Arrêt d'urgence", ct); }
                catch (Exception ex) { await AlertAsync(AlertLevel.Critical, "execution", $"Échec de fermeture de la position {p.Id} : {ex.Message}"); }
            }
        }
        finally { _gate.Release(); }
        PublishStatus();
    }

    public async Task RearmAsync(string by)
    {
        await _repo.SetStateAsync("emergency_stop", "0");
        Status = EngineStatus.Stopped;
        await AlertAsync(AlertLevel.Warning, "bot", $"Arrêt d'urgence levé ({by}). Le moteur est arrêté ; démarrez-le manuellement.");
        PublishStatus();
    }

    public async Task CloseManuallyAsync(long positionId, string by, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var p = _open.FirstOrDefault(x => x.Id == positionId) ?? throw new KeyNotFoundException("Position introuvable.");
            await ClosePositionAsync(p, $"Fermeture manuelle ({by})", ct);
        }
        finally { _gate.Release(); }
    }

    public async Task SetStrategyEnabledAsync(string id, bool enabled)
    {
        _strategies.SetEnabled(id, enabled);
        await _repo.SetStateAsync("strategies_enabled", string.Join(',', _strategies.EnabledIds));
        await AlertAsync(AlertLevel.Info, "strategy", $"Stratégie {id} {(enabled ? "activée" : "désactivée")}.");
        PublishStatus();
    }

    public async Task ConfirmLiveAsync(string by)
    {
        var stamp = $"{_clock.UtcNow:O} par {by}";
        await _repo.SetStateAsync(LiveConfirmationKey, stamp);
        LiveConfirmed = true;
        await AlertAsync(AlertLevel.Critical, "mode", $"Trading réel confirmé manuellement ({stamp}).");
        PublishStatus();
    }

    // ------------------------------------------------------------------ boucle

    /// <summary>Une itération de la boucle principale (appelée toutes les LoopIntervalSeconds).</summary>
    public async Task TickAsync(CancellationToken ct)
    {
        if (!_initialized) await InitializeAsync(ct);
        await _gate.WaitAsync(ct);
        try
        {
            LastLoopUtc = _clock.UtcNow;
            if (Status == EngineStatus.EmergencyStopped) { await RefreshTickersAsync(ct); return; }

            await RefreshTickersAsync(ct);
            await ManageOpenPositionsAsync(ct);

            if ((_clock.UtcNow - _lastCandleRefresh).TotalSeconds >= _bot.CandleRefreshSeconds)
            {
                await RefreshCandlesAsync(ct);
                _lastCandleRefresh = _clock.UtcNow;
                await EvaluateStrategiesAsync(ct);
            }

            if ((_clock.UtcNow - _lastEquitySnapshot).TotalMinutes >= 5)
            {
                var snap = await GetRiskSnapshotAsync();
                await _repo.InsertEquitySnapshotAsync(_venue.Mode, _clock.UtcNow, snap.Equity, snap.Cash);
                _lastEquitySnapshot = _clock.UtcNow;
            }
            PublishStatus();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            await RegisterErrorAsync("Erreur dans la boucle principale", ex);
        }
        finally { _gate.Release(); }
    }

    private async Task RefreshTickersAsync(CancellationToken ct)
    {
        try
        {
            var tickers = await _md.GetTickersAsync(_bot.Symbols, ct);
            foreach (var t in tickers)
            {
                if (_tickers.TryGetValue(t.Symbol, out var prev) && prev.Last > 0)
                {
                    var jump = Math.Abs(t.Last - prev.Last) / prev.Last;
                    if (jump > _risk.Settings.MaxPriceJumpPct)
                    {
                        _pauseReasons[$"jump:{t.Symbol}"] = $"Variation anormale de {t.Symbol} ({jump:P1}) : nouvelles entrées suspendues 15 min.";
                        _pauseUntil[$"jump:{t.Symbol}"] = _clock.UtcNow.AddMinutes(15);
                        await AlertAsync(AlertLevel.Warning, "anomaly", _pauseReasons[$"jump:{t.Symbol}"]);
                    }
                }
                _tickers[t.Symbol] = t;
            }
            _lastTickerOk = _clock.UtcNow;
            if (_consecutiveErrors >= _risk.Settings.MaxConsecutiveApiErrors)
                await AlertAsync(AlertLevel.Info, "api", "Connexion à la plateforme rétablie.");
            _consecutiveErrors = 0;
            _pauseReasons.TryRemove("api", out _);
            _pauseReasons.TryRemove("stale", out _);
            _events.Publish("tickers", tickers);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            _consecutiveErrors++;
            LastError = $"Prix indisponibles : {ex.Message}";
            LastErrorUtc = _clock.UtcNow;
            _log.LogWarning(ex, "Échec de récupération des prix ({Count} échecs consécutifs)", _consecutiveErrors);
            if (_consecutiveErrors == _risk.Settings.MaxConsecutiveApiErrors)
            {
                _pauseReasons["api"] = $"{_consecutiveErrors} erreurs API consécutives : nouvelles entrées suspendues.";
                await AlertAsync(AlertLevel.Critical, "api", _pauseReasons["api"] + " Dernière erreur : " + ex.Message);
            }
        }

        if (_lastTickerOk != DateTime.MinValue && (_clock.UtcNow - _lastTickerOk).TotalSeconds > _risk.Settings.MaxTickerAgeSeconds)
            _pauseReasons["stale"] = "Données de prix figées : nouvelles entrées suspendues.";

        foreach (var kv in _pauseUntil.ToList())
            if (_clock.UtcNow >= kv.Value) { _pauseUntil.TryRemove(kv.Key, out _); _pauseReasons.TryRemove(kv.Key, out _); }
    }

    private readonly ConcurrentDictionary<string, DateTime> _pauseUntil = new();

    private async Task RefreshCandlesAsync(CancellationToken ct)
    {
        var now = _clock.UtcNow;
        foreach (var symbol in _bot.Symbols)
        {
            try
            {
                foreach (var tf in RequiredTimeframes())
                {
                    var fresh = await _md.GetCandlesAsync(symbol, tf, null, ct);
                    var closed = fresh.Where(c => c.CloseTime(tf) <= now).ToList();
                    await _repo.UpsertCandlesAsync(Source, symbol, tf, closed);
                    var merged = Merge(_candles.GetValueOrDefault((symbol, tf)) ?? new List<Candle>(), closed);
                    _candles[(symbol, tf)] = merged.Count > KeepCandles ? merged.GetRange(merged.Count - KeepCandles, KeepCandles) : merged;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                await RegisterErrorAsync($"Bougies indisponibles pour {symbol}", ex, alert: false);
            }
        }
        _events.Publish("candles", new { time = now });
    }

    private static List<Candle> Merge(List<Candle> existing, List<Candle> fresh)
    {
        var map = new SortedDictionary<DateTime, Candle>();
        foreach (var c in existing) map[c.OpenTime] = c;
        foreach (var c in fresh) map[c.OpenTime] = c;
        return map.Values.ToList();
    }

    private async Task EvaluateStrategiesAsync(CancellationToken ct)
    {
        var now = _clock.UtcNow;
        foreach (var symbol in _bot.Symbols)
        {
            var position = _open.FirstOrDefault(p => p.Symbol == symbol);
            // Position ouverte : seule la stratégie qui l'a ouverte décide de la sortie (jamais de renforcement).
            var strategies = position is not null && _strategies.Exists(position.StrategyId)
                ? new List<IStrategy> { _strategies.Get(position.StrategyId) }
                : _strategies.Enabled.ToList();

            foreach (var strategy in strategies)
            {
                var entry = _candles.GetValueOrDefault((symbol, strategy.EntryTimeframe));
                var trend = _candles.GetValueOrDefault((symbol, strategy.TrendTimeframe)) ?? new List<Candle>();
                if (entry is null || entry.Count == 0) continue;
                var lastClosed = entry[^1];
                var key = $"{symbol}|{strategy.Id}";
                if (_lastEvaluatedCandle.TryGetValue(key, out var done) && done >= lastClosed.OpenTime) continue;
                _lastEvaluatedCandle[key] = lastClosed.OpenTime;
                await _repo.SetStateAsync(LastEvalKey(symbol, strategy.Id), lastClosed.OpenTime.ToString("O"));

                var ctx = new StrategyContext(symbol, entry, trend, position, now);
                var eval = strategy.Evaluate(ctx);
                _lastEval[symbol] = (eval, strategy.Id, now);

                var record = new SignalRecord
                {
                    TimeUtc = now, CandleTimeUtc = lastClosed.OpenTime, Symbol = symbol, StrategyId = strategy.Id,
                    Action = eval.Action, Price = eval.Price, StopLoss = eval.StopLoss, TakeProfit = eval.TakeProfit,
                    Reason = eval.Reason, Checks = eval.Checks.ToList(),
                };

                if (eval.Action == SignalAction.ExitLong && position is not null)
                {
                    await ClosePositionAsync(position, eval.Reason, ct);
                    if (position.Status == PositionStatus.Closed) { record.Outcome = "Position fermée"; position = null; }
                    else { record.Outcome = "Échec de la vente : nouvelle tentative au prochain cycle"; _lastEvaluatedCandle.TryRemove(key, out _); }
                }
                else if (eval.Action == SignalAction.EnterLong && position is null)
                {
                    var ageMin = (now - lastClosed.CloseTime(strategy.EntryTimeframe)).TotalMinutes;
                    if (Status != EngineStatus.Running)
                        record.Outcome = "Ignoré : moteur arrêté";
                    else if (ageMin > _bot.SignalMaxAgeMinutes)
                        record.Outcome = $"Ignoré : signal trop ancien ({ageMin:0} min)";
                    else
                    {
                        record.Outcome = await TryEnterAsync(symbol, strategy, eval, lastClosed, ct);
                        position = _open.FirstOrDefault(p => p.Symbol == symbol);
                    }
                }

                record.Id = await _repo.InsertSignalAsync(record);
                _events.Publish("signal", record);
                if (position is not null) break; // une position à la fois par actif
            }
        }
    }

    private async Task<string> TryEnterAsync(string symbol, IStrategy strategy, StrategyEvaluation eval, Candle candle, CancellationToken ct)
    {
        var blocks = new List<string>(_pauseReasons.Values);
        if (_venue.Mode == TradingMode.Live && !LiveConfirmed)
            blocks.Add("Trading réel non confirmé manuellement.");

        var snap = await GetRiskSnapshotAsync(blocks);
        if (!snap.CanOpenNewPosition)
        {
            var why = string.Join(" ", snap.BlockingReasons);
            await AlertAsync(AlertLevel.Info, "risk", $"Signal d'achat {symbol} refusé par la gestion du risque : {why}");
            return "Refusé (risque) : " + why;
        }

        if (!_tickers.TryGetValue(symbol, out var ticker) || (_clock.UtcNow - ticker.TimeUtc).TotalSeconds > _risk.Settings.MaxTickerAgeSeconds)
            return "Refusé : prix temps réel indisponible.";
        if (ticker.SpreadPct > _risk.Settings.MaxSpreadPct)
            return $"Refusé : spread trop large ({ticker.SpreadPct:P2}).";

        var instrument = _instruments[symbol];
        var estEntry = ticker.Ask * (1 + _risk.Settings.SlippageRate);
        var stopDistance = eval.StopDistance ?? 0;
        var stop = estEntry - stopDistance;
        var tp = estEntry + eval.RewardRisk * stopDistance;
        if (stop >= ticker.Bid)
            return "Refusé : le prix est déjà sous le stop calculé.";

        var sizing = PositionSizer.Calculate(estEntry, stop, tp, instrument, snap.AvailableForTrading, _risk.Settings, snap.RiskBudget);
        if (!sizing.Accepted)
        {
            await AlertAsync(AlertLevel.Info, "risk", $"Signal d'achat {symbol} non exécuté : {sizing.RejectReason}");
            return "Refusé (taille/frais) : " + sizing.RejectReason;
        }

        // Vérification du solde réel avant l'ordre
        var balances = await _venue.GetBalancesAsync(ct);
        var (_, quote) = SymbolHelper.Split(symbol);
        var cash = balances.GetValueOrDefault(quote);
        var needed = sizing.Notional * (1 + _risk.Settings.TakerFeeRate + _risk.Settings.SlippageRate);
        if (cash - needed < _risk.Settings.ProtectedCapital - 0.01m && _venue.Mode == TradingMode.Live)
            return "Refusé : le solde réel ne permet pas de préserver la réserve.";
        if (cash < needed) return $"Refusé : solde {quote} insuffisant ({cash:0.00} €).";

        // Anti-doublon : un seul ordre par stratégie / actif / bougie
        var clientId = $"{strategy.Id}-{symbol.Replace("/", "")}-{candle.OpenTime:yyyyMMddHHmm}-BUY";
        if (await _repo.OrderExistsAsync(clientId))
            return "Ignoré : ordre déjà envoyé pour cette bougie (anti-doublon).";

        var req = new OrderRequest(clientId, symbol, OrderSide.Buy, sizing.Quantity, eval.Reason);
        OrderResult result;
        try
        {
            result = await _venue.SubmitMarketOrderAsync(req, instrument, ticker, ct);
        }
        catch (Exception ex)
        {
            _pauseReasons["order"] = $"Ordre d'achat {clientId} en état incertain : vérifiez le compte puis réarmez.";
            await _repo.InsertOrderAsync(new OrderResult(clientId, null, symbol, OrderSide.Buy, OrderStatus.Pending, req.Quantity, 0, 0, 0, _clock.UtcNow, ex.Message), _venue.Mode, req.Reason);
            await AlertAsync(AlertLevel.Critical, "execution", _pauseReasons["order"] + " Erreur : " + ex.Message);
            return "Erreur d'exécution : " + ex.Message;
        }

        await _repo.InsertOrderAsync(result, _venue.Mode, req.Reason);
        if (result.Status != OrderStatus.Filled || result.FilledQuantity <= 0)
        {
            await AlertAsync(AlertLevel.Warning, "execution", $"Ordre d'achat {symbol} rejeté : {result.Error}");
            return "Ordre rejeté : " + result.Error;
        }

        // Stop et objectif recalculés sur le prix réellement obtenu
        var fill = result.AveragePrice;
        var finalStop = instrument.RoundPrice(fill - stopDistance);
        var finalTp = instrument.RoundPrice(fill + eval.RewardRisk * stopDistance);
        var cost = _risk.Settings.TakerFeeRate + _risk.Settings.SlippageRate;
        var position = new Position
        {
            Symbol = symbol, StrategyId = strategy.Id, Mode = _venue.Mode, Status = PositionStatus.Open,
            Quantity = result.FilledQuantity, EntryPrice = fill, EntryFee = result.Fee, EntryTimeUtc = result.TimeUtc,
            StopLoss = finalStop, TakeProfit = finalTp,
            InitialRisk = result.FilledQuantity * (fill - finalStop + finalStop * cost) + result.Fee,
            EntryOrderId = clientId, EntryReason = eval.Reason,
        };
        position.Id = await _repo.InsertPositionAsync(position);
        _open.Add(position);

        await AlertAsync(AlertLevel.Info, "trade",
            $"ACHAT {symbol} ({(_venue.Mode == TradingMode.Paper ? "simulation" : "RÉEL")}) : {position.Quantity} à {fill:0.##} €, " +
            $"stop {finalStop:0.##} €, objectif {finalTp:0.##} €, risque {position.InitialRisk:0.00} €.");
        _events.Publish("position", position);
        return $"Exécuté : achat de {position.Quantity} à {fill:0.##} €";
    }

    private async Task ManageOpenPositionsAsync(CancellationToken ct)
    {
        foreach (var p in _open.ToList())
        {
            if (!_tickers.TryGetValue(p.Symbol, out var t)) continue;
            if ((_clock.UtcNow - t.TimeUtc).TotalSeconds > _risk.Settings.MaxTickerAgeSeconds * 3) continue;
            if (t.Bid <= p.StopLoss)
                await ClosePositionAsync(p, $"Stop-loss touché (bid {t.Bid:0.##} ≤ {p.StopLoss:0.##})", ct);
            else if (t.Bid >= p.TakeProfit)
                await ClosePositionAsync(p, $"Take-profit atteint (bid {t.Bid:0.##} ≥ {p.TakeProfit:0.##})", ct);
        }
    }

    private async Task ClosePositionAsync(Position p, string reason, CancellationToken ct)
    {
        if (!_tickers.TryGetValue(p.Symbol, out var ticker))
            ticker = await _md.GetTickerAsync(p.Symbol, ct);
        var instrument = _instruments[p.Symbol];
        var clientId = $"POS{p.Id}-SELL";
        if (await _repo.OrderExistsAsync(clientId))
            clientId = $"POS{p.Id}-SELL-{_clock.UtcNow:HHmmss}"; // nouvelle tentative après un échec précédent

        var balances = await _venue.GetBalancesAsync(ct);
        var (baseAsset, _) = SymbolHelper.Split(p.Symbol);
        var qty = Math.Min(p.Quantity, instrument.RoundQuantityDown(balances.GetValueOrDefault(baseAsset)));
        if (qty <= 0)
        {
            await AlertAsync(AlertLevel.Critical, "execution", $"Impossible de vendre {p.Symbol} : aucun solde {baseAsset} disponible. Vérifiez le compte.");
            return;
        }

        var req = new OrderRequest(clientId, p.Symbol, OrderSide.Sell, qty, reason);
        OrderResult result;
        try
        {
            result = await _venue.SubmitMarketOrderAsync(req, instrument, ticker, ct);
        }
        catch (Exception ex)
        {
            await _repo.InsertOrderAsync(new OrderResult(clientId, null, p.Symbol, OrderSide.Sell, OrderStatus.Pending, qty, 0, 0, 0, _clock.UtcNow, ex.Message), _venue.Mode, reason);
            await AlertAsync(AlertLevel.Critical, "execution", $"Échec de la vente {p.Symbol} (position {p.Id}) : {ex.Message}. Nouvelle tentative au prochain cycle.");
            return;
        }
        await _repo.InsertOrderAsync(result, _venue.Mode, reason);
        if (result.Status != OrderStatus.Filled)
        {
            await AlertAsync(AlertLevel.Critical, "execution", $"Vente {p.Symbol} rejetée : {result.Error}. Nouvelle tentative au prochain cycle.");
            return;
        }

        p.ExitPrice = result.AveragePrice;
        p.ExitFee = result.Fee;
        p.ExitTimeUtc = result.TimeUtc;
        p.ExitReason = reason;
        p.ExitOrderId = clientId;
        p.Status = PositionStatus.Closed;
        await _repo.UpdatePositionAsync(p);
        _open.Remove(p);

        var pnl = p.RealizedPnl;
        await AlertAsync(pnl >= 0 ? AlertLevel.Info : AlertLevel.Warning, "trade",
            $"VENTE {p.Symbol} à {p.ExitPrice:0.##} € — {reason}. Résultat : {(pnl >= 0 ? "+" : "")}{pnl:0.00} € ({p.RMultiple:0.00} R).");
        _events.Publish("position", p);

        // Vérification des limites après chaque clôture
        var snap = await GetRiskSnapshotAsync();
        if (!snap.CanOpenNewPosition && snap.BlockingReasons.Any(r => r.Contains("Limite")))
            await AlertAsync(AlertLevel.Critical, "risk", "Limite de perte atteinte : nouvelles transactions suspendues. " + string.Join(" ", snap.BlockingReasons));
    }

    // ------------------------------------------------------------------ état

    public async Task<RiskSnapshot> GetRiskSnapshotAsync(IEnumerable<string>? extraBlocks = null)
    {
        var balances = await _venue.GetBalancesAsync();
        var cash = balances.GetValueOrDefault("EUR");
        var since = _risk.WeekStartUtc(_clock.UtcNow).AddDays(-1);
        var closed = await _repo.GetClosedPositionsAsync(_venue.Mode, null, int.MaxValue);
        var blocks = new List<string>(extraBlocks ?? _pauseReasons.Values);
        if (Status == EngineStatus.Stopped) blocks.Add("Moteur arrêté.");
        if (Status == EngineStatus.EmergencyStopped) blocks.Add("Arrêt d'urgence actif.");
        return _risk.Evaluate(_clock.UtcNow, cash, _open, closed, s => _tickers.TryGetValue(s, out var t) ? t.Bid : null, blocks.Distinct());
    }

    private async Task RegisterErrorAsync(string context, Exception ex, bool alert = true)
    {
        LastError = $"{context} : {ex.Message}";
        LastErrorUtc = _clock.UtcNow;
        _log.LogError(ex, "{Context}", context);
        if (alert) await AlertAsync(AlertLevel.Warning, "error", LastError);
    }

    public async Task AlertAsync(AlertLevel level, string category, string message)
    {
        _log.Log(level switch { AlertLevel.Critical => LogLevel.Critical, AlertLevel.Warning => LogLevel.Warning, _ => LogLevel.Information },
            "[{Category}] {Message}", category, message);
        try
        {
            var id = await _repo.InsertAlertAsync(level, category, message);
            _events.Publish("alert", new Alert(id, _clock.UtcNow, level, category, message));
        }
        catch (Exception ex) { _log.LogError(ex, "Impossible d'enregistrer l'alerte"); }
    }

    private void PublishStatus() => _events.Publish("status", new { status = Status.ToString(), mode = Mode.ToString(), time = _clock.UtcNow });
}
