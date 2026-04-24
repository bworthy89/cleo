import ActivityKit
import Foundation

/// Shared ActivityKit attributes describing an ONAY broadcast Live Activity.
///
/// This struct exists in two places, MUST stay byte-identical in both:
/// - `modules/expo-music-kit/ios/BroadcastActivityAttributes.swift`
///   (compiled into ExpoMusicKit pod → main app, where the bridge lives)
/// - `ios/ONAYWidgets/BroadcastActivityAttributes.swift`
///   (compiled into the ONAYWidgets extension where the SwiftUI views live)
///
/// Any change to field names, types, or Codable conformance must be
/// mirrored in both files or the encoded ContentState dict will fail to
/// decode on the other side and the Live Activity will silently fail
/// to update.
public struct BroadcastActivityAttributes: ActivityAttributes {
    /// The broadcast UUID — stable for the life of one broadcast.
    public let broadcastId: String
    /// One of the 7 vibes: morning, focus, workout, feelGood, lateNight,
    /// melancholy, party. Drives the accent color + background gradient
    /// in the widget views.
    public let vibe: String
    /// Total tracks in the broadcast — used for "TRACK 3 OF 9" display.
    public let totalTracks: Int

    public struct ContentState: Codable, Hashable {
        /// "track" | "cold_open" | "transition" | "sign_off"
        public var kind: String
        /// Track title for track states; "Cold open" / "Between tracks" /
        /// "Sign-off" for segment states.
        public var title: String
        /// Artist for tracks; "ONAY · VIBE" for segments.
        public var subtitle: String
        /// 1-based track index, or 0 during cold_open.
        public var trackNumber: Int
        /// True during music playback (track or segment audibly playing),
        /// false while paused. Drives the waveform / play-pause visuals.
        public var playing: Bool

        public init(kind: String, title: String, subtitle: String,
                    trackNumber: Int, playing: Bool) {
            self.kind = kind
            self.title = title
            self.subtitle = subtitle
            self.trackNumber = trackNumber
            self.playing = playing
        }
    }

    public init(broadcastId: String, vibe: String, totalTracks: Int) {
        self.broadcastId = broadcastId
        self.vibe = vibe
        self.totalTracks = totalTracks
    }
}
