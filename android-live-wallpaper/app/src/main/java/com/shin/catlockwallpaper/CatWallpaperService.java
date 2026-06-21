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
    private static final String BASE_URL = "https://oysterlab.github.io/lockscreen/";

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
            registerReceiver(screenReceiver, f);
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
                unregisterSensor();
                if (webView != null) webView.onPause();
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
            if (surface == null || width <= 1 || height <= 1) return;
            int densityDpi = getResources().getDisplayMetrics().densityDpi;
            virtualDisplay = displayManager.createVirtualDisplay(
                    "catlock", width, height, densityDpi, surface,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION);
            if (virtualDisplay == null) return;

            presentation = new Presentation(CatWallpaperService.this, virtualDisplay.getDisplay());
            presentation.getWindow().setType(android.view.WindowManager.LayoutParams.TYPE_APPLICATION);
            FrameLayout container = new FrameLayout(presentation.getContext());

            webView = new WebView(presentation.getContext());
            WebSettings s = webView.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setCacheMode(WebSettings.LOAD_DEFAULT);
            webView.setBackgroundColor(0xff19130f);
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    pageReady = true;
                }
            });
            container.addView(webView, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            presentation.setContentView(container);
            try {
                presentation.show();
            } catch (Exception ignored) {
                return;
            }
            pageReady = false;
            webView.loadUrl(BASE_URL + "?scene=" + currentScene());
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
            if (sensorManager != null && tiltSensor != null) {
                sensorManager.registerListener(this, tiltSensor, SensorManager.SENSOR_DELAY_GAME);
            }
        }

        private void unregisterSensor() {
            if (sensorManager != null) {
                sensorManager.unregisterListener(this);
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
            if (!visible || webView == null || !pageReady) return;
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
                if (Intent.ACTION_SCREEN_OFF.equals(a)) {
                    // reset baseline so re-show recentres
                    baseValid = 0f;
                } else {
                    // re-register defensively (One UI may have dropped it)
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
