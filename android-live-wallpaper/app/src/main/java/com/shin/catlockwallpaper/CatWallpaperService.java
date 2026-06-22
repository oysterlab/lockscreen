package com.shin.catlockwallpaper;

import android.app.Presentation;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Handler;
import android.os.Looper;
import android.service.wallpaper.WallpaperService;
import android.view.Display;
import android.view.Surface;
import android.view.View;
import android.view.SurfaceHolder;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.FrameLayout;

/**
 * Web live wallpaper: renders the GitHub Pages depth-parallax lockscreen (the
 * cherry/nila/latte chibi dioramas) inside a hardware-accelerated WebView, shown on a
 * VirtualDisplay whose surface IS the wallpaper surface (so WebGL composites correctly).
 *
 * Tilt is driven from a NATIVE WAKEUP rotation-vector sensor and injected into the page
 * via window.__nativeTilt(x, y). The browser's own DeviceOrientation is suspended on the
 * Samsung lock screen; a wakeup sensor keeps firing there, so this works on S23+.
 */
public class CatWallpaperService extends WallpaperService {

    static final String PREFS = "catlock_prefs";
    static final String KEY_SCENE = "scene";
    static final String DEFAULT_SCENE = "cherry2dio";
    static final String ACTION_SCENE_CHANGED =
            "com.shin.catlockwallpaper.action.SCENE_CHANGED";
    static final String EXTRA_SCENE = "scene";
    private static final String BASE_URL = "file:///android_asset/index.html";
    private static final String WALLPAPER_UI_JS =
            "(function(){"
                    + "document.documentElement.classList.add('wallpaper-mode');"
                    + "var nodes=document.querySelectorAll('.clock,.controls,.status');"
                    + "for(var i=0;i<nodes.length;i++){nodes[i].style.display='none';}"
                    + "})();";

    @Override
    public WallpaperService.Engine onCreateEngine() {
        return new WebEngine();
    }

    private final class WebEngine extends WallpaperService.Engine
            implements SensorEventListener {

        private final Handler handler = new Handler(Looper.getMainLooper());
        private DisplayManager displayManager;
        private VirtualDisplay virtualDisplay;
        private Presentation presentation;
        private WebView webView;
        private SensorManager sensorManager;
        private Sensor tiltSensor;
        private boolean tiltSensorIsWakeup;
        private boolean sensorRegistered;
        private ScreenReceiver screenReceiver;

        private int width = 1;
        private int height = 1;
        private boolean visible;
        private boolean pageReady;

        // smoothing + baseline so "flat-ish" holding maps to centre
        private float baseValid;
        private float basePitch;
        private float baseRoll;
        private final float[] rotMatrix = new float[9];
        private final float[] orientation = new float[3];

        @Override
        public void onCreate(SurfaceHolder surfaceHolder) {
            super.onCreate(surfaceHolder);
            setTouchEventsEnabled(true);
            displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
            pickTiltSensor();
            screenReceiver = new ScreenReceiver();
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_SCREEN_ON);
            f.addAction(Intent.ACTION_SCREEN_OFF);
            f.addAction(Intent.ACTION_USER_PRESENT);
            f.addAction(ACTION_SCENE_CHANGED);
            registerInternalReceiver(screenReceiver, f);
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int w, int h) {
            super.onSurfaceChanged(holder, format, w, h);
            width = Math.max(1, w);
            height = Math.max(1, h);
            rebuildPresentation(holder.getSurface());
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            unregisterSensor();
            tearDownPresentation();
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onVisibilityChanged(boolean isVisible) {
            visible = isVisible;
            // One UI can fire this unreliably on the lock screen, so the ScreenReceiver
            // also (re)registers the sensor. Keep both paths.
            if (isVisible) {
                registerSensor();
                if (webView != null) webView.onResume();
            } else {
                // Samsung Launcher can report false while the home wallpaper is still
                // materially visible behind the launcher. Keep native tilt alive; screen
                // off and surface destruction are the hard stop paths.
            }
        }

        @Override
        public void onDestroy() {
            if (screenReceiver != null) {
                try { unregisterReceiver(screenReceiver); } catch (Exception ignored) {}
                screenReceiver = null;
            }
            unregisterSensor();
            tearDownPresentation();
            super.onDestroy();
        }

        /* ---------- WebView in a Presentation on a VirtualDisplay ---------- */

        private void rebuildPresentation(Surface surface) {
            tearDownPresentation();
            if (surface == null || width <= 1 || height <= 1) {
                android.util.Log.w("CatLock", "rebuild skipped surface=" + surface + " " + width + "x" + height);
                return;
            }
            try {
                int densityDpi = getResources().getDisplayMetrics().densityDpi;
                virtualDisplay = displayManager.createVirtualDisplay(
                        "catlock", width, height, densityDpi, surface,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION);
                if (virtualDisplay == null) {
                    android.util.Log.e("CatLock", "createVirtualDisplay returned null");
                    return;
                }
                WebView.setWebContentsDebuggingEnabled(
                        (getApplicationInfo().flags
                                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
                presentation = new Presentation(getApplicationContext(), virtualDisplay.getDisplay());
                android.view.Window pw = presentation.getWindow();
                pw.setType(android.view.WindowManager.LayoutParams.TYPE_PRIVATE_PRESENTATION);
                // force a hardware-accelerated, translucent window so the WebView's WebGL
                // canvas composites onto the virtual-display surface (else the GL content
                // is invisible / black).
                pw.addFlags(android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
                pw.setFormat(PixelFormat.TRANSLUCENT);
                FrameLayout container = new FrameLayout(presentation.getContext());

                webView = new WebView(presentation.getContext());
                webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
                WebSettings s = webView.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setAllowFileAccess(true);
                s.setAllowContentAccess(true);
                s.setAllowFileAccessFromFileURLs(true);
                s.setMediaPlaybackRequiresUserGesture(false);
                s.setCacheMode(WebSettings.LOAD_DEFAULT);
                webView.setBackgroundColor(0xff19130f);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        applyWallpaperMode(v);
                        pageReady = true;
                        android.util.Log.i("CatLock", "page finished: " + url);
                    }
                    @Override
                    public void onReceivedError(WebView v, android.webkit.WebResourceRequest req,
                                                android.webkit.WebResourceError err) {
                        android.util.Log.e("CatLock", "web error: " + err.getDescription());
                    }
                });
                webView.setWebChromeClient(new android.webkit.WebChromeClient() {
                    @Override
                    public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                        android.util.Log.i("CatLock", "console: " + m.message());
                        return true;
                    }
                });
                container.addView(webView, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                presentation.setContentView(container);
                presentation.show();
                pageReady = false;
                loadScene(currentScene(), "initial load");
                if (webView != null) webView.onResume();
                registerSensor();
            } catch (Throwable t) {
                android.util.Log.e("CatLock", "rebuild failed", t);
            }
        }

        private void tearDownPresentation() {
            pageReady = false;
            if (webView != null) {
                try { webView.loadUrl("about:blank"); webView.destroy(); } catch (Exception ignored) {}
                webView = null;
            }
            if (presentation != null) {
                try { presentation.dismiss(); } catch (Exception ignored) {}
                presentation = null;
            }
            if (virtualDisplay != null) {
                try { virtualDisplay.release(); } catch (Exception ignored) {}
                virtualDisplay = null;
            }
        }

        private String currentScene() {
            SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return p.getString(KEY_SCENE, DEFAULT_SCENE);
        }

        private void loadScene(String scene, String reason) {
            if (webView == null) return;
            pageReady = false;
            baseValid = 0f;
            String url = BASE_URL + "?scene=" + scene + "&wallpaper=1&app=0.2.4";
            int displayId = virtualDisplay != null
                    ? virtualDisplay.getDisplay().getDisplayId()
                    : Display.DEFAULT_DISPLAY;
            android.util.Log.i("CatLock", "loading " + url + " on display "
                    + displayId + " (" + reason + ")");
            webView.loadUrl(url);
        }

        private void applyWallpaperMode(WebView v) {
            try {
                v.evaluateJavascript(WALLPAPER_UI_JS, null);
            } catch (Exception ignored) {}
        }

        private void registerInternalReceiver(BroadcastReceiver receiver, IntentFilter filter) {
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(receiver, filter);
            }
        }

        /* ---------- sensor: wakeup rotation vector -> JS bridge ---------- */

        private void pickTiltSensor() {
            if (sensorManager == null) return;
            // Prefer a WAKEUP game-rotation-vector (keeps firing on the lock screen).
            tiltSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR, true);
            tiltSensorIsWakeup = tiltSensor != null;
            if (tiltSensor == null) {
                tiltSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR, true);
                tiltSensorIsWakeup = tiltSensor != null;
            }
            if (tiltSensor == null) {
                tiltSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
            }
            if (tiltSensor == null) {
                tiltSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            }
            if (tiltSensor == null) {
                tiltSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            }
        }

        private void registerSensor() {
            if (!sensorRegistered && sensorManager != null && tiltSensor != null) {
                sensorManager.registerListener(this, tiltSensor, SensorManager.SENSOR_DELAY_GAME);
                sensorRegistered = true;
            }
        }

        private void unregisterSensor() {
            if (sensorRegistered && sensorManager != null) {
                sensorManager.unregisterListener(this);
                sensorRegistered = false;
            }
        }

        @Override
        public void onSensorChanged(SensorEvent event) {
            int type = event.sensor.getType();
            float pitch; // forward/back tilt
            float roll;  // left/right tilt
            if (type == Sensor.TYPE_ACCELEROMETER) {
                roll = -event.values[0] / SensorManager.GRAVITY_EARTH;
                pitch = event.values[1] / SensorManager.GRAVITY_EARTH;
            } else {
                SensorManager.getRotationMatrixFromVector(rotMatrix, event.values);
                SensorManager.getOrientation(rotMatrix, orientation);
                // orientation: [azimuth, pitch, roll] in radians
                pitch = orientation[1];
                roll = orientation[2];
            }
            if (baseValid == 0f) {
                basePitch = pitch;
                baseRoll = roll;
                baseValid = 1f;
            }
            // relative to the hold baseline; small tilt reaches full effect (range ~0.5 rad)
            float nx = clamp((roll - baseRoll) / 0.5f, -1f, 1f);
            float ny = clamp((pitch - basePitch) / 0.5f, -1f, 1f);
            pushTilt(nx, ny);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
        }

        private void pushTilt(final float nx, final float ny) {
            if (webView == null || !pageReady) return;
            final WebView wv = webView;
            handler.post(() -> {
                if (wv == null) return;
                try {
                    wv.evaluateJavascript(
                            "window.__nativeTilt&&window.__nativeTilt(" + nx + "," + ny + ")", null);
                } catch (Exception ignored) {}
            });
        }

        private final class ScreenReceiver extends BroadcastReceiver {
            @Override
            public void onReceive(Context context, Intent intent) {
                String a = intent.getAction();
                if (ACTION_SCENE_CHANGED.equals(a)) {
                    String scene = intent.getStringExtra(EXTRA_SCENE);
                    loadScene(scene != null ? scene : currentScene(), "scene changed");
                    return;
                }
                if (Intent.ACTION_SCREEN_OFF.equals(a)) {
                    // reset baseline so re-show recentres
                    baseValid = 0f;
                    visible = false;
                    unregisterSensor();
                    if (webView != null) webView.onPause();
                } else {
                    // One UI can miss the normal visibility callback on the lock screen.
                    // Treat screen-on/user-present as visible enough for sensor-driven parallax.
                    visible = true;
                    if (webView != null) webView.onResume();
                    unregisterSensor();
                    registerSensor();
                }
            }
        }

        private float clamp(float v, float min, float max) {
            return Math.max(min, Math.min(max, v));
        }
    }
}
