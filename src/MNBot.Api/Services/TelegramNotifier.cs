using System.Threading.Channels;
using MNBot.Api.Infrastructure;
using MNBot.Core.Domain;

namespace MNBot.Api.Services;

/// <summary>
/// Envoi optionnel des alertes sur Telegram (TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans .env).
/// Inactif si ces variables sont absentes.
/// </summary>
public sealed class TelegramNotifier : BackgroundService
{
    private readonly Channel<string> _queue = Channel.CreateBounded<string>(new BoundedChannelOptions(200) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly HttpClient _http;
    private readonly string? _token = Environment.GetEnvironmentVariable("TELEGRAM_BOT_TOKEN");
    private readonly string? _chatId = Environment.GetEnvironmentVariable("TELEGRAM_CHAT_ID");
    private readonly AlertLevel _minLevel;
    private readonly ILogger<TelegramNotifier> _log;

    public TelegramNotifier(EventHub hub, IHttpClientFactory httpFactory, NotificationSettings settings, ILogger<TelegramNotifier> log)
    {
        _http = httpFactory.CreateClient("telegram");
        _log = log;
        _minLevel = Enum.TryParse<AlertLevel>(settings.TelegramMinLevel, true, out var l) ? l : AlertLevel.Warning;
        if (Enabled)
            hub.AddListener((type, payload) =>
            {
                if (type == "alert" && payload is Alert a && (a.Level >= _minLevel || a.Category == "trade"))
                    _queue.Writer.TryWrite($"[MNBot] {a.Level}: {a.Message}");
            });
    }

    public bool Enabled => !string.IsNullOrWhiteSpace(_token) && !string.IsNullOrWhiteSpace(_chatId);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!Enabled) return;
        await foreach (var msg in _queue.Reader.ReadAllAsync(ct))
        {
            try
            {
                using var content = new FormUrlEncodedContent(new Dictionary<string, string> { ["chat_id"] = _chatId!, ["text"] = msg });
                using var resp = await _http.PostAsync($"https://api.telegram.org/bot{_token}/sendMessage", content, ct);
                if (!resp.IsSuccessStatusCode) _log.LogWarning("Telegram a répondu {Status}", (int)resp.StatusCode);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogWarning(ex, "Envoi Telegram impossible"); }
        }
    }
}
