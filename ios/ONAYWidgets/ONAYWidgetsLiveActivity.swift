import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - ONAY design tokens (duplicated from src/tokens/design-tokens.ts)

private enum ONAY {
    static let warmBlack = Color(red: 0.043, green: 0.035, blue: 0.027)
    static let ink       = Color(red: 0.957, green: 0.925, blue: 0.863)
    static let inkDim    = Color(red: 0.957, green: 0.925, blue: 0.863).opacity(0.55)
    static let amber     = Color(red: 0.910, green: 0.635, blue: 0.294)
    static let amberDim  = Color(red: 0.910, green: 0.635, blue: 0.294).opacity(0.55)
    static let onAirRed  = Color(red: 0.643, green: 0.227, blue: 0.180)

    /// Per-vibe accent. Keep aligned with VibeArtworkRenderer.accent in
    /// the ExpoMusicKit pod — if one changes, update both.
    static func vibeAccent(_ vibe: String) -> Color {
        switch vibe {
        case "morning":    return Color(red: 0.957, green: 0.780, blue: 0.478)
        case "focus":      return Color(red: 0.435, green: 0.722, blue: 0.608)
        case "workout":    return Color(red: 0.769, green: 0.271, blue: 0.192)
        case "lateNight":  return Color(red: 0.431, green: 0.310, blue: 0.557)
        case "melancholy": return Color(red: 0.420, green: 0.482, blue: 0.557)
        case "party":      return Color(red: 0.878, green: 0.306, blue: 0.518)
        default:           return amber  // feelGood + unknown
        }
    }
}

// MARK: - Shared widget building blocks

/// Animated on-air dot. Pulses while `active`, static otherwise.
private struct OnAirDot: View {
    var active: Bool
    var size: CGFloat = 6
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(active ? ONAY.onAirRed : ONAY.inkDim)
            .frame(width: size, height: size)
            .shadow(color: active ? ONAY.onAirRed : .clear, radius: active ? 4 : 0)
            .opacity(active ? (pulse ? 1.0 : 0.5) : 1.0)
            .onAppear {
                if active {
                    withAnimation(.easeInOut(duration: 1.1).repeatForever()) {
                        pulse.toggle()
                    }
                }
            }
    }
}

/// ONAY wordmark in JetBrains Mono-ish tracking. We don't ship the
/// custom font to the extension (would require bundling it); the
/// system monospaced font is close enough at this scale.
private struct OnayMark: View {
    var size: CGFloat = 10
    var color: Color = ONAY.amber

    var body: some View {
        Text("ONAY")
            .font(.system(size: size, weight: .medium, design: .monospaced))
            .tracking(size * 0.22)
            .foregroundStyle(color)
    }
}

/// Small 5-bar waveform placeholder. Could animate but widget CPU
/// budget is tight; render static bars for now.
private struct Waveform: View {
    var color: Color = ONAY.amber
    var height: CGFloat = 14

    private let heights: [CGFloat] = [0.38, 0.70, 1.0, 0.65, 0.38]

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(heights.indices, id: \.self) { i in
                Capsule()
                    .fill(color)
                    .frame(width: 2, height: height * heights[i])
            }
        }
        .frame(height: height)
    }
}

/// The "tonight on ONAY · LATE NIGHT" header row.
private struct OnayHeaderRow: View {
    var vibe: String
    var playing: Bool

    var body: some View {
        HStack(spacing: 6) {
            OnAirDot(active: playing, size: 5)
            OnayMark(size: 9)
            Text("· \(vibe.uppercased())")
                .font(.system(size: 9, weight: .regular, design: .monospaced))
                .tracking(1.4)
                .foregroundStyle(ONAY.inkDim)
        }
    }
}

// MARK: - Lock-screen layout

/// The card that lives above MusicKit's Now Playing tile on the lock
/// screen. Max height ~160pt per Apple's guidance.
private struct BroadcastLockScreenView: View {
    let context: ActivityViewContext<BroadcastActivityAttributes>

    private var isBetween: Bool {
        context.state.kind != "track"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            OnayHeaderRow(
                vibe: context.attributes.vibe,
                playing: context.state.playing
            )

            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.state.title.uppercased())
                        .font(.system(size: 19, weight: .semibold, design: .serif))
                        .foregroundStyle(ONAY.ink)
                        .lineLimit(1)

                    Text(context.state.subtitle)
                        .font(.system(size: 13, weight: .regular, design: .serif))
                        .italic()
                        .foregroundStyle(ONAY.inkDim)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 6) {
                    Waveform(
                        color: ONAY.vibeAccent(context.attributes.vibe),
                        height: 16
                    )
                    if !isBetween {
                        Text("TRK \(String(format: "%02d", context.state.trackNumber)) / \(String(format: "%02d", context.attributes.totalTracks))")
                            .font(.system(size: 9, weight: .regular, design: .monospaced))
                            .tracking(1.2)
                            .foregroundStyle(ONAY.inkDim)
                    } else {
                        Text(betweenLabel)
                            .font(.system(size: 9, weight: .regular, design: .monospaced))
                            .tracking(1.2)
                            .foregroundStyle(ONAY.inkDim)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .activityBackgroundTint(ONAY.warmBlack)
        .activitySystemActionForegroundColor(ONAY.amber)
    }

    private var betweenLabel: String {
        switch context.state.kind {
        case "cold_open":  return "COLD OPEN"
        case "sign_off":   return "SIGN OFF"
        default:           return "BETWEEN"
        }
    }
}

// MARK: - Live Activity definition

struct ONAYWidgetsLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BroadcastActivityAttributes.self) { context in
            BroadcastLockScreenView(context: context)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded — user long-presses the cutout
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        OnAirDot(active: context.state.playing, size: 6)
                        OnayMark(size: 10)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.vibe.uppercased())
                        .font(.system(size: 10, weight: .regular, design: .monospaced))
                        .tracking(1.4)
                        .foregroundStyle(ONAY.vibeAccent(context.attributes.vibe))
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(context.state.title)
                            .font(.system(size: 15, weight: .semibold, design: .serif))
                            .foregroundStyle(ONAY.ink)
                            .lineLimit(1)
                        Text(context.state.subtitle)
                            .font(.system(size: 11, design: .serif))
                            .italic()
                            .foregroundStyle(ONAY.inkDim)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Waveform(color: ONAY.vibeAccent(context.attributes.vibe), height: 10)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 2)
                }
            } compactLeading: {
                HStack(spacing: 3) {
                    OnAirDot(active: context.state.playing, size: 4)
                    OnayMark(size: 8)
                }
            } compactTrailing: {
                Text(context.state.kind == "track"
                     ? "\(context.state.trackNumber)/\(context.attributes.totalTracks)"
                     : "···")
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .tracking(0.8)
                    .foregroundStyle(ONAY.amber)
            } minimal: {
                OnAirDot(active: context.state.playing, size: 6)
            }
            .keylineTint(ONAY.vibeAccent(context.attributes.vibe))
        }
    }
}

// MARK: - Xcode preview

extension BroadcastActivityAttributes {
    fileprivate static var preview: BroadcastActivityAttributes {
        BroadcastActivityAttributes(
            broadcastId: "preview-b1",
            vibe: "lateNight",
            totalTracks: 9
        )
    }
}

extension BroadcastActivityAttributes.ContentState {
    fileprivate static var playingTrack: BroadcastActivityAttributes.ContentState {
        .init(kind: "track", title: "Golden Hours", subtitle: "Brian Eno",
              trackNumber: 3, playing: true)
    }
    fileprivate static var betweenTracks: BroadcastActivityAttributes.ContentState {
        .init(kind: "transition", title: "Between tracks",
              subtitle: "ONAY · LATE NIGHT", trackNumber: 3, playing: true)
    }
}

// #Preview omitted — the macro is iOS 17+ only and gating it through
// @available / #if doesn't reliably carry through macro expansion at
// 16.2 deployment target. If you want previews, bump the extension's
// target to 17 locally while iterating.
