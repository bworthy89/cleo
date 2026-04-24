import ActivityKit
import Foundation

/// Thin wrapper around `Activity<BroadcastActivityAttributes>` that lets
/// the module's AsyncFunction handlers start / update / end a Live
/// Activity by dict payload from RN.
///
/// All methods are no-ops if Live Activities are disabled by the user
/// in Settings (handled via `ActivityAuthorizationInfo`) or if iOS
/// refuses the request. Failures are logged and swallowed so broadcast
/// playback is never blocked by a missing Live Activity.
@available(iOS 16.2, *)
final class BroadcastActivityBridge {
    private var activity: Activity<BroadcastActivityAttributes>?

    /// Start a new Live Activity. Ends any previous activity first
    /// (defensive — broadcast start should always be the authoritative
    /// reset point).
    func start(broadcastId: String,
               vibe: String,
               totalTracks: Int,
               state: BroadcastActivityAttributes.ContentState) async {
        await end()

        let info = ActivityAuthorizationInfo()
        guard info.areActivitiesEnabled else {
            print("[BroadcastActivity] user disabled Live Activities — skipping start")
            return
        }

        do {
            let attrs = BroadcastActivityAttributes(
                broadcastId: broadcastId, vibe: vibe, totalTracks: totalTracks
            )
            let content = ActivityContent(state: state, staleDate: nil)
            activity = try Activity.request(
                attributes: attrs, content: content, pushType: nil
            )
            print("[BroadcastActivity] started id=\(activity?.id ?? "<nil>")")
        } catch {
            print("[BroadcastActivity] start failed: \(error)")
        }
    }

    /// Update the dynamic content state of the current activity.
    /// No-op if no activity is live.
    func update(state: BroadcastActivityAttributes.ContentState) async {
        guard let activity = activity else { return }
        await activity.update(ActivityContent(state: state, staleDate: nil))
    }

    /// Dismiss the current activity immediately.
    ///
    /// Clears `self.activity` BEFORE awaiting `end()` so a concurrent second
    /// caller (e.g. BroadcastPlayer.end() races the runMainLoop natural-
    /// completion path) sees `nil` at the guard and bails out — otherwise
    /// both callers would have captured the same non-nil `activity` and
    /// double-called `Activity.end`.
    func end() async {
        guard let current = self.activity else { return }
        self.activity = nil
        await current.end(nil, dismissalPolicy: .immediate)
        print("[BroadcastActivity] ended")
    }
}
