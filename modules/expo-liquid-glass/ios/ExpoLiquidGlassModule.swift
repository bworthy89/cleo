import ExpoModulesCore
import UIKit

public class ExpoLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLiquidGlass")

    // Compile-time iOS version check exposed to JS as a boolean constant.
    // JS consumers gate their solid-background fallback on this rather than
    // sniffing Platform.Version.
    Constants([
      "isAvailable": {
        if #available(iOS 26.0, *) { return true }
        return false
      }()
    ])

    View(LiquidGlassView.self) {
      Prop("intensity") { (view: LiquidGlassView, value: String) in
        view.setIntensity(value)
      }
    }
  }
}
