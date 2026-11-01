package local.sve.next;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * How the game's window turns: the settings' "Screen" (src/host/native.ts). "auto" turns with the phone (as the system's
 * rotation lock allows), "landscape" and "portrait" keep the window sideways or upright (either way round, by the sensor).
 * The choice is kept for the next start, which MainActivity applies before the page is shown. A tablet keeps the wide
 * layout, so its window stays sideways whatever is chosen.
 */
@CapacitorPlugin(name = "ScreenLock")
public class ScreenLockPlugin extends Plugin {
    private static final String PREFERENCES = "screen";
    private static final String MODE = "mode";

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode = call.getString("mode", "auto");
        getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(MODE, mode).apply();
        Activity activity = getActivity();
        activity.runOnUiThread(() -> apply(activity, mode));
        call.resolve();
    }

    /** The choice kept from the last time ("auto" before any). */
    static String storedMode(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(MODE, "auto");
    }

    static void apply(Activity activity, String mode) {
        boolean tablet = activity.getResources().getConfiguration().smallestScreenWidthDp >= 600;
        int orientation;
        if (tablet || "landscape".equals(mode)) orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        else if ("portrait".equals(mode)) orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        else orientation = ActivityInfo.SCREEN_ORIENTATION_USER;
        activity.setRequestedOrientation(orientation);
    }
}
