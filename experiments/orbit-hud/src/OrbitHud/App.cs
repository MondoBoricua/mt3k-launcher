using Microsoft.Gaming.XboxGameBar;
using OrbitHud.Services;
using OrbitHud.Views;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Core;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace OrbitHud;

internal sealed partial class App : Application
{
    private readonly Dictionary<Window, HudWindow> windows = new();
    private readonly HudSettings settings = new();

    internal App()
    {
        Suspending += OnSuspending;
        Resuming += OnResuming;
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (args.PrelaunchActivated) return;
        ApplicationView.PreferredLaunchViewSize = new Windows.Foundation.Size(480, 740);
        ApplicationView.PreferredLaunchWindowingMode = ApplicationViewWindowingMode.PreferredLaunchViewSize;
        if (!windows.ContainsKey(Window.Current)) CreateView(null);
        ApplicationView.GetForCurrentView().SetPreferredMinSize(new Windows.Foundation.Size(360, 400));
        Window.Current.Activate();
    }

    protected override void OnActivated(IActivatedEventArgs args)
    {
        if (args is not XboxGameBarWidgetActivatedEventArgs activation || activation.AppExtensionId != "OrbitHud") return;
        // Repeated activation retains the existing widget and its CoreWindow.
        if (activation.IsLaunchActivation && !windows.ContainsKey(Window.Current)) CreateView(activation);
        Window.Current.Activate();
    }

    private void CreateView(XboxGameBarWidgetActivatedEventArgs? activation)
    {
        var window = Window.Current;
        windows.Add(window, new HudWindow(window, settings, activation, () => windows.Remove(window)));
    }

    private void OnSuspending(object sender, SuspendingEventArgs args)
    {
        foreach (var view in windows.Values.ToArray()) view.SetSuspended(true);
    }

    private void OnResuming(object? sender, object args)
    {
        foreach (var view in windows.Values.ToArray()) view.SetSuspended(false);
    }
}

internal sealed class HudWindow : IDisposable
{
    private readonly Window window;
    private readonly XboxGameBarWidget? widget;
    private readonly HudPage page;
    private readonly Action closed;
    private readonly SystemNavigationManager navigation;
    private bool disposed, suspended;

    internal HudWindow(Window window, HudSettings settings, XboxGameBarWidgetActivatedEventArgs? activation, Action closed)
    {
        this.window = window;
        this.closed = closed;
        SynchronizationContext.SetSynchronizationContext(new HudSynchronizationContext(window.Dispatcher));
        var frame = new Frame();
        window.Content = frame;
        if (activation is not null)
        {
            widget = new XboxGameBarWidget(activation, window.CoreWindow, frame);
            widget.VisibleChanged += OnWidgetChanged;
            widget.CompactModeEnabledChanged += OnWidgetChanged;
        }
        page = new HudPage(settings, widget, Close);
        frame.Content = page;
        navigation = SystemNavigationManager.GetForCurrentView();
        navigation.BackRequested += OnBackRequested;
        window.Closed += OnClosed;
        window.VisibilityChanged += OnVisibilityChanged;
        page.SetActive(widget?.Visible ?? window.Visible);
    }

    private void Close()
    {
        if (widget is not null) widget.Close();
        else window.Close();
    }

    private void OnClosed(object sender, CoreWindowEventArgs args) => Dispose();
    private void OnBackRequested(object? sender, BackRequestedEventArgs args) => args.Handled = page.HandleBack();
    private void OnVisibilityChanged(object sender, VisibilityChangedEventArgs args) => UpdateVisibility();
    private async void OnWidgetChanged(XboxGameBarWidget sender, object args)
    {
        try
        {
            await window.Dispatcher.RunAsync(CoreDispatcherPriority.Normal, () =>
            {
                if (disposed) return;
                page.RefreshHost(); UpdateVisibility();
            });
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or TaskCanceledException) { }
    }

    internal void SetSuspended(bool value) { suspended = value; UpdateVisibility(); }
    private void UpdateVisibility() => page.SetActive(!suspended && (widget?.Visible ?? window.Visible));

    public void Dispose()
    {
        if (disposed) return;
        disposed = true; page.Dispose();
        window.Closed -= OnClosed;
        window.VisibilityChanged -= OnVisibilityChanged;
        navigation.BackRequested -= OnBackRequested;
        if (widget is not null)
        {
            widget.VisibleChanged -= OnWidgetChanged;
            widget.CompactModeEnabledChanged -= OnWidgetChanged;
        }
        closed();
    }
}

internal sealed class HudSynchronizationContext(CoreDispatcher dispatcher) : SynchronizationContext
{
    public override void Post(SendOrPostCallback callback, object? state) =>
        _ = dispatcher.RunAsync(CoreDispatcherPriority.Normal, () => callback(state));
    public override SynchronizationContext CreateCopy() => new HudSynchronizationContext(dispatcher);
}
