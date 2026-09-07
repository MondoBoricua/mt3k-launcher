using Windows.UI.Xaml;

namespace OrbitHud;

internal static class Program
{
    [MTAThread]
    private static void Main()
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(_ => new App());
    }
}
