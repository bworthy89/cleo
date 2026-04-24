import Foundation
import UIKit
import MediaPlayer

final class NowPlayingController {
    private let center = MPNowPlayingInfoCenter.default()
    private let commands = MPRemoteCommandCenter.shared()
    private let renderer = VibeArtworkRenderer()
    private var current: [String: Any] = [:]
    private var lastVibe: String = "feelGood"

    /// Wire iOS remote-command events into RN-emitted callbacks. Skip / prev /
    /// scrub commands are intentionally left unregistered so iOS hides those
    /// buttons. ChangePlaybackPosition is explicitly registered + rejected so
    /// a drag gesture is a no-op rather than letting iOS guess.
    ///
    /// Idempotent: removes any previously registered targets first so repeated
    /// calls (e.g. a future module re-instantiation) don't stack duplicate
    /// handlers on the shared MPRemoteCommandCenter singleton.
    func activate(onPlay: @escaping () -> Void,
                  onPause: @escaping () -> Void) {
        commands.playCommand.removeTarget(nil)
        commands.pauseCommand.removeTarget(nil)
        commands.changePlaybackPositionCommand.removeTarget(nil)

        commands.playCommand.isEnabled = true
        commands.playCommand.addTarget { _ in onPlay(); return .success }
        commands.pauseCommand.isEnabled = true
        commands.pauseCommand.addTarget { _ in onPause(); return .success }
        commands.changePlaybackPositionCommand.isEnabled = false
        commands.changePlaybackPositionCommand.addTarget { _ in .commandFailed }
    }

    func clear() {
        current.removeAll()
        center.nowPlayingInfo = nil
    }

    /// Configure the tile for a real track. Caller (BroadcastPlayer.runTrackAt)
    /// should invoke this BEFORE music.play so the ONAY card paints the moment
    /// the audio session becomes active. The 1Hz elapsed pump re-asserts the
    /// full dict every second to overwrite any MusicKit clobber.
    func setTrack(title: String, artist: String, vibe: String, duration: Double) {
        lastVibe = vibe
        let art = renderer.render(vibe: vibe, kind: .track)
        current = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: "ONAY · \(vibe.uppercased())",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPMediaItemPropertyArtwork: MPMediaItemArtwork(
                boundsSize: art.size, requestHandler: { _ in art }),
        ]
        center.nowPlayingInfo = current
    }

    /// Configure the tile for a voice segment (cold_open, transition, sign_off).
    /// No duration → iOS hides the scrubber (matches the "ONAY is talking, not
    /// scrubbable" intent). Title varies by kind so the user can read the
    /// state at a glance.
    func setSegment(vibe: String, kind: String) {
        lastVibe = vibe
        let normalizedKind: String
        switch kind {
        case "cold_open", "transition", "sign_off": normalizedKind = kind
        default: normalizedKind = "transition"
        }
        let title: String
        switch normalizedKind {
        case "cold_open":  title = "Cold open"
        case "sign_off":   title = "Sign-off"
        default:           title = "Between tracks"
        }
        let art = renderer.render(vibe: vibe, kind: .between)
        current = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "ONAY · \(vibe.uppercased())",
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPMediaItemPropertyArtwork: MPMediaItemArtwork(
                boundsSize: art.size, requestHandler: { _ in art }),
        ]
        center.nowPlayingInfo = current
    }

    /// Push elapsed-time + playing flag without rebuilding the dict. Called
    /// from the RN-side 1Hz pump while a track is in flight, and once on
    /// pause/resume so the lock-screen play icon flips correctly.
    func setElapsed(_ seconds: Double, playing: Bool) {
        guard !current.isEmpty else { return }
        current[MPNowPlayingInfoPropertyElapsedPlaybackTime] = seconds
        current[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        center.nowPlayingInfo = current
    }

    /// Re-assert the stored dict. Called from the module's 0.5s playback
    /// timer to stomp on MusicKit's continuous `nowPlayingInfo` rewrites —
    /// `ApplicationMusicPlayer` auto-populates the tile on every state tick
    /// and will overwrite our branded card otherwise. No-op when we have
    /// nothing staged (pre-start or post-clear).
    func reassert() {
        guard !current.isEmpty else { return }
        center.nowPlayingInfo = current
    }
}
