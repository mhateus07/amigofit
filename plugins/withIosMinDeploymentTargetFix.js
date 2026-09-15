const { withPodfile } = require('@expo/config-plugins');

// Some CocoaPods resource-bundle targets (e.g. RNSVG-RNSVGFilters,
// RNCAsyncStorage-RNCAsyncStorage_resources) ship with a hardcoded
// IPHONEOS_DEPLOYMENT_TARGET from their podspec that react_native_post_install
// doesn't override. Newer Xcode/SDKs reject deployment targets below 15.0,
// which fails the build for both simulator and physical device targets.
// This plugin re-injects the fix into the Podfile after every prebuild,
// since ios/ is regenerated (and gitignored) on every `expo prebuild`.

const MARKER = '# @amigofit: min deployment target fix';

const SNIPPET = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        deployment_target = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment_target && deployment_target.to_f < 15.0
          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        end
      end
    end
`;

function withIosMinDeploymentTargetFix(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes(MARKER)) {
      return config;
    }

    const postInstallMatch = contents.match(/post_install do \|installer\|/);
    if (!postInstallMatch) {
      return config;
    }

    const insertAt = postInstallMatch.index + postInstallMatch[0].length;
    config.modResults.contents =
      contents.slice(0, insertAt) + SNIPPET + contents.slice(insertAt);

    return config;
  });
}

module.exports = withIosMinDeploymentTargetFix;
