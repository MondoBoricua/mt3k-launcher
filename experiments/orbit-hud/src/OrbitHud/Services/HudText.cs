namespace OrbitHud.Services;

internal static class HudText
{
    private static readonly Dictionary<string, (string De, string En)> Strings = new()
    {
        ["HomeNav"] = ("Übersicht", "Overview"),
        ["TimerNav"] = ("Sitzung", "Session"),
        ["SettingsNav"] = ("Anpassen", "Customize"),
        ["Eyebrow"] = ("DEIN MOMENT IM SPIEL", "YOUR MOMENT IN GAME"),
        ["Heading"] = ("Alles im Blick.", "Keep your focus."),
        ["Subheading"] = ("Ein kurzer Blick. Dann weiter.", "A quick glance. Then back to play."),
        ["ContextLabel"] = ("AKTUELLE APP", "CURRENT APP"),
        ["ClockLabel"] = ("LOKALE ZEIT", "LOCAL TIME"),
        ["BatteryLabel"] = ("ENERGIE", "POWER"),
        ["SessionLabel"] = ("DEINE SITZUNG", "YOUR SESSION"),
        ["TimerHeading"] = ("Zeit für dein Spiel.", "Make time for play."),
        ["TimerDescription"] = ("Starte deinen Timer, wenn du bereit bist. Er läuft auch bei geschlossenem HUD weiter.", "Start your timer when you are ready. It keeps time even while the HUD is closed."),
        ["ManualLabel"] = ("MANUELLER TIMER", "MANUAL TIMER"),
        ["ResetButton"] = ("Zurücksetzen", "Reset"),
        ["ResetQuestion"] = ("Sitzungstimer auf null setzen?", "Reset the session timer to zero?"),
        ["ResetCancel"] = ("Behalten", "Keep timer"),
        ["ResetConfirm"] = ("Ja, zurücksetzen", "Yes, reset"),
        ["SettingsHeading"] = ("Dein HUD. Dein Stil.", "Your HUD. Your way."),
        ["SettingsDescription"] = ("So fühlt sich dein HUD richtig an.", "Make your HUD feel right at home."),
        ["AnimationsLabel"] = ("Sanfte Übergänge", "Smooth transitions"),
        ["AnimationsHint"] = ("Kurze Animationen beim Bereichswechsel. Deine Windows-Einstellung hat Vorrang.", "Brief animations between sections. Your Windows setting takes priority."),
        ["LargeTextLabel"] = ("Größere Schrift", "Larger text"),
        ["LargeTextHint"] = ("Mehr Lesbarkeit aus Sitzabstand.", "Easier to read from the couch."),
        ["LanguageLabel"] = ("Sprache", "Language"),
        ["PrivacyTitle"] = ("Nur auf diesem Gerät.", "Only on this device."),
        ["PrivacyDescription"] = ("Timer und Einstellungen bleiben lokal. Kein Konto erforderlich.", "Your timer and preferences stay local. No account needed."),
        ["FooterHint"] = ("A Auswählen  ·  B Zurück", "A Select  ·  B Back"),
        ["Ready"] = ("Bereit, wenn du es bist", "Ready when you are"),
        ["NoTarget"] = ("Keine App ausgewählt", "No app selected"),
        ["TargetDisabled"] = ("App-Erkennung in Game Bar deaktiviert", "App detection disabled in Game Bar"),
        ["TargetUnavailable"] = ("App-Information gerade nicht verfügbar", "App information is currently unavailable"),
        ["Standalone"] = ("In Game Bar mit Win + G öffnen", "Open in Game Bar with Win + G"),
        ["Start"] = ("Timer starten", "Start timer"),
        ["Resume"] = ("Fortsetzen", "Resume"),
        ["Pause"] = ("Pausieren", "Pause"),
        ["Running"] = ("Läuft · manuell gestartet", "Running · started manually"),
        ["Paused"] = ("Pausiert", "Paused"),
        ["Charging"] = ("Wird geladen", "Charging"),
        ["PluggedIn"] = ("Am Stromnetz", "Plugged in"),
        ["OnBattery"] = ("Im Akkubetrieb", "On battery"),
        ["NoBattery"] = ("Kein Akku", "No battery"),
        ["Unavailable"] = ("Nicht verfügbar", "Unavailable"),
        ["SaveFailed"] = ("Änderungen konnten nicht gespeichert werden. Bitte erneut versuchen.", "Changes could not be saved. Please try again."),
        ["CloseButton"] = ("Widget schließen", "Close widget"),
        ["TimerCard"] = ("Sitzungstimer öffnen", "Open session timer"),
        ["On"] = ("Ein", "On"),
        ["Off"] = ("Aus", "Off")
    };

    public static string Get(string key, string language) =>
        language == "de" ? Strings[key].De : Strings[key].En;
}
