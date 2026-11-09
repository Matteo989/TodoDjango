using MNBot.Core.Engine;

namespace MNBot.Api.Services;

/// <summary>Fait tourner la boucle du moteur de trading 24h/24 en tâche de fond.</summary>
public sealed class EngineHostedService : BackgroundService
{
    private readonly TradingEngine _engine;
    private readonly ILogger<EngineHostedService> _log;

    public EngineHostedService(TradingEngine engine, ILogger<EngineHostedService> log)
    {
        _engine = engine;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Initialisation avec reprises : la plateforme peut être momentanément injoignable au démarrage
        var delay = TimeSpan.FromSeconds(5);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _engine.InitializeAsync(stoppingToken);
                break;
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex)
            {
                _log.LogError(ex, "Initialisation du moteur impossible, nouvelle tentative dans {Delay}s", delay.TotalSeconds);
                await Task.Delay(delay, stoppingToken);
                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 300));
            }
        }

        var interval = TimeSpan.FromSeconds(Math.Max(3, _engine.BotSettings.LoopIntervalSeconds));
        using var timer = new PeriodicTimer(interval);
        try
        {
            do
            {
                try { await _engine.TickAsync(stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { _log.LogError(ex, "Erreur non gérée dans la boucle du moteur"); }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) { }
        _log.LogInformation("Boucle du moteur arrêtée.");
    }
}
