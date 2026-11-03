import ExpoModulesCore
import ARKit
import UIKit
import CoreImage

public class FixlensMeasurementModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FixlensMeasurement")
    AsyncFunction("isSupported") { ARWorldTrackingConfiguration.isSupported }
    AsyncFunction("capture") { (promise: Promise) in
      guard ARWorldTrackingConfiguration.isSupported,
            let presenter = self.appContext?.utilities?.currentViewController(),
            presenter.presentedViewController == nil else {
        promise.reject("AR_UNAVAILABLE", "Surface tracking is unavailable. Use a regular photo with a reference card.")
        return
      }
      let controller = MeasurementController()
      controller.modalPresentationStyle = .fullScreen
      controller.complete = { result in promise.resolve(result) }
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)
  }
}

private class MeasurementController: UIViewController, ARSessionDelegate {
  let scene = ARSCNView()
  let status = UILabel()
  var complete: (([String: Any]?) -> Void)?
  private var finished = false
  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    scene.frame = view.bounds
    scene.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(scene)
    let crosshair = UILabel()
    crosshair.text = "+"; crosshair.textColor = .white; crosshair.font = .systemFont(ofSize: 40)
    crosshair.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(crosshair)
    status.textColor = .white; status.backgroundColor = UIColor.black.withAlphaComponent(0.7)
    status.numberOfLines = 0; status.textAlignment = .center
    status.text = "Slowly move the phone to find the wall or floor. Aim + at the damage."
    let shutter = UIButton(type: .system)
    shutter.setTitle("Capture surface", for: .normal)
    shutter.addTarget(self, action: #selector(capture), for: .touchUpInside)
    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.addTarget(self, action: #selector(cancelCapture), for: .touchUpInside)
    let controls = UIStackView(arrangedSubviews: [status, shutter, cancel])
    controls.axis = .vertical; controls.spacing = 14
    controls.backgroundColor = UIColor.black.withAlphaComponent(0.7)
    controls.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(controls)
    NSLayoutConstraint.activate([
      crosshair.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      crosshair.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
      controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
      controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16)
    ])
    scene.session.delegate = self
    scene.session.delegateQueue = .main
    NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification, object: nil)
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal, .vertical]
    if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) { config.frameSemantics.insert(.sceneDepth) }
    scene.session.run(config)
  }
  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    scene.session.pause()
    if !finished { finish(nil) }
  }
  deinit { NotificationCenter.default.removeObserver(self) }
  @objc func background() { finish(nil) }
  @objc func cancelCapture() { finish(nil) }
  func session(_ session: ARSession, didFailWithError error: Error) {
    status.text = "Tracking stopped. Cancel and take a regular photo with a reference card."
  }
  func sessionWasInterrupted(_ session: ARSession) {
    status.text = "Tracking interrupted. Cancel and try again."
  }
  @objc func capture() {
    guard let frame = scene.session.currentFrame, case .normal = frame.camera.trackingState else {
      status.text = "Tracking is not ready. Slowly move the phone across the surface in good light."
      return
    }
    let pose = frame.camera.transform
    let origin = SIMD3<Float>(pose.columns.3.x, pose.columns.3.y, pose.columns.3.z)
    let direction = -SIMD3<Float>(pose.columns.2.x, pose.columns.2.y, pose.columns.2.z)
    let query = ARRaycastQuery(origin: origin, direction: direction, allowing: .existingPlaneGeometry, alignment: .any)
    guard let hit = scene.session.raycast(query).first, let plane = hit.anchor as? ARPlaneAnchor else {
      status.text = "No flat surface found at +. Move slowly, or use a reference card in a regular photo."
      return
    }
    let rawW = CVPixelBufferGetWidth(frame.capturedImage), rawH = CVPixelBufferGetHeight(frame.capturedImage)
    let center = SIMD3<Float>(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
    let tx = plane.transform.columns.0, tz = plane.transform.columns.2
    let xAxis = SIMD3<Float>(tx.x, tx.y, tx.z), zAxis = SIMD3<Float>(tz.x, tz.y, tz.z)
    let inverse = simd_inverse(pose), k = frame.camera.intrinsics
    var points = [[String: Double]]()
    let offsets: [(Float,Float)] = [(-0.05,-0.05),(0.05,-0.05),(0.05,0.05),(-0.05,0.05)]
    for (a,b) in offsets {
      let world = center + a*xAxis + b*zAxis
      let c = inverse * SIMD4<Float>(world.x,world.y,world.z,1)
      guard c.z < -0.05 else { status.text = "Move farther back and face the surface."; return }
      let u = k.columns.0.x*c.x / -c.z + k.columns.2.x
      let v = -k.columns.1.y*c.y / -c.z + k.columns.2.y
      guard u >= 0, v >= 0, u <= Float(rawW), v <= Float(rawH) else {
        status.text = "Move farther back so the surface around + is visible."; return
      }
      // Raw sensor image rotated clockwise into the portrait JPEG below.
      points.append(["x": Double(Float(rawH)-v), "y": Double(u)])
    }
    let image = CIImage(cvPixelBuffer: frame.capturedImage)
    guard let cg = CIContext().createCGImage(image, from: image.extent) else { status.text = "Could not prepare photo. Try again."; return }
    let size = CGSize(width: CGFloat(rawH), height: CGFloat(rawW))
    let format = UIGraphicsImageRendererFormat(); format.scale = 1
    let upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      UIImage(cgImage: cg, scale: 1, orientation: .right).draw(in: CGRect(origin: .zero, size: size))
    }
    guard let jpeg = upright.jpegData(compressionQuality: 0.95) else { return }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("fixlens-ar-\(UUID().uuidString).jpg")
    do {
      try jpeg.write(to: url, options: .atomic)
      finish(["uri":url.absoluteString,"width":rawH,"height":rawW,
        "calibration":["method":"arkit_plane","points":points,"width_mm":100,"height_mm":100]])
    } catch { status.text = "Could not save the capture. Try again." }
  }
  private func finish(_ result: [String: Any]?) {
    guard !finished else { return }; finished = true
    scene.session.pause()
    dismiss(animated: true) { self.complete?(result); self.complete = nil }
  }
}
