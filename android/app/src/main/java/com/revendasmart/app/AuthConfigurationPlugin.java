package com.revendasmart.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;

/** Exposes readiness only. Provider identifiers and credentials never cross this bridge. */
@CapacitorPlugin(name = "AuthConfiguration")
public class AuthConfigurationPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean firebaseConfigured = !FirebaseApp.getApps(getContext()).isEmpty();
        boolean facebookConfigured = !getContext().getString(R.string.facebook_app_id).isEmpty()
            && !getContext().getString(R.string.facebook_client_token).isEmpty();
        result.put("firebaseConfigured", firebaseConfigured);
        result.put("facebookConfigured", facebookConfigured);
        call.resolve(result);
    }
}
