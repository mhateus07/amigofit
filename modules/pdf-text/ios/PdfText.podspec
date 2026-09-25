Pod::Spec.new do |s|
  s.name           = 'PdfText'
  s.version        = '1.0.0'
  s.summary        = 'Lê as linhas de texto (com posição) de um PDF usando o PDFKit.'
  s.author         = 'AmigoFit'
  s.homepage       = 'https://amigofit-api.impulsiodigital.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'PDFKit'
  s.source_files   = '**/*.swift'
end
