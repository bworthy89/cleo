import WidgetKit
import SwiftUI

@main
struct ONAYWidgetsBundle: WidgetBundle {
    var body: some Widget {
        // Only the broadcast Live Activity is wired up for now.
        // ONAYWidgets.swift (home-screen widget) and ONAYWidgetsControl.swift
        // (Control Center widget) are still in the target but not registered,
        // so they don't show up in the iOS widget gallery.
        ONAYWidgetsLiveActivity()
    }
}
