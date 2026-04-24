// Intentionally empty. Xcode's Widget Extension template creates a
// `ControlWidget` here (iOS 18+ Control Center widget). We only ship a
// Live Activity at this deployment target (16.2), so this file is
// blanked out to avoid the template's ControlWidgetConfiguration API
// calls failing the build. The file is still in the target's compile
// sources list (managed in project.pbxproj); removing it from the
// target would require an Xcode UI pass.
//
// If we ever want a Control Center toggle, restore the template
// contents and gate the whole struct with `if #available(iOS 18.0, *)`.
