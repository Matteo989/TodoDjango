namespace MNBot.Core.Strategies;

/// <summary>Définition d'une stratégie dans la configuration.</summary>
public sealed class StrategyDefinition
{
    public string Id { get; set; } = "trend-pullback";
    public string Name { get; set; } = "Trend Following + Pullback";
    public string Type { get; set; } = "TrendPullback";
    /// <summary>Stratégie utilisée par le moteur temps réel (paper/réel). Les variantes non activées servent au backtest.</summary>
    public bool Enabled { get; set; } = true;
    public TrendPullbackParameters Parameters { get; set; } = new();
}

public static class StrategyFactory
{
    public static IStrategy Create(StrategyDefinition def) => def.Type switch
    {
        "TrendPullback" => new TrendPullbackStrategy(def.Parameters.Clone(), def.Id, def.Name),
        _ => throw new NotSupportedException($"Type de stratégie inconnu : {def.Type}"),
    };
}

/// <summary>
/// Registre des stratégies : activation / désactivation manuelle uniquement.
/// Les paramètres ne sont jamais modifiés automatiquement en production.
/// </summary>
public sealed class StrategyRegistry
{
    private readonly object _lock = new();
    private readonly List<StrategyDefinition> _definitions;
    private readonly Dictionary<string, IStrategy> _instances = new();
    private readonly HashSet<string> _enabled = new();

    public StrategyRegistry(IEnumerable<StrategyDefinition> definitions)
    {
        _definitions = definitions.ToList();
        foreach (var d in _definitions)
        {
            if (_instances.ContainsKey(d.Id)) throw new InvalidOperationException($"Identifiant de stratégie dupliqué : {d.Id}");
            _instances[d.Id] = StrategyFactory.Create(d);
            if (d.Enabled) _enabled.Add(d.Id);
        }
    }

    public IReadOnlyList<StrategyDefinition> Definitions => _definitions;

    /// <summary>Enregistre une stratégie déjà construite (extensions, tests).</summary>
    public void Register(IStrategy strategy, bool enabled)
    {
        lock (_lock)
        {
            if (_instances.ContainsKey(strategy.Id)) throw new InvalidOperationException($"Identifiant de stratégie dupliqué : {strategy.Id}");
            _definitions.Add(new StrategyDefinition { Id = strategy.Id, Name = strategy.Name, Type = "Custom", Enabled = enabled });
            _instances[strategy.Id] = strategy;
            if (enabled) _enabled.Add(strategy.Id);
        }
    }

    public IStrategy Get(string id) => _instances.TryGetValue(id, out var s) ? s : throw new KeyNotFoundException(id);
    public bool Exists(string id) => _instances.ContainsKey(id);

    public IReadOnlyList<IStrategy> Enabled
    {
        get { lock (_lock) return _definitions.Where(d => _enabled.Contains(d.Id)).Select(d => _instances[d.Id]).ToList(); }
    }

    public bool IsEnabled(string id) { lock (_lock) return _enabled.Contains(id); }

    public void SetEnabled(string id, bool enabled)
    {
        if (!_instances.ContainsKey(id)) throw new KeyNotFoundException(id);
        lock (_lock) { if (enabled) _enabled.Add(id); else _enabled.Remove(id); }
    }

    public void LoadEnabledState(IEnumerable<string> enabledIds)
    {
        lock (_lock)
        {
            _enabled.Clear();
            foreach (var id in enabledIds.Where(_instances.ContainsKey)) _enabled.Add(id);
        }
    }

    public IEnumerable<string> EnabledIds { get { lock (_lock) return _enabled.ToList(); } }
}
