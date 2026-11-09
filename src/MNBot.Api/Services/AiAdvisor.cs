using Anthropic;
using Anthropic.Models.Messages;
using MNBot.Api.Infrastructure;

namespace MNBot.Api.Services;

/// <summary>
/// Commentaire de marché optionnel rédigé par Claude (API Anthropic, clé ANTHROPIC_API_KEY).
/// Ce service reçoit uniquement un résumé textuel et renvoie du texte : il n'a aucun accès
/// au moteur d'exécution, aux fonds ni aux règles de risque.
/// </summary>
public sealed class AiAdvisor
{
    private readonly AiSettings _settings;
    private readonly ILogger<AiAdvisor> _log;
    private readonly AnthropicClient? _client;

    private const string SystemPrompt =
        "Tu es l'analyste d'un bot de trading crypto Spot (BTC/EUR, ETH/EUR) au capital de 100 €. " +
        "Tu n'as aucun pouvoir d'exécution : tu commentes et tu expliques seulement. " +
        "À partir des données fournies, rédige en français, de façon concise et factuelle : " +
        "1) un résumé des conditions de marché, 2) une comparaison des actifs, 3) les anomalies éventuelles, " +
        "4) une lecture des performances de la stratégie, 5) des pistes d'amélioration à valider par backtest. " +
        "Ne promets aucune rentabilité, ne recommande jamais d'augmenter le risque ou le capital engagé, " +
        "et rappelle qu'aucune modification ne doit être appliquée sans backtest et validation humaine.";

    public AiAdvisor(AiSettings settings, ILogger<AiAdvisor> log)
    {
        _settings = settings;
        _log = log;
        var key = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
        if (settings.Enabled && !string.IsNullOrWhiteSpace(key))
            _client = new AnthropicClient { ApiKey = key };
    }

    public bool Available => _client is not null;

    public async Task<string> CommentAsync(string context, CancellationToken ct)
    {
        if (_client is null)
            return "Module IA inactif : ajoutez ANTHROPIC_API_KEY dans le fichier .env pour obtenir un commentaire rédigé par Claude. L'analyse déterministe ci-dessus reste disponible.";
        try
        {
            var response = await _client.Messages.Create(new MessageCreateParams
            {
                Model = _settings.Model,
                MaxTokens = _settings.MaxTokens,
                OutputConfig = new OutputConfig { Effort = Effort.Low },
                System = SystemPrompt,
                Messages = [new UserMessageParam { Content = context }],
            }, ct);

            if (response.StopReason == "refusal")
                return "Le modèle a décliné cette demande. L'analyse déterministe reste disponible.";
            var text = string.Join("\n", response.Content.Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));
            return string.IsNullOrWhiteSpace(text) ? "Réponse vide du modèle." : text;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Échec de l'appel à l'API Anthropic");
            return "Commentaire IA indisponible : " + ex.Message;
        }
    }
}
