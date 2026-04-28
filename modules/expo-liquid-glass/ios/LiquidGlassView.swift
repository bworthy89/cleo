import ExpoModulesCore
import UIKit

class LiquidGlassView: ExpoView {
  /// Underlying visual effect view — owns the glass material on iOS 26+ and
  /// renders transparent on iOS 16-18. Sized to fill the host bounds.
  private let effectView: UIVisualEffectView

  /// Cached intensity so we can re-apply the effect when the prop changes.
  /// Defaults to "regular" — Apple's standard glass material.
  private var intensity: String = "regular"

  required init(appContext: AppContext? = nil) {
    self.effectView = UIVisualEffectView(effect: nil)
    super.init(appContext: appContext)
    addSubview(effectView)
    applyEffect()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    effectView.frame = bounds
  }

  func setIntensity(_ value: String) {
    intensity = value
    applyEffect()
  }

  private func applyEffect() {
    if #available(iOS 26.0, *) {
      // UIGlassEffect is the iOS 26 system Liquid Glass material. The
      // initializer is non-throwing — if Apple's API ever fails it would do
      // so by returning a nil-effect view, which renders identically to the
      // iOS < 26 fallback (transparent passthrough). Intensity values aren't
      // currently differentiated; variable kept for forward-compat.
      effectView.effect = UIGlassEffect()
    } else {
      // iOS 16.2 / 18 fallback: transparent — host's parent provides the
      // background. Consumers gate their own solid background on the
      // isLiquidGlassAvailable JS constant.
      effectView.effect = nil
    }
  }
}
