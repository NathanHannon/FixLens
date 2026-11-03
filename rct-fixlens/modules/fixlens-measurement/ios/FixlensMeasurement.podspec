Pod::Spec.new do |s|
  s.name = 'FixlensMeasurement'
  s.version = '1.0.0'
  s.summary = 'FixLens planar measurement capture'
  s.description = 'Captures an upright JPEG and matching ARKit plane reference.'
  s.license = { :type => 'MIT' }
  s.author = 'FixLens'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit', 'SceneKit', 'CoreImage'
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
