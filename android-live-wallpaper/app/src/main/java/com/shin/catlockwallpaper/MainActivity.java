package com.shin.catlockwallpaper;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {

    // label -> scene query param (must match assets/photo3d_<scene>/ on the site)
    private static final String[][] SCENES = {
            {"체리 (회색 + 녹색모자)", "cherry2dio"},
            {"라떼 (주황 장모)", "latte2dio"},
            {"닐라 (흰 먼치킨)", "nila2dio"},
    };

    private LinearLayout list;
    private String selected;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SharedPreferences prefs = getSharedPreferences(
                CatWallpaperService.PREFS, MODE_PRIVATE);
        selected = prefs.getString(CatWallpaperService.KEY_SCENE,
                CatWallpaperService.DEFAULT_SCENE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(36), dp(24), dp(24));
        root.setBackgroundColor(0xff19130f);

        TextView title = new TextView(this);
        title.setText("My Cat 3D Lock");
        title.setTextColor(0xfffff2d7);
        title.setTextSize(28);
        title.setGravity(Gravity.CENTER);
        root.addView(title, wrap());

        TextView body = new TextView(this);
        body.setText("고양이를 고르고 잠금화면 배경으로 설정하세요.");
        body.setTextColor(0xccfff2d7);
        body.setTextSize(15);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, dp(8), 0, dp(14));
        root.addView(body, wrap());

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list, match());
        renderChoices();

        Button setButton = new Button(this);
        setButton.setText(getString(R.string.open_wallpaper));
        setButton.setAllCaps(false);
        setButton.setOnClickListener(v -> openWallpaperSetter());
        LinearLayout.LayoutParams bp = wrap();
        bp.topMargin = dp(20);
        root.addView(setButton, bp);

        setContentView(root);
    }

    private void renderChoices() {
        list.removeAllViews();
        for (String[] s : SCENES) {
            String label = s[0];
            String scene = s[1];
            boolean active = scene.equals(selected);
            TextView row = new TextView(this);
            row.setText((active ? "●  " : "○  ") + label);
            row.setTextColor(active ? 0xffffd79b : 0xffded3c4);
            row.setTextSize(18);
            row.setPadding(dp(18), dp(14), dp(18), dp(14));
            row.setBackgroundColor(active ? 0xff2c2117 : 0xff211a12);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(8);
            row.setOnClickListener(v -> {
                selected = scene;
                persistAndNotifyScene(scene);
                renderChoices();
            });
            list.addView(row, lp);
        }
    }

    private void openWallpaperSetter() {
        // persist selection (already saved on tap, but ensure it)
        persistAndNotifyScene(selected);

        ComponentName component = new ComponentName(this, CatWallpaperService.class);
        Intent intent = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
        intent.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component);
        try {
            startActivity(intent);
        } catch (Exception ignored) {
            try {
                startActivity(new Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER));
            } catch (Exception secondFailure) {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            }
        }
    }

    private LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams match() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void persistAndNotifyScene(String scene) {
        getSharedPreferences(CatWallpaperService.PREFS, MODE_PRIVATE)
                .edit().putString(CatWallpaperService.KEY_SCENE, scene).commit();
        Intent intent = new Intent(CatWallpaperService.ACTION_SCENE_CHANGED);
        intent.setPackage(getPackageName());
        intent.putExtra(CatWallpaperService.EXTRA_SCENE, scene);
        sendBroadcast(intent);
    }
}
