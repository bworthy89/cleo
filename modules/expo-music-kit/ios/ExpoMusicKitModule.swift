import ExpoModulesCore
import MusicKit
import Combine
import AVFoundation

public class ExpoMusicKitModule: Module {
  private let player = ApplicationMusicPlayer.shared
  private var queueObservation: AnyCancellable?
  private var playbackTimer: Timer?
  private var lastTrackId: String?
  private var audioPlayer: AVAudioPlayer?
  private var audioDelegate: AudioPlayerDelegate?
  private var cachedTracks: [String: Track] = [:]

  public func definition() -> ModuleDefinition {
    Name("ExpoMusicKit")

    Events("onTrackChanged", "onPlaybackStateChanged")

    // MARK: - Authorization

    AsyncFunction("authorize") { () -> [String: Any] in
      let status = await MusicAuthorization.request()
      let subscription = try? await MusicSubscription.current
      return [
        "status": self.statusString(status),
        "canPlayCatalog": subscription?.canPlayCatalogContent ?? false
      ]
    }

    AsyncFunction("getAuthorizationStatus") { () -> String in
      let status = MusicAuthorization.currentStatus
      return self.statusString(status)
    }

    // MARK: - Playlists

    AsyncFunction("fetchPlaylists") { () -> [[String: Any]] in
      var request = MusicLibraryRequest<Playlist>()
      request.sort(by: \.lastPlayedDate, ascending: false)
      let response = try await request.response()

      // Resolve artwork in parallel using TaskGroup
      let playlistItems = Array(response.items)

      let results: [[String: Any]] = await withTaskGroup(of: [String: Any].self) { group in
        for playlist in playlistItems {
          group.addTask {
            var dict: [String: Any] = [
              "id": playlist.id.rawValue,
              "name": playlist.name
            ]
            if let trackCount = playlist.tracks?.count {
              dict["trackCount"] = trackCount
            }

            // Try playlist artwork first
            if let artworkUrl = self.artworkUrlString(playlist.artwork, width: 300, height: 300) {
              dict["artworkUrl"] = artworkUrl
            } else {
              // Fall back to first track's catalog artwork
              let detailed = try? await playlist.with(.tracks, preferredSource: .catalog)
              if let firstTrack = detailed?.tracks?.first,
                 let artworkUrl = self.artworkUrlString(firstTrack.artwork, width: 300, height: 300) {
                dict["artworkUrl"] = artworkUrl
              }
            }
            return dict
          }
        }

        var collected: [[String: Any]] = []
        for await result in group {
          collected.append(result)
        }
        return collected
      }

      // TaskGroup returns results in completion order, not insertion order.
      // Re-sort to match the original lastPlayedDate order.
      let idOrder = playlistItems.map { $0.id.rawValue }
      let sorted = results.sorted { a, b in
        let aIndex = idOrder.firstIndex(of: a["id"] as! String) ?? Int.max
        let bIndex = idOrder.firstIndex(of: b["id"] as! String) ?? Int.max
        return aIndex < bIndex
      }
      return sorted
    }

    AsyncFunction("fetchPlaylistTracks") { (playlistId: String) -> [[String: Any]] in
      var request = MusicLibraryRequest<Playlist>()
      request.filter(matching: \.id, equalTo: MusicItemID(playlistId))
      let response = try await request.response()

      guard let playlist = response.items.first else {
        throw NSError(
          domain: "ExpoMusicKit",
          code: 404,
          userInfo: [NSLocalizedDescriptionKey: "Playlist not found"]
        )
      }

      let detailedPlaylist = try await playlist.with(.tracks, preferredSource: .catalog)

      guard let tracks = detailedPlaylist.tracks else {
        return []
      }

      // Cache tracks for later queue building
      for track in tracks {
        self.cachedTracks[track.id.rawValue] = track
      }

      return tracks.map { self.trackToDictionary($0) }
    }

    // MARK: - Playback

    AsyncFunction("play") { (trackIds: [String]?) in
      if let trackIds = trackIds, !trackIds.isEmpty {
        // Use cached tracks from fetchPlaylistTracks, preserving requested order
        let orderedTracks = trackIds.compactMap { self.cachedTracks[$0] }

        if !orderedTracks.isEmpty {
          player.queue = ApplicationMusicPlayer.Queue(for: orderedTracks)
        } else {
          // Fallback: try fetching as Songs
          let musicItemIds = trackIds.map { MusicItemID($0) }
          var request = MusicLibraryRequest<Song>()
          request.filter(matching: \.id, memberOf: musicItemIds)
          let response = try await request.response()
          let songMap = Dictionary(uniqueKeysWithValues: response.items.map { ($0.id.rawValue, $0) })
          let orderedSongs = trackIds.compactMap { songMap[$0] }
          player.queue = ApplicationMusicPlayer.Queue(for: orderedSongs)
        }
      }
      try await player.play()
    }

    // Set queue to new track order without restarting current track
    AsyncFunction("setUpcomingQueue") { (trackIds: [String]) in
      // Use cached tracks, preserving requested order
      let orderedTracks = trackIds.compactMap { self.cachedTracks[$0] }
      guard !orderedTracks.isEmpty else { return }

      // Insert upcoming tracks after the current entry
      try await self.player.queue.insert(
        ApplicationMusicPlayer.Queue(for: orderedTracks),
        position: .afterCurrentEntry
      )
    }

    AsyncFunction("pause") { () in
      player.pause()
    }

    AsyncFunction("skip") { () in
      try await player.skipToNextEntry()
    }

    AsyncFunction("skipToPrevious") { () in
      try await player.skipToPreviousEntry()
    }

    AsyncFunction("seekTo") { (time: Double) in
      player.playbackTime = time
    }

    // MARK: - Now Playing

    AsyncFunction("getNowPlaying") { () -> [String: Any]? in
      guard let entry = player.queue.currentEntry else {
        return nil
      }
      var result: [String: Any] = [
        "title": entry.title,
        "artistName": entry.subtitle ?? "",
        "playbackTime": player.playbackTime,
        "status": self.playbackStatusString(player.state.playbackStatus)
      ]
      // Try to get full metadata from song item
      if case .song(let song) = entry.item {
        let trackInfo = self.songToDictionary(song)
        result.merge(trackInfo) { _, new in new }
      }
      // Also look up artwork from cached tracks
      let trackId: String? = {
        if case .song(let song) = entry.item { return song.id.rawValue }
        return nil
      }()
      if let trackId = trackId, let cached = self.cachedTracks[trackId] {
        if let artworkUrl = self.artworkUrlString(cached.artwork, width: 800, height: 800) {
          result["artworkUrl"] = artworkUrl
        }
      }
      if trackId != nil { result["id"] = trackId }
      return result
    }

    AsyncFunction("getPlaybackTime") { () -> Double in
      return player.playbackTime
    }

    AsyncFunction("getPlaybackStatus") { () -> String in
      return self.playbackStatusString(player.state.playbackStatus)
    }

    // MARK: - Audio Playback (for TTS)

    AsyncFunction("playAudioFromBase64") { (base64String: String, promise: Promise) in
      guard let data = Data(base64Encoded: base64String) else {
        promise.reject("ERR", "Invalid base64 audio data")
        return
      }

      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)

        self.audioPlayer = try AVAudioPlayer(data: data)
        self.audioDelegate = AudioPlayerDelegate { [weak self] in
          self?.audioPlayer = nil
          self?.audioDelegate = nil
          // Deactivate ducking session, then resume MusicKit playback
          try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
          Task {
            try? await self?.player.play()
          }
          promise.resolve(nil)
        }
        self.audioPlayer?.delegate = self.audioDelegate
        self.audioPlayer?.play()
      } catch {
        promise.reject("ERR", error.localizedDescription)
      }
    }

    AsyncFunction("activateDuckingSession") {
      try AVAudioSession.sharedInstance().setCategory(
        .playback,
        mode: .default,
        options: [.duckOthers]
      )
      try AVAudioSession.sharedInstance().setActive(true)
    }

    AsyncFunction("deactivateDuckingSession") {
      try AVAudioSession.sharedInstance().setActive(
        false,
        options: .notifyOthersOnDeactivation
      )
    }

    // MARK: - Observation Lifecycle

    OnStartObserving {
      self.startObserving()
    }

    OnStopObserving {
      self.stopObserving()
    }
  }

  // MARK: - Private Helpers

  private func statusString(_ status: MusicAuthorization.Status) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    @unknown default: return "unknown"
    }
  }

  private func playbackStatusString(_ status: ApplicationMusicPlayer.PlaybackStatus) -> String {
    switch status {
    case .playing: return "playing"
    case .paused: return "paused"
    case .stopped: return "stopped"
    case .interrupted: return "interrupted"
    case .seekingForward: return "seekingForward"
    case .seekingBackward: return "seekingBackward"
    @unknown default: return "unknown"
    }
  }

  private func artworkUrlString(_ artwork: Artwork?, width: Int, height: Int) -> String? {
    guard let artwork = artwork,
          let url = artwork.url(width: width, height: height) else { return nil }
    let urlString = url.absoluteString
    // MusicKit returns musickit:// URLs for local library items — these can't be loaded by React Native Image.
    // Filter to only return http/https URLs.
    if urlString.hasPrefix("http") {
      return urlString
    }
    return nil
  }

  private func trackToDictionary(_ track: Track) -> [String: Any] {
    var dict: [String: Any] = [
      "id": track.id.rawValue,
      "title": track.title,
      "artistName": track.artistName,
      "albumTitle": track.albumTitle ?? "",
      "duration": track.duration ?? 0,
      "genreNames": track.genreNames,
      "trackNumber": track.trackNumber ?? 0,
      "discNumber": track.discNumber ?? 0
    ]
    if let artworkUrl = artworkUrlString(track.artwork, width: 800, height: 800) {
      dict["artworkUrl"] = artworkUrl
    }
    return dict
  }

  private func songToDictionary(_ song: Song) -> [String: Any] {
    var dict: [String: Any] = [
      "id": song.id.rawValue,
      "title": song.title,
      "artistName": song.artistName,
      "albumTitle": song.albumTitle ?? "",
      "duration": song.duration ?? 0,
      "genreNames": song.genreNames,
      "trackNumber": song.trackNumber ?? 0,
      "discNumber": song.discNumber ?? 0
    ]
    if let artworkUrl = artworkUrlString(song.artwork, width: 800, height: 800) {
      dict["artworkUrl"] = artworkUrl
    }
    return dict
  }

  private func startObserving() {
    // Observe queue changes for track change detection
    queueObservation = player.queue.objectWillChange.sink { [weak self] _ in
      guard let self = self else { return }
      DispatchQueue.main.async {
        let currentId: String? = {
          guard let entry = self.player.queue.currentEntry else {
            return nil
          }
          // Extract ID from any item type
          switch entry.item {
          case .song(let song):
            return song.id.rawValue
          case .musicVideo(let mv):
            return mv.id.rawValue
          @unknown default:
            // Fallback: use entry title as identifier
            return entry.title
          }
        }()

        if currentId != self.lastTrackId {
          let previousTrackId = self.lastTrackId
          self.lastTrackId = currentId
          var event: [String: Any] = [:]
          if let currentId = currentId {
            event["trackId"] = currentId
          }
          if let previousTrackId = previousTrackId {
            event["previousTrackId"] = previousTrackId
          }
          self.sendEvent("onTrackChanged", event)
        }
      }
    }

    // Timer-based polling for playback state
    playbackTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      let status = self.playbackStatusString(self.player.state.playbackStatus)
      let time = self.player.playbackTime
      self.sendEvent("onPlaybackStateChanged", [
        "status": status,
        "playbackTime": time
      ])
    }
  }

  private func stopObserving() {
    queueObservation?.cancel()
    queueObservation = nil
    playbackTimer?.invalidate()
    playbackTimer = nil
  }
}

class AudioPlayerDelegate: NSObject, AVAudioPlayerDelegate {
  let onFinish: () -> Void

  init(onFinish: @escaping () -> Void) {
    self.onFinish = onFinish
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    onFinish()
  }
}
