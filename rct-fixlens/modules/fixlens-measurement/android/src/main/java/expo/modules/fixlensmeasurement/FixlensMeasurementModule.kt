package expo.modules.fixlensmeasurement

import android.content.Intent
import com.google.ar.core.ArCoreApk
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FixlensMeasurementModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FixlensMeasurement")
    AsyncFunction("isSupported") { promise: Promise ->
      val context = appContext.reactContext
      if(context==null) promise.resolve(false)
      else ArCoreApk.getInstance().checkAvailabilityAsync(context) { availability -> promise.resolve(availability.isSupported) }
    }
    AsyncFunction("capture") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("AR_UNAVAILABLE", "No active camera screen. Try again.", null)
      } else activity.runOnUiThread {
        if (MeasurementActivity.pending != null) {
          promise.reject("AR_BUSY", "A surface capture is already open.", null)
        } else {
          MeasurementActivity.pending = promise
          try { activity.startActivity(Intent(activity, MeasurementActivity::class.java)) }
          catch (error: Exception) {
            MeasurementActivity.pending = null
            promise.reject("AR_UNAVAILABLE", "Surface capture is unavailable. Use a reference card.", error)
          }
        }
      }
    }
  }
}
