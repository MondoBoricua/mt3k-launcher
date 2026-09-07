using System.Globalization;
using OrbitHud.Core;
using Windows.Storage;

namespace OrbitHud.Services;

internal sealed class HudSettings
{
    // This container belongs to OrbitHud.Preview, never ORBIT.GamingHome.
    private readonly ApplicationDataContainer container = ApplicationData.Current.LocalSettings;
    public string Language { get; set; }
    public bool Animations { get; set; }
    public bool LargeText { get; set; }
    public SessionTimer Timer { get; }
    public bool SaveFailed { get; private set; }
    public event Action? Changed;

    public HudSettings()
    {
        Language = container.Values["language"] as string == "de" ? "de" :
            container.Values["language"] as string == "en" ? "en" :
            CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "de" ? "de" : "en";
        Animations = container.Values["animations"] as bool? ?? true;
        LargeText = container.Values["largeText"] as bool? ?? false;
        // Composite values prevent partial writes from combining different timer states.
        var snapshot = container.Values["timer.v1"] as ApplicationDataCompositeValue;
        var milliseconds = snapshot?["elapsedMs"] as double? ?? 0;
        if (!double.IsFinite(milliseconds) || milliseconds < 0 || milliseconds > TimeSpan.FromDays(36500).TotalMilliseconds)
            milliseconds = 0;
        DateTimeOffset? started = null;
        if (snapshot?["startedAt"] is string value && DateTimeOffset.TryParseExact(value, "O",
                CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
            started = parsed;
        Timer = new SessionTimer(TimeSpan.FromMilliseconds(milliseconds), started);
    }

    public void Save()
    {
        try
        {
            container.Values["language"] = Language;
            container.Values["animations"] = Animations;
            container.Values["largeText"] = LargeText;
            var snapshot = new ApplicationDataCompositeValue { ["elapsedMs"] = Timer.Accumulated.TotalMilliseconds };
            if (Timer.StartedAt.HasValue)
                snapshot["startedAt"] = Timer.StartedAt.Value.ToString("O", CultureInfo.InvariantCulture);
            container.Values["timer.v1"] = snapshot;
            SaveFailed = false;
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or UnauthorizedAccessException)
        {
            SaveFailed = true;
        }
        Changed?.Invoke();
    }
}
