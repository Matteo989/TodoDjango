using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using MNBot.Core.Abstractions;

namespace MNBot.Api.Infrastructure;

/// <summary>Diffusion des événements temps réel vers le dashboard (WebSocket /ws) et les notifications.</summary>
public sealed class EventHub : IEventSink
{
    private readonly ConcurrentDictionary<Guid, Channel<string>> _clients = new();
    private readonly List<Action<string, object>> _listeners = new();
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };

    public int ClientCount => _clients.Count;

    public void AddListener(Action<string, object> listener) { lock (_listeners) _listeners.Add(listener); }

    public void Publish(string type, object payload)
    {
        string json;
        try { json = JsonSerializer.Serialize(new { type, payload, time = DateTime.UtcNow }, JsonOptions); }
        catch { return; }
        foreach (var ch in _clients.Values) ch.Writer.TryWrite(json);
        Action<string, object>[] ls;
        lock (_listeners) ls = _listeners.ToArray();
        foreach (var l in ls) { try { l(type, payload); } catch { /* un écouteur défaillant ne bloque pas le moteur */ } }
    }

    public async Task HandleAsync(WebSocket socket, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.DropOldest });
        _clients[id] = channel;
        try
        {
            var receive = Task.Run(async () =>
            {
                var buf = new byte[1024];
                while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var r = await socket.ReceiveAsync(buf, ct);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                }
            }, ct);

            await foreach (var msg in channel.Reader.ReadAllAsync(ct))
            {
                if (socket.State != WebSocketState.Open || receive.IsCompleted) break;
                await socket.SendAsync(Encoding.UTF8.GetBytes(msg), WebSocketMessageType.Text, true, ct);
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        finally
        {
            _clients.TryRemove(id, out _);
            if (socket.State == WebSocketState.Open)
                try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
        }
    }
}
