# Model Viewer

A simple Windows desktop viewer for **STEP (.step/.stp)**, **OBJ** and **STL** files.

- Rotate (left-drag), pan (right-drag or Shift+left-drag), zoom (wheel), fit view (F)
- Wireframe, edge overlay, grid/axes, Z-up toggle
- Shows mesh/triangle count and bounding box
- Open via double-click in Explorer, the *Open file…* button, or drag-and-drop
- Works offline — all libraries are bundled

Built with [three.js](https://threejs.org/) for rendering, [occt-import-js](https://github.com/kovacsv/occt-import-js)
(OpenCascade) for STEP, and [pywebview](https://pywebview.flowrl.com/) (Edge WebView2) for the native window.

## Build and install

Requires Python 3.10+ and Windows 10/11 (WebView2 runtime is preinstalled on Windows 11).

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1     # builds dist\ModelViewer\ModelViewer.exe
powershell -ExecutionPolicy Bypass -File install.ps1   # installs for the current user, no admin needed
```

`install.ps1` copies the app to `%LOCALAPPDATA%\Programs\ModelViewer`, adds a Start menu shortcut, an entry in
*Settings → Apps*, and registers the file types. It becomes the default for any of these types that has no app yet;
for types where you already chose a default, pick it once via right-click → *Open with* → *Choose another app* →
*Model Viewer* → *Always*.

Uninstall from *Settings → Apps*, or run `uninstall.ps1`.

## Project layout

| Path | Purpose |
| --- | --- |
| `web/index.html` | The viewer (three.js scene, loaders, UI) |
| `web/vendor/` | Bundled three.js and occt-import-js |
| `model_viewer.py` | Desktop wrapper: local HTTP server + native window, takes a file path argument |
| `build.ps1` / `install.ps1` / `uninstall.ps1` | Build and per-user install scripts |
| `samples/` | Test cube in OBJ and STL |

You can also open `web/index.html` directly from a local web server (e.g. `python -m http.server -d web`) to use it in a browser.
