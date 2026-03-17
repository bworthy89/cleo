require 'json'

Pod::Spec.new do |s|
  s.name           = 'ExpoMusicKit'
  s.version        = '0.1.0'
  s.summary        = 'Expo module wrapping Apple MusicKit for Cleo'
  s.description    = 'Custom Expo native module providing MusicKit authorization, playlist fetching, playback control, and song-change events'
  s.author         = 'Cleo'
  s.homepage       = 'https://github.com/placeholder'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.frameworks = 'MusicKit', 'MediaPlayer'
end
