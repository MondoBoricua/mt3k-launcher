namespace OrbitHud.Core;

// A manual wall-clock timer, deliberately independent of games and launcher data.
// Rendering may stop while hidden; elapsed time is derived only when requested.
public sealed class SessionTimer
{
    public TimeSpan Accumulated { get; private set; }
    public DateTimeOffset? StartedAt { get; private set; }
    public bool IsRunning => StartedAt.HasValue;

    public SessionTimer(TimeSpan accumulated = default, DateTimeOffset? startedAt = null)
    {
        Accumulated = accumulated < TimeSpan.Zero ? TimeSpan.Zero : accumulated;
        StartedAt = startedAt;
    }

    public TimeSpan Elapsed(DateTimeOffset now)
    {
        var delta = StartedAt.HasValue ? now - StartedAt.Value : TimeSpan.Zero;
        return Accumulated + (delta > TimeSpan.Zero ? delta : TimeSpan.Zero);
    }

    public void Toggle(DateTimeOffset now)
    {
        if (IsRunning)
        {
            Accumulated = Elapsed(now);
            StartedAt = null;
        }
        else StartedAt = now;
    }

    public void Reset()
    {
        Accumulated = TimeSpan.Zero;
        StartedAt = null;
    }

    public static string Format(TimeSpan elapsed) =>
        $"{(long)elapsed.TotalHours:00}:{elapsed.Minutes:00}:{elapsed.Seconds:00}";
}
