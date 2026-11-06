package com.spendvault.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "CardScan",
    permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")]
)
class CardScanPlugin : Plugin() {

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val ret = JSObject()
        ret.put("supported", context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY))
        call.resolve(ret)
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) launch(call)
        else requestPermissionForAlias("camera", call, "onCameraPermission")
    }

    @PermissionCallback
    private fun onCameraPermission(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) launch(call)
        else call.reject("Camera permission denied", "PERMISSION_DENIED")
    }

    private fun launch(call: PluginCall) {
        startActivityForResult(call, Intent(context, CardScanActivity::class.java), "onScanResult")
    }

    @ActivityCallback
    private fun onScanResult(call: PluginCall?, result: ActivityResult) {
        call ?: return
        val data = result.data
        val pan = data?.getStringExtra(CardScanActivity.EXTRA_PAN)
        if (result.resultCode != Activity.RESULT_OK || pan == null) {
            if (data?.getStringExtra(CardScanActivity.EXTRA_ERROR) != null) call.reject("Camera unavailable", "UNAVAILABLE")
            else call.reject("Cancelled", "CANCELLED")
            return
        }
        val ret = JSObject()
        ret.put("cardNumber", pan)
        if (data.hasExtra(CardScanActivity.EXTRA_EXPIRY_MONTH)) {
            ret.put("expiryMonth", data.getIntExtra(CardScanActivity.EXTRA_EXPIRY_MONTH, 0))
            ret.put("expiryYear", data.getIntExtra(CardScanActivity.EXTRA_EXPIRY_YEAR, 0))
        }
        data.getStringExtra(CardScanActivity.EXTRA_NETWORK)?.let { ret.put("network", it) }
        call.resolve(ret)
    }
}
