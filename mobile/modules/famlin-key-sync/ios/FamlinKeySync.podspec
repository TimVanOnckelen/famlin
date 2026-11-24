Pod::Spec.new do |s|
  s.name           = 'FamlinKeySync'
  s.version        = '1.0.0'
  s.summary        = 'Keeps a small secret in the iCloud Keychain / Google Block Store so it follows the user to a new phone.'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Famlin'
  s.homepage       = 'https://famlin.app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = '**/*.{h,m,swift}'
end
