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
  private var ttsVolume: Float = 1.0
  private var cachedTracks: [String: Track] = [:]
  private var cachedSongs: [String: Song] = [:]
  private var cachedPlaylists: [String: Playlist] = [:]
  private var lastPlaybackStatus: ApplicationMusicPlayer.PlaybackStatus?
  private var ttsPromiseResolve: (() -> Void)? = nil
  private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid
  private var lifecycleObservers: [Any] = []
  private var silencePlayer: AVAudioPlayer?
  /// True while a BroadcastPlayer broadcast is in progress. When true, the
  /// 0.5s playback timer keeps running in background so end-of-track events
  /// reach the JS state machine and the broadcast can advance even when the
  /// phone is locked. When false, the timer is paused on background to save
  /// CPU (matches the original behavior).
  private var broadcastActive: Bool = false
  private let nowPlaying = NowPlayingController()

  public func definition() -> ModuleDefinition {
    Name("ExpoMusicKit")

    Events("onTrackChanged", "onPlaybackStateChanged",
           "onRemotePlay", "onRemotePause")

    OnCreate {
      self.nowPlaying.activate(
        onPlay:  { [weak self] in self?.sendEvent("onRemotePlay",  [:]) },
        onPause: { [weak self] in self?.sendEvent("onRemotePause", [:]) }
      )
    }

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
      let playlistItems = Array(response.items)

      // Build results — no catalog network calls for tracks.
      // playlist.with(.tracks, preferredSource: .catalog) can hang indefinitely
      // when Apple Music catalog is unreachable.
      // For artwork, we handle musickit:// URLs by caching locally.
      var results: [[String: Any]] = []
      for playlist in playlistItems {
        var dict: [String: Any] = [
          "id": playlist.id.rawValue,
          "name": playlist.name
        ]
        if let trackCount = playlist.tracks?.count {
          dict["trackCount"] = trackCount
        }
        if let artworkUrl = self.resolveArtworkUrl(playlist.artwork, id: playlist.id.rawValue, width: 300, height: 300) {
          dict["artworkUrl"] = artworkUrl
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
      // Try multiple strategies to resolve tracks. Catalog source is needed for
      // playback descriptors but can hang, so race against a timeout.
      let (tracks, entries) = try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<([Track], [Playlist.Entry]), Error>) in
        let resumed = MKAtomicFlag()

        Task {
          do {
            // Strategy 1: .tracks with catalog
            let withTracks = try await playlist.with(.tracks, preferredSource: .catalog)
            if let t = withTracks.tracks, !t.isEmpty {
              if resumed.trySet() {
                continuation.resume(returning: (Array(t), []))
              }
              return
            }

            // Strategy 2: .entries with catalog
            let withEntries = try await playlist.with(.entries, preferredSource: .catalog)
            if let e = withEntries.entries, !e.isEmpty {
              if resumed.trySet() {
                continuation.resume(returning: ([], Array(e)))
              }
              return
            }

            // Strategy 3: .entries without preferredSource
            let withEntriesDefault = try await playlist.with(.entries)
            if let e = withEntriesDefault.entries, !e.isEmpty {
              if resumed.trySet() {
                continuation.resume(returning: ([], Array(e)))
              }
              return
            }

            // Strategy 4: .tracks without preferredSource
            let withTracksDefault = try await playlist.with(.tracks)
            if let t = withTracksDefault.tracks, !t.isEmpty {
              if resumed.trySet() {
                continuation.resume(returning: (Array(t), []))
              }
              return
            }

            if resumed.trySet() {
              continuation.resume(returning: ([], []))
            }
          } catch {
            if resumed.trySet() {
              continuation.resume(throwing: error)
            }
          }
        }

        // 15s timeout
        Task {
          try? await Task.sleep(nanoseconds: 15_000_000_000)
          if resumed.trySet() {
            continuation.resume(throwing: NSError(
              domain: "ExpoMusicKit",
              code: -1,
              userInfo: [NSLocalizedDescriptionKey: "Catalog fetch timed out after 15s"]
            ))
          }
        }
      }

      // Build results from whichever strategy succeeded
      if !tracks.isEmpty {
        // Cache Track objects for queue building
        for track in tracks {
          self.cachedTracks[track.id.rawValue] = track
        }
        return tracks.map { self.trackToDictionary($0) }
      }

      if !entries.isEmpty {
        // Extract Song objects from entries for individual track playback + queue ordering
        var results: [[String: Any]] = []
        var songCount = 0
        var nilItemCount = 0
        var otherItemCount = 0
        for entry in entries {
          if let item = entry.item {
            if case .song(let song) = item {
              songCount += 1
              self.cachedSongs[song.id.rawValue] = song
              results.append(self.songToDictionary(song))
            } else {
              otherItemCount += 1
              // Non-song entry — use entry metadata
              var dict: [String: Any] = [
                "id": entry.id.rawValue,
                "title": entry.title,
                "artistName": entry.artistName,
                "albumTitle": entry.albumTitle ?? "",
                "duration": entry.duration ?? 0,
                "genreNames": entry.genreNames,
                "trackNumber": 0,
                "discNumber": 0
              ]
              if let artworkUrl = self.artworkUrlString(entry.artwork, width: 800, height: 800) {
                dict["artworkUrl"] = artworkUrl
              }
              results.append(dict)
            }
          } else {
            nilItemCount += 1
            // entry.item is nil — use entry metadata, entry ID
            var dict: [String: Any] = [
              "id": entry.id.rawValue,
              "title": entry.title,
              "artistName": entry.artistName,
              "albumTitle": entry.albumTitle ?? "",
              "duration": entry.duration ?? 0,
              "genreNames": entry.genreNames,
              "trackNumber": 0,
              "discNumber": 0
            ]
            if let artworkUrl = self.artworkUrlString(entry.artwork, width: 800, height: 800) {
              dict["artworkUrl"] = artworkUrl
            }
            results.append(dict)
          }
        }
        // Also cache playlist as last-resort fallback
        self.cachedPlaylists[playlistId] = playlist
        return results
      }

      // Last resort: cache the playlist for direct playback
      self.cachedPlaylists[playlistId] = playlist
      return []
    }

    // MARK: - Playback

    AsyncFunction("play") { (trackIds: [String]?, playlistId: String?) in
      // Cap initial queue to avoid crashing MusicKit's XPC connection
      // (1000+ items overloads the IPC channel). Remaining tracks are added
      // via setUpcomingQueue as playback progresses.
      let maxInitialQueue = 50

      if let trackIds = trackIds, !trackIds.isEmpty {
        let limitedIds = Array(trackIds.prefix(maxInitialQueue))

        // Strategy 1: cached Track objects (from .tracks)
        let orderedTracks = limitedIds.compactMap { self.cachedTracks[$0] }
        if !orderedTracks.isEmpty {
          self.player.queue = ApplicationMusicPlayer.Queue(for: orderedTracks)
        } else {
          // Strategy 2: cached Song objects (from .entries)
          var orderedSongs = limitedIds.compactMap { self.cachedSongs[$0] }

          // Strategy 3: fetch Song objects from the catalog by ID. Required for
          // pre-baked broadcasts where the manifest supplies Apple Music IDs
          // without anyone having called fetchPlaylistTracks/fetchPlaylists first.
          if orderedSongs.isEmpty {
            let missingIds = limitedIds.map { MusicItemID($0) }
            let request = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: missingIds)
            if let fetched = try? await request.response().items {
              // Build an ID -> Song dictionary to preserve the caller's order.
              var byId: [String: Song] = [:]
              for song in fetched {
                byId[song.id.rawValue] = song
                self.cachedSongs[song.id.rawValue] = song
              }
              orderedSongs = limitedIds.compactMap { byId[$0] }
            }
          }

          if !orderedSongs.isEmpty {
            self.player.queue = ApplicationMusicPlayer.Queue(for: orderedSongs)
          } else if let playlistId = playlistId, let playlist = self.cachedPlaylists[playlistId] {
            // Strategy 4: queue the whole playlist
            self.player.queue = [playlist]
          }
        }
      } else if let playlistId = playlistId, let playlist = self.cachedPlaylists[playlistId] {
        // No track IDs — queue playlist directly
        self.player.queue = [playlist]
      }

      try await self.player.play()
    }

    // Set queue to new track order without restarting current track
    AsyncFunction("setUpcomingQueue") { (trackIds: [String]) in
      // Try cached Track objects first, then cached Song objects
      let orderedTracks = trackIds.compactMap { self.cachedTracks[$0] }
      if !orderedTracks.isEmpty {
        for track in orderedTracks.reversed() {
          try await self.player.queue.insert(track, position: .afterCurrentEntry)
        }
      } else {
        let orderedSongs = trackIds.compactMap { self.cachedSongs[$0] }
        for song in orderedSongs.reversed() {
          try await self.player.queue.insert(song, position: .afterCurrentEntry)
        }
      }
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

    AsyncFunction("clearQueueCache") { () in
      self.cachedTracks.removeAll()
      self.cachedSongs.removeAll()
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

    AsyncFunction("getNextInQueue") { () -> [String: Any]? in
      let entries = Array(self.player.queue.entries)
      guard let currentEntry = self.player.queue.currentEntry else { return nil }
      guard let currentIndex = entries.firstIndex(where: { $0.id == currentEntry.id }) else { return nil }
      let nextIndex = entries.index(after: currentIndex)
      guard nextIndex < entries.endIndex else { return nil }
      let nextEntry = entries[nextIndex]
      var result: [String: Any] = [
        "title": nextEntry.title,
        "artistName": nextEntry.subtitle ?? ""
      ]
      if case .song(let song) = nextEntry.item {
        result["id"] = song.id.rawValue
      }
      return result
    }

    AsyncFunction("getUpcomingQueue") { (count: Int) -> [[String: Any]] in
      let entries = Array(self.player.queue.entries)
      guard let currentEntry = self.player.queue.currentEntry,
            let currentIndex = entries.firstIndex(where: { $0.id == currentEntry.id }) else { return [] }
      let startIndex = entries.index(after: currentIndex)
      guard startIndex < entries.endIndex else { return [] }
      let endIndex = min(entries.endIndex, startIndex + count)
      var results: [[String: Any]] = []
      for entry in entries[startIndex..<endIndex] {
        var dict: [String: Any] = [
          "title": entry.title,
          "artistName": entry.subtitle ?? ""
        ]
        if case .song(let song) = entry.item {
          dict["id"] = song.id.rawValue
          if let artworkUrl = self.artworkUrlString(song.artwork, width: 96, height: 96) {
            dict["artworkUrl"] = artworkUrl
          }
        }
        results.append(dict)
      }
      return results
    }

    AsyncFunction("searchCatalog") { (query: String, types: [String], limit: Int) -> [[String: Any]] in
      var searchRequest = MusicCatalogSearchRequest(term: query, types: [Song.self])
      searchRequest.limit = limit

      let response = try await searchRequest.response()

      var results: [[String: Any]] = []
      for song in response.songs {
        var dict: [String: Any] = [
          "id": song.id.rawValue,
          "title": song.title,
          "artistName": song.artistName,
          "albumTitle": song.albumTitle ?? "",
          "duration": song.duration ?? 0,
          "genreNames": song.genreNames,
        ]

        // Surface contentRating so the JS caller can prefer explicit versions.
        if let rating = song.contentRating {
          dict["contentRating"] = Self.contentRatingString(rating)
        }

        // ISRC — needed for server-side ReccoBeats/Deezer feature lookup on
        // curator-baked featured broadcasts (Ask ONAY flow).
        if let isrc = song.isrc {
          dict["isrc"] = isrc
        }

        if let artwork = song.artwork {
          let url = artwork.url(width: 300, height: 300)
          dict["artworkUrl"] = url?.absoluteString ?? ""
        } else {
          dict["artworkUrl"] = ""
        }

        results.append(dict)
      }

      return results
    }

    AsyncFunction("createPlaylist") { (name: String, description: String, trackIds: [String]) -> String in
      // Resolve string IDs to MusicItemIDs
      let musicItemIDs = trackIds.map { MusicItemID($0) }

      // Fetch Song objects from catalog by ID
      let resourceRequest = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: musicItemIDs)
      let resourceResponse = try await resourceRequest.response()

      // Preserve the original track order
      let songMap = Dictionary(uniqueKeysWithValues: resourceResponse.items.map { ($0.id.rawValue, $0) })
      let orderedSongs = trackIds.compactMap { songMap[$0] }

      guard !orderedSongs.isEmpty else {
        throw NSError(domain: "ExpoMusicKit", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "No valid songs found for the provided track IDs"
        ])
      }

      // Create the playlist
      let playlist = try await MusicLibrary.shared.createPlaylist(
        name: name,
        description: description,
        items: orderedSongs
      )

      return playlist.id.rawValue
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

      // Protect entire TTS lifecycle from iOS background suspension
      // Background task removed — it prevents iOS from throttling CPU

      do {
        // Stop any currently playing audio and resolve its pending promise
        // AVAudioPlayer.stop() does NOT fire audioPlayerDidFinishPlaying,
        // so resolve the dangling ttsPromiseResolve before overwriting.
        self.ttsPromiseResolve?()
        self.ttsPromiseResolve = nil
        if let existing = self.audioPlayer, existing.isPlaying {
          existing.stop()
        }
        self.audioPlayer = nil
        self.audioDelegate = nil

        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)

        let newPlayer = try AVAudioPlayer(data: data)
        self.audioPlayer = newPlayer
        // Store the new promise's resolve closure so it can be resolved on cancel/stop
        self.ttsPromiseResolve = { promise.resolve(nil) }
        self.audioDelegate = AudioPlayerDelegate(player: newPlayer) { [weak self] in
          self?.audioPlayer = nil
          self?.audioDelegate = nil
          // Remove duckOthers but keep session active — setActive(false) would kill MusicKit playback
          try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
          Task {
            try? await self?.player.play()
          }
          self?.ttsPromiseResolve?()
          self?.ttsPromiseResolve = nil
        }
        self.audioPlayer?.delegate = self.audioDelegate
        self.audioPlayer?.volume = self.ttsVolume
        self.audioPlayer?.prepareToPlay()

        if let dur = self.audioPlayer?.duration {
          print("[ExpoMusicKit] Audio duration: \(String(format: "%.1f", dur))s")
        }

        self.audioPlayer?.play()
      } catch {
        promise.reject("ERR", error.localizedDescription)
      }
    }

    Function("setTTSVolume") { (volume: Float) in
      self.ttsVolume = max(0.0, min(1.0, volume))
      self.audioPlayer?.volume = self.ttsVolume
    }

    AsyncFunction("stopAudio") {
      // Resolve dangling TTS promise before stop() — stop() won't trigger the delegate
      self.ttsPromiseResolve?()
      self.ttsPromiseResolve = nil
      self.audioPlayer?.stop()
      self.audioPlayer = nil
      self.audioDelegate = nil
      // Remove duckOthers but keep session active — setActive(false) would kill MusicKit playback
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
    }

    AsyncFunction("activateDuckingSession") {
      try AVAudioSession.sharedInstance().setCategory(
        .playback,
        mode: .default,
        options: [.mixWithOthers, .duckOthers]
      )
      try AVAudioSession.sharedInstance().setActive(true)
    }

    AsyncFunction("deactivateDuckingSession") {
      // Remove duckOthers but keep session active — setActive(false) would kill MusicKit playback
      try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
    }

    // Release the audio session back to MusicKit completely — drops both
    // mixWithOthers and duckOthers and deactivates the session so MusicKit's
    // ApplicationMusicPlayer can reassert its own. Used by BroadcastPlayer
    // between a TTS segment and the next track (cold_open -> track 1, etc.)
    // where there is no music currently playing to duck under.
    AsyncFunction("releaseAudioSession") {
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // BroadcastPlayer marks a broadcast as active so the playback timer keeps
    // running when the phone locks. Without this, the bg observer invalidates
    // the timer, no events reach JS, and the broadcast stalls until the user
    // unlocks the phone. Idempotent — JS can call it repeatedly.
    AsyncFunction("setBroadcastActive") { (active: Bool) in
      self.broadcastActive = active
      // If we're going active and we're currently in background, restart the
      // timer immediately rather than waiting for foreground.
      if active && self.playbackTimer == nil {
        DispatchQueue.main.async { self.startPlaybackTimer() }
      }
    }

    // NowPlaying writes must land on the main thread before the JS promise
    // resolves — otherwise `await setNowPlayingTrack(...)` returns while the
    // native update is still queued, and MusicKit's stock artwork can paint
    // first when the next music.play fires. `runOnMainSync` blocks the
    // caller's background thread until the main-queue work completes, with a
    // same-thread fast-path to avoid deadlock if the handler ever runs on
    // main itself.
    AsyncFunction("setNowPlayingTrack") { (payload: [String: Any]) in
      let title    = payload["title"]    as? String ?? ""
      let artist   = payload["artist"]   as? String ?? ""
      let vibe     = payload["vibe"]     as? String ?? "feelGood"
      let duration = payload["duration"] as? Double ?? 0
      self.runOnMainSync {
        self.nowPlaying.setTrack(title: title, artist: artist,
                                 vibe: vibe, duration: duration)
      }
    }

    AsyncFunction("setNowPlayingSegment") { (payload: [String: Any]) in
      let vibe = payload["vibe"] as? String ?? "feelGood"
      let kind = payload["kind"] as? String ?? "transition"
      self.runOnMainSync {
        self.nowPlaying.setSegment(vibe: vibe, kind: kind)
      }
    }

    AsyncFunction("setNowPlayingElapsed") { (payload: [String: Any]) in
      let elapsed = payload["elapsed"] as? Double ?? 0
      let playing = payload["playing"] as? Bool   ?? true
      self.runOnMainSync {
        self.nowPlaying.setElapsed(elapsed, playing: playing)
      }
    }

    AsyncFunction("clearNowPlaying") {
      self.runOnMainSync {
        self.nowPlaying.clear()
      }
    }

    // MARK: - Observation Lifecycle

    OnStartObserving {
      self.startObserving()
    }

    OnStopObserving {
      self.stopObserving()
    }
  }

  // MARK: - Main-thread helper

  /// Run `block` on the main thread, blocking the caller until it completes.
  /// Used by the NowPlaying AsyncFunction handlers so the JS promise does
  /// not resolve until the native mutation has actually landed (required for
  /// the "set metadata BEFORE music.play" guarantee). Same-thread fast-path
  /// avoids a deadlock if the handler is ever invoked on main.
  private func runOnMainSync(_ block: () -> Void) {
    if Thread.isMainThread { block() }
    else { DispatchQueue.main.sync(execute: block) }
  }

  // MARK: - Memory Management

  /// Trim MusicKit object caches to only upcoming queue entries.
  /// Large playlists (100-1000+ tracks) can cause jetsam termination when backgrounded
  /// because iOS enforces a much lower memory budget for background apps (~50MB).
  /// Tracks already in MusicKit's queue don't need our cache — MusicKit holds its own references.
  private func trimCachesForBackground() {
    // Collect IDs of tracks currently in MusicKit's queue — these must be kept
    var queueIds = Set<String>()
    for entry in self.player.queue.entries {
      if case .song(let song) = entry.item {
        queueIds.insert(song.id.rawValue)
      }
    }

    let tracksBefore = self.cachedTracks.count
    let songsBefore = self.cachedSongs.count

    // Keep only tracks that are in the active queue
    if !queueIds.isEmpty {
      self.cachedTracks = self.cachedTracks.filter { queueIds.contains($0.key) }
      self.cachedSongs = self.cachedSongs.filter { queueIds.contains($0.key) }
    }

    // Playlists can be re-fetched — drop them entirely
    self.cachedPlaylists.removeAll()

    let tracksAfter = self.cachedTracks.count
    let songsAfter = self.cachedSongs.count
    if tracksBefore != tracksAfter || songsBefore != songsAfter {
      print("[ExpoMusicKit] Trimmed caches: tracks \(tracksBefore)→\(tracksAfter), songs \(songsBefore)→\(songsAfter), playlists cleared")
    }
  }

  // MARK: - Background Task Protection

  /// Request extra execution time from iOS to complete TTS playback + MusicKit resume.
  /// Without this, iOS can suspend the app in the gap between TTS ending and MusicKit resuming.
  private func beginTTSBackgroundTask() {
    guard self.backgroundTaskId == .invalid else { return }
    self.backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "TTSPlayback") { [weak self] in
      // Expiration handler — clean up if iOS forces us to stop
      // no-op: background task removed
    }
  }

  private func endTTSBackgroundTask() {
    guard self.backgroundTaskId != .invalid else { return }
    UIApplication.shared.endBackgroundTask(self.backgroundTaskId)
    self.backgroundTaskId = .invalid
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

  /// Resolves artwork to a URL that React Native Image can load.
  /// For http:// URLs, returns as-is. For musickit:// URLs (local library items),
  /// loads the image data synchronously and caches to a temp file, returning a file:// URL.
  private func resolveArtworkUrl(_ artwork: Artwork?, id: String, width: Int, height: Int) -> String? {
    guard let artwork = artwork,
          let url = artwork.url(width: width, height: height) else { return nil }
    let urlString = url.absoluteString

    // HTTP URLs can be loaded directly by React Native Image
    if urlString.hasPrefix("http") {
      return urlString
    }

    // For musickit:// or other local URLs, check if we have a cached copy
    let cacheDir = FileManager.default.temporaryDirectory.appendingPathComponent("artwork")
    try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    let sanitizedId = id.replacingOccurrences(of: "/", with: "_")
    let filePath = cacheDir.appendingPathComponent("\(sanitizedId)_\(width)x\(height).jpg")

    // Return cached file if it exists
    if FileManager.default.fileExists(atPath: filePath.path) {
      return filePath.absoluteString
    }

    // Load and cache synchronously so artwork is available on first fetch.
    // This runs on the Expo module queue, not the main thread.
    guard let data = try? Data(contentsOf: url),
          let image = UIImage(data: data),
          let jpegData = image.jpegData(compressionQuality: 0.85) else { return nil }
    try? jpegData.write(to: filePath)

    return filePath.absoluteString
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
    if let rating = track.contentRating {
      dict["contentRating"] = Self.contentRatingString(rating)
    }
    if let artworkUrl = artworkUrlString(track.artwork, width: 800, height: 800) {
      dict["artworkUrl"] = artworkUrl
    }
    if let isrc = track.isrc {
      dict["isrc"] = isrc
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
    if let rating = song.contentRating {
      dict["contentRating"] = Self.contentRatingString(rating)
    }
    if let artworkUrl = artworkUrlString(song.artwork, width: 800, height: 800) {
      dict["artworkUrl"] = artworkUrl
    }
    if let isrc = song.isrc {
      dict["isrc"] = isrc
    }
    return dict
  }

  private static func contentRatingString(_ rating: ContentRating) -> String {
    switch rating {
    case .clean: return "clean"
    case .explicit: return "explicit"
    @unknown default: return "unknown"
    }
  }

  private func startObserving() {
    // Observe queue changes for track change detection.
    // Throttle to max once per second — objectWillChange fires on EVERY internal
    // MusicKit state mutation (buffer updates, playback position, etc.), potentially
    // hundreds of times per second. Unthrottled, this causes 96% background CPU usage
    // and iOS terminates the app for violating the 48s/60s CPU limit.
    queueObservation = player.queue.objectWillChange
      .throttle(for: .seconds(1), scheduler: DispatchQueue.main, latest: true)
      .sink { [weak self] _ in
        guard let self = self else { return }
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

    // Start playback polling timer (paused/resumed on app lifecycle)
    self.startPlaybackTimer()

    // Pause timer when backgrounded to eliminate wakeups; resume when foregrounded.
    // Also trim MusicKit object caches to reduce memory — iOS background memory budget
    // is much lower than foreground, and large playlists can trigger jetsam termination.
    let bgObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self = self else { return }
      // Only pause the timer when no broadcast is active. During a broadcast
      // the JS state machine needs end-of-track events to advance segments.
      // 0.5s timer cost is negligible (~2 Hz) — well under iOS's 48s/60s
      // background CPU budget.
      if !self.broadcastActive {
        self.playbackTimer?.invalidate()
        self.playbackTimer = nil
      }
      self.trimCachesForBackground()
    }
    let fgObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      self?.startPlaybackTimer()
    }
    let memObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
    ) { [weak self] _ in
      self?.trimCachesForBackground()
    }
    self.lifecycleObservers = [bgObserver, fgObserver, memObserver]
  }

  private func startPlaybackTimer() {
    playbackTimer?.invalidate()
    playbackTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      guard let self = self else { return }

      let currentStatus = self.player.state.playbackStatus
      let statusStr = self.playbackStatusString(currentStatus)
      let time = self.player.playbackTime

      // Stop TTS when music is paused/stopped externally (Lock Screen, AirPods, Control Center)
      if let last = self.lastPlaybackStatus, last == .playing,
         (currentStatus == .paused || currentStatus == .stopped) {
        // Only stop TTS if we're not currently in a ducking session.
        // Ducking can cause brief playback status changes that shouldn't interrupt TTS.
        let isDucking = (try? AVAudioSession.sharedInstance().category == .playback &&
          AVAudioSession.sharedInstance().categoryOptions.contains(.duckOthers)) ?? false
        if let ttsPlayer = self.audioPlayer, ttsPlayer.isPlaying, !isDucking {
          ttsPlayer.stop()
          // AVAudioPlayer.stop() does NOT call audioPlayerDidFinishPlaying,
          // so we must manually clean up and resolve any pending promise.
          self.audioPlayer = nil
          self.audioDelegate = nil
          try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
          self.ttsPromiseResolve?()
          self.ttsPromiseResolve = nil
        }
      }
      self.lastPlaybackStatus = currentStatus

      // Stomp on MusicKit's continuous nowPlayingInfo rewrites. MusicKit's
      // ApplicationMusicPlayer auto-writes the tile on every state tick; if
      // we only write on runTrackAt + via the 1Hz JS pump, MusicKit wins the
      // race every time and the lock-screen card never flips to ONAY. Native
      // re-assertion at 0.5s cadence is the cheap, robust override.
      self.nowPlaying.reassert()

      self.sendEvent("onPlaybackStateChanged", [
        "status": statusStr,
        "playbackTime": time
      ])
    }
  }

  private func stopObserving() {
    queueObservation?.cancel()
    queueObservation = nil
    playbackTimer?.invalidate()
    playbackTimer = nil
    lastPlaybackStatus = nil
    for observer in lifecycleObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    lifecycleObservers.removeAll()
  }
}

/// Thread-safe one-shot flag for racing continuations.
final class MKAtomicFlag: @unchecked Sendable {
  private var flag = os_unfair_lock_s()
  private var set = false

  /// Returns `true` on the first call, `false` on all subsequent calls.
  func trySet() -> Bool {
    os_unfair_lock_lock(&flag)
    defer { os_unfair_lock_unlock(&flag) }
    if set { return false }
    set = true
    return true
  }
}

class AudioPlayerDelegate: NSObject, AVAudioPlayerDelegate {
  let onFinish: () -> Void
  private var interruptionObserver: Any?

  init(player: AVAudioPlayer, onFinish: @escaping () -> Void) {
    self.onFinish = onFinish
    super.init()

    // Handle audio session interruptions (e.g., MusicKit reconfiguring the session)
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak player] notification in
      guard let userInfo = notification.userInfo,
            let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

      if type == .ended {
        // Only resume if iOS indicates we should (e.g., not after phone calls where user expects silence)
        if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt,
           AVAudioSession.InterruptionOptions(rawValue: optionsValue).contains(.shouldResume) {
          try? AVAudioSession.sharedInstance().setActive(true)
          player?.play()
        }
      }
    }
  }

  deinit {
    if let observer = interruptionObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    print("[ExpoMusicKit] audioPlayerDidFinishPlaying — success: \(flag), currentTime: \(String(format: "%.1f", player.currentTime))s / \(String(format: "%.1f", player.duration))s")
    if let observer = interruptionObserver {
      NotificationCenter.default.removeObserver(observer)
      interruptionObserver = nil
    }
    onFinish()
  }
}
