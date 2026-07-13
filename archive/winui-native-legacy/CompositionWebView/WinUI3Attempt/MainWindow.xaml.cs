using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.Web.WebView2.Core;

namespace WinUI3Attempt;

/// <summary>
/// Spike: try to host a CoreWebView2CompositionController's browser visual
/// inside a WinUI3 XAML element's composition Visual
/// (Microsoft.UI.Composition.Visual, obtained via ElementCompositionPreview),
/// and see whether RootVisualTarget accepts it.
///
/// Per Microsoft.Web.WebView2.Core.CoreWebView2CompositionController docs,
/// RootVisualTarget is typed as `object` at the .NET API surface, but the
/// native setter only accepts an IDCompositionVisual or a
/// Windows::UI::Composition::ContainerVisual (the UWP/"lifted" WUC type,
/// backed by the dwm.exe compositor). WinUI3's ElementCompositionPreview
/// hands back a Microsoft.UI.Composition.Visual instead, which is a
/// different, in-process compositor (see
/// https://github.com/MicrosoftEdge/WebView2Feedback/issues/3439 — a
/// Microsoft WinUI engineer confirms there is no publicly supported way to
/// bridge the two, "by design"). This is expected to fail at the
/// RootVisualTarget assignment; the point of the spike is to capture the
/// *actual* failure mode against the SDK versions Zinc uses today
/// (WindowsAppSDK 2.2.0 / WebView2 runtime installed on this machine).
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly StringBuilder _log = new();
    private CoreWebView2CompositionController? _compositionController;

    public MainWindow()
    {
        InitializeComponent();
        _ = RunAttemptAsync();
    }

    private async Task RunAttemptAsync()
    {
        AppendLine($"WebView2 loader runtime: {CoreWebView2Environment.GetAvailableBrowserVersionString()}");

        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowRef = CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)hwnd);

            var environment = await CoreWebView2Environment.CreateAsync();
            AppendLine("CoreWebView2Environment created OK.");

            _compositionController = await environment.CreateCoreWebView2CompositionControllerAsync(windowRef);
            AppendLine("CoreWebView2CompositionController created OK (browser process spun up).");

            // Get the WinUI3 (Microsoft.UI.Composition) visual for HostGrid,
            // exactly as ElementCompositionPreview.GetElementVisual is used
            // in every UWP-era "attach a composition visual to a XAML
            // element" sample.
            Visual hostVisual = ElementCompositionPreview.GetElementVisual(HostGrid);
            Compositor compositor = hostVisual.Compositor;
            ContainerVisual container = compositor.CreateContainerVisual();
            container.RelativeSizeAdjustment = System.Numerics.Vector2.One;
            ElementCompositionPreview.SetElementChildVisual(HostGrid, container);
            AppendLine($"Got Microsoft.UI.Composition.ContainerVisual from HostGrid: {container.GetType().FullName}");

            AppendLine("Attempting: compositionController.RootVisualTarget = container; ...");
            try
            {
                _compositionController.RootVisualTarget = container;
                AppendLine("UNEXPECTED SUCCESS: RootVisualTarget accepted the Microsoft.UI.Composition.ContainerVisual with no exception.");

                _compositionController.Bounds = new Windows.Foundation.Rect(
                    0, 0, HostGrid.ActualWidth, HostGrid.ActualHeight);
                _compositionController.IsVisible = true;
                _compositionController.DefaultBackgroundColor = Windows.UI.Color.FromArgb(0, 0, 0, 0);
                _compositionController.CoreWebView2.Navigate(
                    new Uri(Path.Combine(AppContext.BaseDirectory, "test.html")).AbsoluteUri);
                AppendLine("Navigated. If any browser content is visible under the magenta HostGrid, the bridge is real.");
            }
            catch (Exception ex)
            {
                AppendLine("FAILED as expected. Exception assigning RootVisualTarget:");
                AppendLine($"  {ex.GetType().FullName}: {ex.Message}");
                if (ex is System.Runtime.InteropServices.COMException comEx)
                {
                    AppendLine($"  HRESULT: 0x{comEx.HResult:X8}");
                }
            }
        }
        catch (Exception ex)
        {
            AppendLine($"Setup failed before reaching RootVisualTarget: {ex.GetType().FullName}: {ex.Message}");
        }

        FlushLog();
    }

    private void AppendLine(string line)
    {
        _log.AppendLine(line);
        DispatcherQueue.TryEnqueue(() =>
        {
            StatusText.Text = _log.ToString();
        });
    }

    private void FlushLog()
    {
        try
        {
            string path = Path.Combine(AppContext.BaseDirectory, "attempt-result.log");
            File.WriteAllText(path, _log.ToString());
        }
        catch (IOException)
        {
        }
    }
}
