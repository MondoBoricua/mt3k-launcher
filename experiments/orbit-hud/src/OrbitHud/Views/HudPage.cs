using System.Globalization;
using System.Reflection;
using Microsoft.Gaming.XboxGameBar;
using OrbitHud.Core;
using OrbitHud.Services;
using Windows.System;
using Windows.System.Power;
using Windows.UI.Core;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Automation;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Markup;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Animation;

namespace OrbitHud.Views;

internal sealed partial class HudPage : Page, IDisposable
{
    private readonly Grid root;
    private readonly HudSettings settings;
    private readonly XboxGameBarWidget? widget;
    private readonly XboxGameBarAppTargetTracker? tracker;
    private readonly DispatcherTimer ticker = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly UISettings systemUi = new();
    private readonly AccessibilitySettings accessibility = new();
    private readonly Dictionary<TextBlock, double> fontSizes = new();
    private readonly Action close;
    private Storyboard? transition;
    private bool active, disposed, applyingSettings;
    private string currentPage = "Home";
    private Button? returnFocus;

    internal HudPage(HudSettings settings, XboxGameBarWidget? widget, Action close)
    {
        this.settings = settings;
        this.widget = widget;
        this.close = close;
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("OrbitHud.Views.HudView.xaml")
            ?? throw new InvalidOperationException("HUD view resource is missing.");
        using var reader = new StreamReader(stream);
        root = (Grid)XamlReader.Load(reader.ReadToEnd());
        Content = root;
        IsTabStop = false;
        if (widget is not null) tracker = new XboxGameBarAppTargetTracker(widget);
        foreach (var name in new[] { "HomeNav", "TimerNav", "SettingsNav" })
        {
            var button = Find<Button>(name);
            button.Click += (_, _) => Navigate(name.Replace("Nav", ""), button);
        }
        Find<Button>("TimerCard").Click += (_, _) => Navigate("Timer", Find<Button>("TimerCard"));
        Find<Button>("CloseButton").Click += (_, _) => close();
        Find<Button>("ToggleTimer").Click += (_, _) => { settings.Timer.Toggle(DateTimeOffset.UtcNow); Save(); RefreshTime(); };
        Find<Button>("ResetButton").Click += (_, _) =>
        {
            Find<Border>("ResetPanel").Visibility = Visibility.Visible;
            Find<Button>("ResetCancel").Focus(FocusState.Keyboard);
        };
        Find<Button>("ResetCancel").Click += (_, _) => CancelReset();
        Find<Button>("ResetConfirm").Click += (_, _) => { settings.Timer.Reset(); Save(); CancelReset(); RefreshTime(); };
        Find<ToggleSwitch>("AnimationsToggle").Toggled += (_, _) =>
        {
            if (applyingSettings) return;
            settings.Animations = Find<ToggleSwitch>("AnimationsToggle").IsOn;
            StopTransition(); Save();
        };
        Find<ToggleSwitch>("LargeTextToggle").Toggled += (_, _) =>
        {
            if (applyingSettings) return;
            settings.LargeText = Find<ToggleSwitch>("LargeTextToggle").IsOn;
            ApplyScale(); Save();
        };
        Find<Button>("LanguageButton").Click += (_, _) =>
        {
            settings.Language = settings.Language == "de" ? "en" : "de";
            Save(); ApplyText(); UpdateNav(); Refresh();
        };
        KeyDown += OnKeyDown;
        ticker.Tick += OnTick;
        Loaded += OnLoaded;
        settings.Changed += OnSettingsChanged;
        ApplyText(); ApplyPalette(); UpdateNav(); Refresh();
    }

    private T Find<T>(string name) where T : class =>
        root.FindName(name) as T ?? throw new InvalidOperationException($"Missing HUD element: {name}");
    private string Text(string key) => HudText.Get(key, settings.Language);

    private void ApplyText()
    {
        foreach (var key in new[] { "Eyebrow", "Heading", "Subheading", "ContextLabel", "ClockLabel", "BatteryLabel",
                     "SessionLabel", "TimerHeading", "TimerDescription", "ManualLabel", "ResetQuestion", "SettingsHeading",
                     "SettingsDescription", "AnimationsLabel", "AnimationsHint", "LargeTextLabel", "LargeTextHint",
                     "LanguageLabel", "PrivacyTitle", "PrivacyDescription", "FooterHint" })
            Find<TextBlock>(key).Text = Text(key);
        foreach (var key in new[] { "HomeNav", "TimerNav", "SettingsNav", "ResetButton", "ResetCancel", "ResetConfirm" })
            SetButtonText(Find<Button>(key), Text(key));
        SetButtonText(Find<Button>("LanguageButton"), settings.Language == "de" ? "Deutsch  /  English" : "English  /  Deutsch");
        foreach (var key in new[] { "CloseButton", "TimerCard" }) AutomationProperties.SetName(Find<Button>(key), Text(key));
        AutomationProperties.SetName(Find<Button>("LanguageButton"), Text("LanguageLabel"));
        applyingSettings = true;
        foreach (var (name, label, value) in new[] { ("AnimationsToggle", "AnimationsLabel", settings.Animations),
                     ("LargeTextToggle", "LargeTextLabel", settings.LargeText) })
        {
            var toggle = Find<ToggleSwitch>(name);
            toggle.IsOn = value;
            toggle.OnContent = Text("On"); toggle.OffContent = Text("Off");
            AutomationProperties.SetName(toggle, Text(label));
        }
        applyingSettings = false;
        Find<TextBlock>("SaveError").Text = Text("SaveFailed");
        ApplyScale();
    }

    private static void SetButtonText(Button button, string text)
    {
        if (button.Content is not TextBlock content)
        {
            content = new TextBlock { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center,
                FontSize = button.FontSize, Foreground = button.Foreground, VerticalAlignment = VerticalAlignment.Center };
            button.Content = content;
        }
        content.Text = text;
        AutomationProperties.SetName(button, text);
    }

    private void ApplyScale()
    {
        var scale = settings.LargeText || widget?.CompactModeEnabled == true ? 1.12 : 1;
        Visit(root);
        void Visit(DependencyObject element)
        {
            if (element is TextBlock block)
            {
                if (!fontSizes.ContainsKey(block)) fontSizes[block] = block.FontSize;
                block.FontSize = fontSizes[block] * scale;
            }
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(element); i++) Visit(VisualTreeHelper.GetChild(element, i));
        }
    }

    private void ApplyPalette()
    {
        if (!accessibility.HighContrast) return;
        Set("CanvasBrush", UIElementType.Window); Set("CardBrush", UIElementType.Window);
        Set("TextBrush", UIElementType.WindowText); Set("MutedBrush", UIElementType.WindowText);
        Set("LineBrush", UIElementType.WindowText); Set("AccentBrush", UIElementType.Highlight);
        Set("AccentInkBrush", UIElementType.HighlightText);
        void Set(string key, UIElementType type) => ((SolidColorBrush)root.Resources[key]).Color = systemUi.UIElementColor(type);
    }

    private void OnLoaded(object sender, RoutedEventArgs args)
    {
        ApplyScale(); Find<Button>("HomeNav").Focus(FocusState.Keyboard);
    }

    private void Navigate(string page, Button source)
    {
        if (page == currentPage) return;
        Find<Border>("ResetPanel").Visibility = Visibility.Collapsed;
        currentPage = page; returnFocus = source;
        foreach (var name in new[] { "Home", "Timer", "Settings" })
            Find<StackPanel>(name + "Page").Visibility = name == page ? Visibility.Visible : Visibility.Collapsed;
        Find<ScrollViewer>("ContentScroll").ChangeView(null, 0, null, true);
        UpdateNav(); Animate(); ApplyScale();
        var target = page == "Timer" ? (Control)Find<Button>("ToggleTimer") :
            page == "Settings" ? Find<ToggleSwitch>("AnimationsToggle") : Find<Button>("TimerCard");
        target.Focus(FocusState.Keyboard);
    }

    private void UpdateNav()
    {
        foreach (var name in new[] { "Home", "Timer", "Settings" })
        {
            var button = Find<Button>(name + "Nav");
            button.Background = (Brush)root.Resources[name == currentPage ? "AccentBrush" : "CardBrush"];
            button.Foreground = (Brush)root.Resources[name == currentPage ? "AccentInkBrush" : "TextBrush"];
            if (button.Content is TextBlock text) text.Foreground = button.Foreground;
        }
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs args)
    {
        if (args.Key != VirtualKey.Escape && args.Key != VirtualKey.GamepadB && args.Key != VirtualKey.GoBack) return;
        args.Handled = HandleBack();
    }

    internal bool HandleBack()
    {
        if (Find<Border>("ResetPanel").Visibility == Visibility.Visible) { CancelReset(); return true; }
        else if (currentPage != "Home")
        {
            var previous = returnFocus;
            Navigate("Home", Find<Button>("HomeNav"));
            previous?.Focus(FocusState.Keyboard); return true;
        }
        else if (widget is null) { close(); return true; }
        // At the root, Game Bar owns B/Escape. LB/RB are never intercepted.
        return false;
    }

    private void CancelReset()
    {
        Find<Border>("ResetPanel").Visibility = Visibility.Collapsed;
        Find<Button>("ResetButton").Focus(FocusState.Keyboard);
    }

    private void Animate()
    {
        StopTransition();
        if (!active || !settings.Animations || !systemUi.AnimationsEnabled) return;
        transition = new Storyboard();
        var duration = new Duration(TimeSpan.FromMilliseconds(160));
        var opacity = new DoubleAnimation { From = 0.8, To = 1, Duration = duration };
        Storyboard.SetTarget(opacity, Find<Grid>("ContentHost")); Storyboard.SetTargetProperty(opacity, "Opacity");
        var move = new DoubleAnimation { From = 7, To = 0, Duration = duration,
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
        Storyboard.SetTarget(move, Find<TranslateTransform>("ContentTranslation")); Storyboard.SetTargetProperty(move, "Y");
        transition.Children.Add(opacity); transition.Children.Add(move); transition.Begin();
    }

    private void StopTransition()
    {
        transition?.Stop(); transition = null;
        Find<Grid>("ContentHost").Opacity = 1;
        Find<TranslateTransform>("ContentTranslation").Y = 0;
    }

    private void Save()
    {
        settings.Save();
        Find<TextBlock>("SaveError").Visibility = settings.SaveFailed ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RefreshTime()
    {
        var now = DateTimeOffset.Now;
        var culture = CultureInfo.GetCultureInfo(settings.Language == "de" ? "de-DE" : "en-US");
        Find<TextBlock>("ClockValue").Text = now.ToString("HH:mm", culture);
        Find<TextBlock>("DateValue").Text = now.ToString("ddd, dd. MMM", culture);
        var elapsed = settings.Timer.Elapsed(now.ToUniversalTime());
        var value = SessionTimer.Format(elapsed);
        Find<TextBlock>("HomeTimerValue").Text = value; Find<TextBlock>("TimerValue").Text = value;
        var state = Text(settings.Timer.IsRunning ? "Running" : elapsed > TimeSpan.Zero ? "Paused" : "Ready");
        Find<TextBlock>("HomeTimerState").Text = state; Find<TextBlock>("TimerState").Text = state;
        SetButtonText(Find<Button>("ToggleTimer"), Text(settings.Timer.IsRunning ? "Pause" : elapsed > TimeSpan.Zero ? "Resume" : "Start"));
    }

    private void RefreshPower()
    {
        try
        {
            var status = PowerManager.BatteryStatus;
            var percent = PowerManager.RemainingChargePercent;
            var absent = status == BatteryStatus.NotPresent;
            Find<TextBlock>("BatteryValue").Text = absent || percent < 0 || percent > 100 ? "—" : $"{percent}%";
            Find<TextBlock>("BatteryState").Text = Text(absent ? "NoBattery" : status == BatteryStatus.Charging ? "Charging" :
                PowerManager.PowerSupplyStatus == PowerSupplyStatus.Adequate ? "PluggedIn" : "OnBattery");
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            Find<TextBlock>("BatteryValue").Text = "—"; Find<TextBlock>("BatteryState").Text = Text("Unavailable");
        }
    }

    private void RefreshTarget()
    {
        try
        {
            Find<TextBlock>("ContextValue").Text = tracker is null ? Text("Standalone") :
                tracker.Setting != XboxGameBarAppTargetSetting.Enabled ? Text("TargetDisabled") :
                tracker.GetTarget()?.DisplayName is string name && !string.IsNullOrWhiteSpace(name) ? name : Text("NoTarget");
        }
        catch (System.Runtime.InteropServices.COMException) { Find<TextBlock>("ContextValue").Text = Text("TargetUnavailable"); }
    }

    private void Refresh() { RefreshTime(); RefreshPower(); RefreshTarget(); }

    internal void SetActive(bool value)
    {
        if (disposed || value == active) return;
        active = value;
        if (active)
        {
            PowerManager.BatteryStatusChanged += OnPowerChanged;
            PowerManager.RemainingChargePercentChanged += OnPowerChanged;
            PowerManager.PowerSupplyStatusChanged += OnPowerChanged;
            if (tracker is not null) { tracker.TargetChanged += OnTargetChanged; tracker.SettingChanged += OnTargetChanged; }
            ApplyText(); UpdateNav(); Refresh(); ApplyScale(); ticker.Start();
        }
        else
        {
            ticker.Stop(); StopTransition();
            PowerManager.BatteryStatusChanged -= OnPowerChanged;
            PowerManager.RemainingChargePercentChanged -= OnPowerChanged;
            PowerManager.PowerSupplyStatusChanged -= OnPowerChanged;
            if (tracker is not null) { tracker.TargetChanged -= OnTargetChanged; tracker.SettingChanged -= OnTargetChanged; }
            Save();
        }
    }

    internal void RefreshHost() { if (!disposed) ApplyScale(); }
    private void OnTick(object? sender, object args) => RefreshTime();
    private void OnPowerChanged(object? sender, object args) => Dispatch(RefreshPower);
    private void OnTargetChanged(XboxGameBarAppTargetTracker sender, object args) => Dispatch(RefreshTarget);
    private void OnSettingsChanged() => Dispatch(() => { ApplyText(); UpdateNav(); Refresh(); });

    private async void Dispatch(Action action)
    {
        try { await Dispatcher.RunAsync(CoreDispatcherPriority.Normal, () => { if (!disposed && active) action(); }); }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or TaskCanceledException) { }
    }

    public void Dispose()
    {
        if (disposed) return;
        SetActive(false); disposed = true;
        Loaded -= OnLoaded; KeyDown -= OnKeyDown; ticker.Tick -= OnTick;
        settings.Changed -= OnSettingsChanged;
    }
}
