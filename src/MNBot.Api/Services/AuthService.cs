using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace MNBot.Api.Services;

/// <summary>
/// Protection du dashboard par mot de passe (variable MNBOT_DASHBOARD_PASSWORD).
/// Sans mot de passe, le dashboard n'est autorisé qu'en écoute locale (127.0.0.1).
/// </summary>
public sealed class AuthService
{
    private readonly string? _password;
    private readonly ConcurrentDictionary<string, DateTime> _tokens = new();
    private readonly ConcurrentDictionary<string, (int Count, DateTime Since)> _failures = new();

    public AuthService(string? password) { _password = string.IsNullOrWhiteSpace(password) ? null : password; }

    public bool Enabled => _password is not null;

    public string? Login(string password, string clientKey)
    {
        if (!Enabled) return "local";
        var f = _failures.GetValueOrDefault(clientKey);
        if (f.Count >= 5 && DateTime.UtcNow - f.Since < TimeSpan.FromMinutes(15)) return null; // anti force brute
        var ok = CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(password ?? ""), Encoding.UTF8.GetBytes(_password!));
        if (!ok)
        {
            _failures[clientKey] = f.Count == 0 || DateTime.UtcNow - f.Since > TimeSpan.FromMinutes(15) ? (1, DateTime.UtcNow) : (f.Count + 1, f.Since);
            return null;
        }
        _failures.TryRemove(clientKey, out _);
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        _tokens[token] = DateTime.UtcNow.AddDays(7);
        return token;
    }

    public bool CheckPassword(string? password) =>
        !Enabled || CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(password ?? ""), Encoding.UTF8.GetBytes(_password!));

    public bool Validate(string? token)
    {
        if (!Enabled) return true;
        if (string.IsNullOrEmpty(token)) return false;
        if (_tokens.TryGetValue(token, out var exp) && exp > DateTime.UtcNow) return true;
        _tokens.TryRemove(token, out _);
        return false;
    }

    public void Logout(string? token) { if (token is not null) _tokens.TryRemove(token, out _); }
}
