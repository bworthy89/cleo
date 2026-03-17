import ExpoModulesCore
import MusicKit
import Combine

public class ExpoMusicKitModule: Module {
  private let player = ApplicationMusicPlayer.shared
  private var queueObservation: AnyCancellable?
  private var playbackTimer: Timer?
  private var lastTrackId: String?

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

      // For playlists without HTTP artwork, try to get artwork from their first track via catalog
      var results: [[String: Any]] = []
      for playlist in response.items {
        var dict: [String: Any] = [
          "id": playlist.id.rawValue,
          "name": playlist.name
        ]
        if let trackCount = playlist.tracks?.count {
          dict["trackCount"] = trackCount
        }

        // Try playlist artwork first
        if let artworkUrl = self.artworkUrlString(playlist.artwork, width: 600, height: 600) {
          dict["artworkUrl"] = artworkUrl
        } else {
          // Fall back to first track's catalog artwork
          let detailed = try? await playlist.with(.tracks, preferredSource: .catalog)
          if let firstTrack = detailed?.tracks?.first,
             let artworkUrl = self.artworkUrlString(firstTrack.artwork, width: 600, height: 600) {
            dict["artworkUrl"] = artworkUrl
          }
        }
        results.append(dict)
      }
      return results
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

      return tracks.map { self.trackToDictionary($0) }
    }

    // MARK: - Playback

    AsyncFunction("play") { (trackIds: [String]?) in
      if let trackIds = trackIds, !trackIds.isEmpty {
        let musicItemIds = trackIds.map { MusicItemID($0) }
        var request = MusicLibraryRequest<Song>()
        request.filter(matching: \.id, memberOf: musicItemIds)
        let response = try await request.response()
        let songs = response.items
        player.queue = ApplicationMusicPlayer.Queue(for: songs)
      }
      try await player.play()
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
        "playbackTime": player.playbackTime,
        "status": self.playbackStatusString(player.state.playbackStatus)
      ]
      if case .song(let song) = entry.item {
        let trackInfo = self.songToDictionary(song)
        result.merge(trackInfo) { _, new in new }
      }
      return result
    }

    AsyncFunction("getPlaybackTime") { () -> Double in
      return player.playbackTime
    }

    AsyncFunction("getPlaybackStatus") { () -> String in
      return self.playbackStatusString(player.state.playbackStatus)
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
          guard let entry = self.player.queue.currentEntry,
                case .song(let song) = entry.item else {
            return nil
          }
          return song.id.rawValue
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
