require 'json'

Pod::Spec.new do |s|
  s.name           = 'ExpoLiquidGlass'
  s.version        = '0.1.0'
  s.summary        = 'Expo module exposing iOS 26 UIGlassEffect material to React Native'
  s.description    = 'Custom Expo native module wrapping UIVisualEffectView with iOS 26 UIGlassEffect, transparent fallback on iOS 16-18'
  s.author         = 'ONAY'
  s.homepage       = 'https://github.com/placeholder'
  s.platforms      = { :ios => '16.2' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.frameworks = 'UIKit'
end
