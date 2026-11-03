package expo.modules.fixlensmeasurement

import android.app.Activity
import android.os.Bundle
import android.graphics.*
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.Image
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.view.Gravity
import android.view.Surface
import android.widget.*
import com.google.ar.core.*
import expo.modules.kotlin.Promise
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

class MeasurementActivity : Activity(), GLSurfaceView.Renderer {
  companion object { var pending: Promise? = null }
  private lateinit var surface: GLSurfaceView
  private lateinit var status: TextView
  private var session: Session? = null
  private var installRequested = false
  @Volatile private var shutter = false
  @Volatile private var done = false
  private var viewportWidth = 1
  private var viewportHeight = 1
  private var texture = 0
  private var program = 0
  private var sensorRotation = 90
  private val vertices = floats(floatArrayOf(-1f,-1f,1f,-1f,-1f,1f,1f,1f))
  private val uv = floats(FloatArray(8))

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (pending == null) { finish(); return }
    surface = GLSurfaceView(this).apply {
      setEGLContextClientVersion(2)
      preserveEGLContextOnPause = true
      setRenderer(this@MeasurementActivity)
      renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
    }
    val root = FrameLayout(this)
    root.addView(surface)
    root.addView(TextView(this).apply { text="+";textSize=40f;setTextColor(Color.WHITE);gravity=Gravity.CENTER },
      FrameLayout.LayoutParams(-2,-2,Gravity.CENTER))
    val controls=LinearLayout(this).apply {
      orientation=LinearLayout.VERTICAL;setPadding(24,24,24,48);setBackgroundColor(0xBB000000.toInt())
    }
    status=TextView(this).apply {setTextColor(Color.WHITE);text="Slowly move the phone to find the wall or floor. Aim + at the damage."}
    controls.addView(status)
    controls.addView(Button(this).apply {text="Capture surface";setOnClickListener {shutter=true}})
    controls.addView(Button(this).apply {text="Cancel";setOnClickListener {finishCapture(null)}})
    controls.addView(TextView(this).apply {
      text="Surface tracking runs on Google Play Services for AR (ARCore), provided by Google and governed by the Google Privacy Policy."
      setTextColor(Color.WHITE)
    })
    controls.addView(Button(this).apply {
      text="Google Privacy Policy"
      setOnClickListener { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,android.net.Uri.parse("https://policies.google.com/privacy"))) }
    })
    root.addView(controls,FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM))
    setContentView(root)
  }
  override fun onResume() {
    super.onResume()
    if (!::surface.isInitialized || done) return
    try {
      if (session == null) {
        if (ArCoreApk.getInstance().requestInstall(this,!installRequested)==ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
          installRequested=true;return
        }
        val created=Session(this)
        session=created
        val config=Config(created).apply {
          planeFindingMode=Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
          if(created.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) depthMode=Config.DepthMode.AUTOMATIC
        }
        created.configure(config)
        val manager=getSystemService(CAMERA_SERVICE) as CameraManager
        sensorRotation=manager.getCameraCharacteristics(created.cameraConfig.cameraId)
          .get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
      }
      session?.resume()
      surface.onResume()
    } catch (_: Exception) {
      message("Surface tracking is unavailable. Cancel and take a regular photo with a reference card.")
    }
  }
  override fun onPause() {
    if (::surface.isInitialized) surface.onPause()
    session?.pause()
    super.onPause()
  }
  override fun onDestroy() {
    session?.close();session=null
    if (!isChangingConfigurations && !done) { pending?.resolve(null);pending=null }
    super.onDestroy()
  }
  private fun finishCapture(result: Map<String,Any>?) {
    if(done)return
    done=true;pending?.resolve(result);pending=null;finish()
  }
  private fun message(text:String) {runOnUiThread {status.text=text}}
  override fun onSurfaceCreated(gl:GL10?,config:EGLConfig?) {
    val ids=IntArray(1);GLES20.glGenTextures(1,ids,0);texture=ids[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE)
    program=GLES20.glCreateProgram()
    GLES20.glAttachShader(program,shader(GLES20.GL_VERTEX_SHADER,"attribute vec2 p;attribute vec2 t;varying vec2 uv;void main(){gl_Position=vec4(p,0.,1.);uv=t;}"))
    GLES20.glAttachShader(program,shader(GLES20.GL_FRAGMENT_SHADER,"#extension GL_OES_EGL_image_external : require\nprecision mediump float;uniform samplerExternalOES image;varying vec2 uv;void main(){gl_FragColor=texture2D(image,uv);}"))
    GLES20.glLinkProgram(program)
  }
  override fun onSurfaceChanged(gl:GL10?,width:Int,height:Int) {
    viewportWidth=width;viewportHeight=height;GLES20.glViewport(0,0,width,height)
  }
  override fun onDrawFrame(gl:GL10?) {
    val current=session ?: return
    if(done)return
    try {
      @Suppress("DEPRECATION") val displayRotation=windowManager.defaultDisplay.rotation
      current.setDisplayGeometry(displayRotation,viewportWidth,viewportHeight)
      current.setCameraTextureName(texture)
      val frame=current.update()
      if(frame.timestamp==0L)return
      vertices.position(0);uv.position(0)
      frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,vertices,Coordinates2d.TEXTURE_NORMALIZED,uv)
      GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
      GLES20.glUseProgram(program)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"image"),0)
      val p=GLES20.glGetAttribLocation(program,"p");val t=GLES20.glGetAttribLocation(program,"t")
      vertices.position(0);uv.position(0)
      GLES20.glEnableVertexAttribArray(p);GLES20.glEnableVertexAttribArray(t)
      GLES20.glVertexAttribPointer(p,2,GLES20.GL_FLOAT,false,0,vertices)
      GLES20.glVertexAttribPointer(t,2,GLES20.GL_FLOAT,false,0,uv)
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4)
      GLES20.glDisableVertexAttribArray(p);GLES20.glDisableVertexAttribArray(t)
      if(shutter) {
        shutter=false
        if(frame.camera.trackingState!=TrackingState.TRACKING) {message("Tracking is not ready. Move slowly in good light.");return}
        val hit=frame.hitTest(viewportWidth/2f,viewportHeight/2f).firstOrNull {
          val plane=it.trackable
          plane is Plane && plane.trackingState==TrackingState.TRACKING && plane.isPoseInPolygon(it.hitPose)
        }
        if(hit==null) {message("No flat surface found at +. Scan the surface or use a reference card.");return}
        val plane=hit.trackable as Plane
        val center=hit.hitPose.translation
        val xAxis=plane.centerPose.xAxis;val zAxis=plane.centerPose.zAxis
        val inverse=frame.camera.pose.inverse()
        val intrinsics=frame.camera.imageIntrinsics
        val focal=intrinsics.focalLength;val principal=intrinsics.principalPoint
        frame.acquireCameraImage().use { image ->
          val w=image.width;val h=image.height
          val degrees=when(displayRotation){Surface.ROTATION_90->90;Surface.ROTATION_180->180;Surface.ROTATION_270->270;else->0}
          val rotation=(sensorRotation-degrees+360)%360
          val points=listOf(-.05f to -.05f,.05f to -.05f,.05f to .05f,-.05f to .05f).map { (a,b) ->
            val world=FloatArray(3){i->center[i]+a*xAxis[i]+b*zAxis[i]}
            val c=inverse.transformPoint(world)
            require(c[2]<-.05f)
            val u=focal[0]*c[0]/-c[2]+principal[0]
            val v=-focal[1]*c[1]/-c[2]+principal[1]
            require(u>=0 && v>=0 && u<=w && v<=h)
            val (px,py)=when(rotation){90->h-v to u;180->w-u to h-v;270->v to w-u;else->u to v}
            mapOf("x" to px.toDouble(),"y" to py.toDouble())
          }
          val jpeg=ByteArrayOutputStream()
          YuvImage(nv21(image),android.graphics.ImageFormat.NV21,w,h,null).compressToJpeg(Rect(0,0,w,h),95,jpeg)
          val bytes=jpeg.toByteArray()
          val raw=BitmapFactory.decodeByteArray(bytes,0,bytes.size)
          val upright=Bitmap.createBitmap(raw,0,0,w,h,Matrix().apply {postRotate(rotation.toFloat())},false)
          val file=File(cacheDir,"fixlens-ar-${java.util.UUID.randomUUID()}.jpg")
          file.outputStream().use {upright.compress(Bitmap.CompressFormat.JPEG,95,it)}
          val result=mapOf("uri" to android.net.Uri.fromFile(file).toString(),"width" to upright.width,"height" to upright.height,
            "calibration" to mapOf("method" to "arcore_plane","points" to points,"width_mm" to 100,"height_mm" to 100))
          if(upright!==raw)upright.recycle();raw.recycle()
          runOnUiThread {finishCapture(result)}
        }
      }
    } catch (_:Exception) {message("Could not capture this surface. Move back, scan slowly, and try again, or use a reference card.")}
  }
  private fun nv21(image:Image):ByteArray {
    val w=image.width;val h=image.height;val out=ByteArray(w*h*3/2)
    val planes=image.planes
    for(y in 0 until h)for(x in 0 until w)out[y*w+x]=planes[0].buffer.get(planes[0].buffer.position()+y*planes[0].rowStride+x*planes[0].pixelStride)
    var offset=w*h
    for(y in 0 until h/2)for(x in 0 until w/2) {
      out[offset++]=planes[2].buffer.get(planes[2].buffer.position()+y*planes[2].rowStride+x*planes[2].pixelStride)
      out[offset++]=planes[1].buffer.get(planes[1].buffer.position()+y*planes[1].rowStride+x*planes[1].pixelStride)
    }
    return out
  }
  private fun shader(kind:Int,source:String):Int = GLES20.glCreateShader(kind).also {
    GLES20.glShaderSource(it,source);GLES20.glCompileShader(it)
  }
  private fun floats(values:FloatArray):FloatBuffer = ByteBuffer.allocateDirect(values.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {put(values);position(0)}
}
