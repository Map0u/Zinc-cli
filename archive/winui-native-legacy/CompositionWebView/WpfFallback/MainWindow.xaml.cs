using System;
using System.IO;
using System.Windows;
using System.Windows.Input;

namespace WpfFallback;

/// <summary>
/// Fallback prototype: verifies (outside WinUI3) that a windowed WebView2
/// with DefaultBackgroundColor = Transparent, hosted in a WPF window with
/// AllowsTransparency, actually lets a gradient painted behind it bleed
/// through translucent HTML content. This does NOT use
/// CoreWebView2CompositionController and does NOT wire up Mica via
/// DirectComposition/MicaController -- see FEASIBILITY.md for why that part
/// was scoped out of this spike (no C++ toolchain available; the official
/// Microsoft WindowsAppSDK-Samples Mica-WebView2 C++ sample already
/// demonstrates the Mica+transparent-WebView2 combination and is cited
/// there as secondary evidence instead of being rebuilt here).
/// </summary>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        KeyDown += (_, e) => { if (e.Key == Key.Escape) Close(); };
        MouseLeftButtonDown += (_, _) => DragMove();
        Loaded += async (_, _) => await InitializeWebViewAsync();
    }

    private async System.Threading.Tasks.Task InitializeWebViewAsync()
    {
        await WebView.EnsureCoreWebView2Async();
        WebView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

        string htmlPath = Path.Combine(AppContext.BaseDirectory, "test.html");
        WebView.CoreWebView2.Navigate(new Uri(htmlPath).AbsoluteUri);

        File.WriteAllText(
            Path.Combine(AppContext.BaseDirectory, "attempt-result.log"),
            $"WPF fallback: WebView2.DefaultBackgroundColor set to Transparent, navigated to {htmlPath}. " +
            "Visual verification is by screenshot (see FEASIBILITY.md) -- there is no CompositionController " +
            "involved on this path, so there is no exception to log; the only question is whether the pixels " +
            "under the translucent HTML show the WPF gradient or an opaque fill.");
    }
}
