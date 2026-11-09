using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using MNBot.Core.Abstractions;
using MNBot.Core.Domain;

namespace MNBot.Api.Infrastructure;

/// <summary>Persistance SQLite (fichier data/mnbot.db). Toutes les opérations sont journalisées ici.</summary>
public sealed class SqliteRepository : ITradingRepository
{
    private readonly string _connectionString;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public SqliteRepository(string dbPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath, Cache = SqliteCacheMode.Shared }.ToString();
        Migrate();
    }

    public SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
        cmd.ExecuteNonQuery();
        return c;
    }

    private void Migrate()
    {
        using var c = Open();
        c.Execute("""
            CREATE TABLE IF NOT EXISTS candles (
                source TEXT NOT NULL, symbol TEXT NOT NULL, tf INTEGER NOT NULL, t INTEGER NOT NULL,
                o TEXT NOT NULL, h TEXT NOT NULL, l TEXT NOT NULL, c TEXT NOT NULL, v TEXT NOT NULL,
                PRIMARY KEY (source, symbol, tf, t));
            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, strategy TEXT NOT NULL, mode TEXT NOT NULL,
                status TEXT NOT NULL, qty TEXT NOT NULL, entry_price TEXT NOT NULL, entry_fee TEXT NOT NULL, entry_time TEXT NOT NULL,
                stop_loss TEXT NOT NULL, take_profit TEXT NOT NULL, initial_risk TEXT NOT NULL,
                exit_price TEXT, exit_fee TEXT NOT NULL DEFAULT '0', exit_time TEXT, exit_reason TEXT,
                entry_order TEXT NOT NULL, exit_order TEXT, entry_reason TEXT);
            CREATE INDEX IF NOT EXISTS ix_positions_mode_status ON positions(mode, status);
            CREATE TABLE IF NOT EXISTS orders (
                client_id TEXT NOT NULL, exchange_id TEXT, mode TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
                status TEXT NOT NULL, requested_qty TEXT NOT NULL, filled_qty TEXT NOT NULL, avg_price TEXT NOT NULL,
                fee TEXT NOT NULL, time TEXT NOT NULL, error TEXT, reason TEXT);
            CREATE INDEX IF NOT EXISTS ix_orders_client ON orders(client_id);
            CREATE TABLE IF NOT EXISTS signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, candle_time TEXT NOT NULL, symbol TEXT NOT NULL,
                strategy TEXT NOT NULL, action TEXT NOT NULL, price TEXT NOT NULL, stop_loss TEXT, take_profit TEXT,
                reason TEXT NOT NULL, checks TEXT NOT NULL, outcome TEXT);
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, level TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS equity (
                mode TEXT NOT NULL, time TEXT NOT NULL, equity TEXT NOT NULL, cash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS backtests (
                id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, summary TEXT NOT NULL, payload TEXT NOT NULL);
            """);
    }

    private static string D(decimal v) => v.ToString(CultureInfo.InvariantCulture);
    private static decimal P(string s) => decimal.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
    private static decimal? PN(string? s) => s is null ? null : P(s);
    private static string T(DateTime t) => DateTime.SpecifyKind(t, DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture);
    private static DateTime PT(string s) => DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    // ------------------------------------------------------------ bougies

    public Task UpsertCandlesAsync(string source, string symbol, Timeframe tf, IEnumerable<Candle> candles)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT OR REPLACE INTO candles(source,symbol,tf,t,o,h,l,c,v) VALUES($s,$sym,$tf,$t,$o,$h,$l,$c,$v)";
        var ps = new[] { "$s", "$sym", "$tf", "$t", "$o", "$h", "$l", "$c", "$v" }.Select(n => cmd.Parameters.Add(new SqliteParameter(n, null))).ToArray();
        foreach (var k in candles)
        {
            ps[0].Value = source; ps[1].Value = symbol; ps[2].Value = (int)tf;
            ps[3].Value = new DateTimeOffset(k.OpenTime, TimeSpan.Zero).ToUnixTimeSeconds();
            ps[4].Value = D(k.Open); ps[5].Value = D(k.High); ps[6].Value = D(k.Low); ps[7].Value = D(k.Close); ps[8].Value = D(k.Volume);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<Candle>> GetCandlesAsync(string source, string symbol, Timeframe tf, DateTime? fromUtc = null, DateTime? toUtc = null)
    {
        using var c = Open();
        var from = fromUtc is null ? long.MinValue : new DateTimeOffset(fromUtc.Value, TimeSpan.Zero).ToUnixTimeSeconds();
        var to = toUtc is null ? long.MaxValue : new DateTimeOffset(toUtc.Value, TimeSpan.Zero).ToUnixTimeSeconds();
        var rows = c.Query<(long t, string o, string h, string l, string c, string v)>(
            "SELECT t,o,h,l,c,v FROM candles WHERE source=@source AND symbol=@symbol AND tf=@tf AND t>=@from AND t<@to ORDER BY t",
            new { source, symbol, tf = (int)tf, from, to });
        IReadOnlyList<Candle> list = rows.Select(r => new Candle(DateTimeOffset.FromUnixTimeSeconds(r.t).UtcDateTime, P(r.o), P(r.h), P(r.l), P(r.c), P(r.v))).ToList();
        return Task.FromResult(list);
    }

    public IReadOnlyList<(string Source, string Symbol, int Tf, long Count, long First, long Last)> GetCandleInventory()
    {
        using var c = Open();
        return c.Query<(string, string, int, long, long, long)>(
            "SELECT source, symbol, tf, COUNT(*), MIN(t), MAX(t) FROM candles GROUP BY source, symbol, tf ORDER BY source, symbol, tf").ToList();
    }

    // ------------------------------------------------------------ positions

    public Task<long> InsertPositionAsync(Position p)
    {
        using var c = Open();
        var id = c.ExecuteScalar<long>("""
            INSERT INTO positions(symbol,strategy,mode,status,qty,entry_price,entry_fee,entry_time,stop_loss,take_profit,initial_risk,
                exit_price,exit_fee,exit_time,exit_reason,entry_order,exit_order,entry_reason)
            VALUES(@Symbol,@StrategyId,@Mode,@Status,@Qty,@EntryPrice,@EntryFee,@EntryTime,@StopLoss,@TakeProfit,@InitialRisk,
                @ExitPrice,@ExitFee,@ExitTime,@ExitReason,@EntryOrderId,@ExitOrderId,@EntryReason);
            SELECT last_insert_rowid();
            """, ToRow(p));
        return Task.FromResult(id);
    }

    public Task UpdatePositionAsync(Position p)
    {
        using var c = Open();
        c.Execute("""
            UPDATE positions SET status=@Status, qty=@Qty, stop_loss=@StopLoss, take_profit=@TakeProfit, exit_price=@ExitPrice,
                exit_fee=@ExitFee, exit_time=@ExitTime, exit_reason=@ExitReason, exit_order=@ExitOrderId WHERE id=@Id
            """, ToRow(p));
        return Task.CompletedTask;
    }

    private static object ToRow(Position p) => new
    {
        p.Id, p.Symbol, p.StrategyId, Mode = p.Mode.ToString(), Status = p.Status.ToString(), Qty = D(p.Quantity),
        EntryPrice = D(p.EntryPrice), EntryFee = D(p.EntryFee), EntryTime = T(p.EntryTimeUtc), StopLoss = D(p.StopLoss),
        TakeProfit = D(p.TakeProfit), InitialRisk = D(p.InitialRisk), ExitPrice = p.ExitPrice is { } ep ? D(ep) : null,
        ExitFee = D(p.ExitFee), ExitTime = p.ExitTimeUtc is { } et ? T(et) : null, p.ExitReason, p.EntryOrderId, p.ExitOrderId, p.EntryReason,
    };

    private sealed class PositionRow
    {
        public long id { get; set; }
        public string symbol { get; set; } = "";
        public string strategy { get; set; } = "";
        public string mode { get; set; } = "";
        public string status { get; set; } = "";
        public string qty { get; set; } = "0";
        public string entry_price { get; set; } = "0";
        public string entry_fee { get; set; } = "0";
        public string entry_time { get; set; } = "";
        public string stop_loss { get; set; } = "0";
        public string take_profit { get; set; } = "0";
        public string initial_risk { get; set; } = "0";
        public string? exit_price { get; set; }
        public string exit_fee { get; set; } = "0";
        public string? exit_time { get; set; }
        public string? exit_reason { get; set; }
        public string entry_order { get; set; } = "";
        public string? exit_order { get; set; }
        public string? entry_reason { get; set; }
    }

    private static Position FromRow(PositionRow r) => new()
    {
        Id = r.id, Symbol = r.symbol, StrategyId = r.strategy, Mode = Enum.Parse<TradingMode>(r.mode), Status = Enum.Parse<PositionStatus>(r.status),
        Quantity = P(r.qty), EntryPrice = P(r.entry_price), EntryFee = P(r.entry_fee), EntryTimeUtc = PT(r.entry_time),
        StopLoss = P(r.stop_loss), TakeProfit = P(r.take_profit), InitialRisk = P(r.initial_risk), ExitPrice = PN(r.exit_price),
        ExitFee = P(r.exit_fee), ExitTimeUtc = r.exit_time is null ? null : PT(r.exit_time), ExitReason = r.exit_reason,
        EntryOrderId = r.entry_order, ExitOrderId = r.exit_order, EntryReason = r.entry_reason,
    };

    public Task<IReadOnlyList<Position>> GetOpenPositionsAsync(TradingMode mode)
    {
        using var c = Open();
        IReadOnlyList<Position> l = c.Query<PositionRow>("SELECT * FROM positions WHERE mode=@m AND status='Open' ORDER BY id", new { m = mode.ToString() }).Select(FromRow).ToList();
        return Task.FromResult(l);
    }

    public Task<IReadOnlyList<Position>> GetClosedPositionsAsync(TradingMode mode, DateTime? sinceUtc = null, int limit = 1000)
    {
        using var c = Open();
        var rows = c.Query<PositionRow>("SELECT * FROM positions WHERE mode=@m AND status='Closed' AND (@since IS NULL OR exit_time>=@since) ORDER BY exit_time DESC LIMIT @limit",
            new { m = mode.ToString(), since = sinceUtc is { } s ? T(s) : null, limit });
        IReadOnlyList<Position> l = rows.Select(FromRow).ToList();
        return Task.FromResult(l);
    }

    // ------------------------------------------------------------ ordres

    public Task<bool> OrderExistsAsync(string clientOrderId)
    {
        using var c = Open();
        return Task.FromResult(c.ExecuteScalar<long>("SELECT COUNT(*) FROM orders WHERE client_id=@clientOrderId", new { clientOrderId }) > 0);
    }

    public Task InsertOrderAsync(OrderResult o, TradingMode mode, string reason)
    {
        using var c = Open();
        c.Execute("""
            INSERT INTO orders(client_id,exchange_id,mode,symbol,side,status,requested_qty,filled_qty,avg_price,fee,time,error,reason)
            VALUES(@ClientOrderId,@ExchangeOrderId,@Mode,@Symbol,@Side,@Status,@Req,@Filled,@Price,@Fee,@Time,@Error,@Reason)
            """, new
        {
            o.ClientOrderId, o.ExchangeOrderId, Mode = mode.ToString(), o.Symbol, Side = o.Side.ToString(), Status = o.Status.ToString(),
            Req = D(o.RequestedQuantity), Filled = D(o.FilledQuantity), Price = D(o.AveragePrice), Fee = D(o.Fee), Time = T(o.TimeUtc), o.Error, Reason = reason,
        });
        return Task.CompletedTask;
    }

    public IReadOnlyList<object> GetOrders(int limit)
    {
        using var c = Open();
        return c.Query("SELECT client_id AS clientId, exchange_id AS exchangeId, mode, symbol, side, status, requested_qty AS requestedQty, filled_qty AS filledQty, avg_price AS avgPrice, fee, time, error, reason FROM orders ORDER BY rowid DESC LIMIT @limit", new { limit }).Cast<object>().ToList();
    }

    // ------------------------------------------------------------ signaux

    public Task<long> InsertSignalAsync(SignalRecord s)
    {
        using var c = Open();
        var id = c.ExecuteScalar<long>("""
            INSERT INTO signals(time,candle_time,symbol,strategy,action,price,stop_loss,take_profit,reason,checks,outcome)
            VALUES(@Time,@CandleTime,@Symbol,@StrategyId,@Action,@Price,@StopLoss,@TakeProfit,@Reason,@Checks,@Outcome);
            SELECT last_insert_rowid();
            """, new
        {
            Time = T(s.TimeUtc), CandleTime = T(s.CandleTimeUtc), s.Symbol, s.StrategyId, Action = s.Action.ToString(), Price = D(s.Price),
            StopLoss = s.StopLoss is { } sl ? D(sl) : null, TakeProfit = s.TakeProfit is { } tp ? D(tp) : null, s.Reason,
            Checks = JsonSerializer.Serialize(s.Checks, Json), s.Outcome,
        });
        return Task.FromResult(id);
    }

    public Task<IReadOnlyList<SignalRecord>> GetSignalsAsync(int limit = 100, bool actionableOnly = false)
    {
        using var c = Open();
        var rows = c.Query<(long id, string time, string candle_time, string symbol, string strategy, string action, string price, string? stop_loss, string? take_profit, string reason, string checks, string? outcome)>(
            $"SELECT id,time,candle_time,symbol,strategy,action,price,stop_loss,take_profit,reason,checks,outcome FROM signals {(actionableOnly ? "WHERE action<>'None'" : "")} ORDER BY id DESC LIMIT @limit",
            new { limit });
        IReadOnlyList<SignalRecord> l = rows.Select(r => new SignalRecord
        {
            Id = r.id, TimeUtc = PT(r.time), CandleTimeUtc = PT(r.candle_time), Symbol = r.symbol, StrategyId = r.strategy,
            Action = Enum.Parse<SignalAction>(r.action), Price = P(r.price), StopLoss = PN(r.stop_loss), TakeProfit = PN(r.take_profit),
            Reason = r.reason, Checks = JsonSerializer.Deserialize<List<SignalCheck>>(r.checks, Json) ?? new(), Outcome = r.outcome,
        }).ToList();
        return Task.FromResult(l);
    }

    // ------------------------------------------------------------ alertes, capital, état

    public Task<long> InsertAlertAsync(AlertLevel level, string category, string message)
    {
        using var c = Open();
        var id = c.ExecuteScalar<long>("INSERT INTO alerts(time,level,category,message) VALUES(@t,@l,@c,@m); SELECT last_insert_rowid();",
            new { t = T(DateTime.UtcNow), l = level.ToString(), c = category, m = message });
        return Task.FromResult(id);
    }

    public IReadOnlyList<Alert> GetAlerts(int limit, AlertLevel? minLevel = null)
    {
        using var c = Open();
        var rows = c.Query<(long id, string time, string level, string category, string message)>(
            "SELECT id,time,level,category,message FROM alerts ORDER BY id DESC LIMIT @limit", new { limit = minLevel is null ? limit : limit * 5 });
        return rows.Select(r => new Alert(r.id, PT(r.time), Enum.Parse<AlertLevel>(r.level), r.category, r.message))
            .Where(a => minLevel is null || a.Level >= minLevel).Take(limit).ToList();
    }

    public Task InsertEquitySnapshotAsync(TradingMode mode, DateTime timeUtc, decimal equity, decimal cash)
    {
        using var c = Open();
        c.Execute("INSERT INTO equity(mode,time,equity,cash) VALUES(@m,@t,@e,@c)", new { m = mode.ToString(), t = T(timeUtc), e = D(equity), c = D(cash) });
        return Task.CompletedTask;
    }

    public IReadOnlyList<(DateTime Time, decimal Equity)> GetEquity(TradingMode mode, DateTime? since)
    {
        using var c = Open();
        return c.Query<(string time, string equity)>("SELECT time, equity FROM equity WHERE mode=@m AND (@s IS NULL OR time>=@s) ORDER BY time",
            new { m = mode.ToString(), s = since is { } x ? T(x) : null }).Select(r => (PT(r.time), P(r.equity))).ToList();
    }

    public DateTime? FirstEquityTime(TradingMode mode)
    {
        using var c = Open();
        var s = c.ExecuteScalar<string?>("SELECT MIN(time) FROM equity WHERE mode=@m", new { m = mode.ToString() });
        return s is null ? null : PT(s);
    }

    public Task<string?> GetStateAsync(string key)
    {
        using var c = Open();
        return Task.FromResult(c.ExecuteScalar<string?>("SELECT value FROM state WHERE key=@key", new { key }));
    }

    public Task SetStateAsync(string key, string value)
    {
        using var c = Open();
        c.Execute("INSERT INTO state(key,value) VALUES(@key,@value) ON CONFLICT(key) DO UPDATE SET value=excluded.value", new { key, value });
        return Task.CompletedTask;
    }

    // ------------------------------------------------------------ backtests

    public long InsertBacktest(string summary, string payload)
    {
        using var c = Open();
        return c.ExecuteScalar<long>("INSERT INTO backtests(time,summary,payload) VALUES(@t,@s,@p); SELECT last_insert_rowid();",
            new { t = T(DateTime.UtcNow), s = summary, p = payload });
    }

    public void UpdateBacktestPayload(long id, string payload)
    {
        using var c = Open();
        c.Execute("UPDATE backtests SET payload=@payload WHERE id=@id", new { id, payload });
    }

    public IReadOnlyList<(long Id, DateTime Time, string Summary)> ListBacktests(int limit)
    {
        using var c = Open();
        return c.Query<(long id, string time, string summary)>("SELECT id,time,summary FROM backtests ORDER BY id DESC LIMIT @limit", new { limit })
            .Select(r => (r.id, PT(r.time), r.summary)).ToList();
    }

    public string? GetBacktest(long id)
    {
        using var c = Open();
        return c.ExecuteScalar<string?>("SELECT payload FROM backtests WHERE id=@id", new { id });
    }
}
