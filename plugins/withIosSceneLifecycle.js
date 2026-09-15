const fs = require('fs');
const path = require('path');
const xcode = require('xcode');
const { withAppDelegate, withInfoPlist, withDangerousMod, IOSConfig } = require('@expo/config-plugins');

// Newer iOS SDKs (observed starting with the SDK shipped alongside Xcode 27)
// hard-require UIScene lifecycle adoption: an app without a scene delegate
// fails to launch entirely with "Application failed to launch: UIScene life
// cycle is required for apps built with this SDK." Expo's generated
// AppDelegate.swift (as of SDK 57) still uses the classic, scene-less
// lifecycle, so this plugin adds a SceneDelegate.swift, wires it up in
// Info.plist, and moves window creation out of AppDelegate into the scene
// delegate, on every prebuild.

const SCENE_DELEGATE_MARKER = '// @amigofit: scene lifecycle';

const SCENE_DELEGATE_SOURCE = `${SCENE_DELEGATE_MARKER}
import UIKit
import React

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    appDelegate.reactNativeFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: nil)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function withIosSceneDelegateFile(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const sourceRoot = IOSConfig.Paths.getSourceRoot(config.modRequest.projectRoot);
      const filePath = path.join(sourceRoot, 'SceneDelegate.swift');
      fs.writeFileSync(filePath, SCENE_DELEGATE_SOURCE);

      const pbxprojPath = IOSConfig.Paths.getPBXProjectPath(config.modRequest.projectRoot);
      const project = xcode.project(pbxprojPath);
      project.parseSync();

      const relativePath = path.join(config.modRequest.projectName, 'SceneDelegate.swift');
      const alreadyAdded = Object.values(project.hash.project.objects.PBXFileReference || {}).some(
        (ref) => ref && typeof ref.path === 'string' && ref.path.replace(/"/g, '') === relativePath
      );

      if (!alreadyAdded) {
        const sourceGroupKey = Object.keys(project.hash.project.objects.PBXGroup || {}).find((key) => {
          if (key.endsWith('_comment')) return false;
          const group = project.hash.project.objects.PBXGroup[key];
          return (group.children || []).some((child) => {
            const ref = project.hash.project.objects.PBXFileReference[child.value];
            return ref && typeof ref.path === 'string' && ref.path.replace(/"/g, '') === `${config.modRequest.projectName}/AppDelegate.swift`;
          });
        });
        project.addSourceFile(relativePath, {}, sourceGroupKey);
        fs.writeFileSync(pbxprojPath, project.writeSync());
      }

      return config;
    },
  ]);
}

function withIosSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });
}

function withIosAppDelegateSceneHandoff(config) {
  return withAppDelegate(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes(SCENE_DELEGATE_MARKER)) {
      return config;
    }

    const windowSetupBlock = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

`;

    if (!contents.includes(windowSetupBlock)) {
      return config;
    }

    let newContents = contents.replace(windowSetupBlock, '');

    const classEndMarker = /\n}\n\nclass ReactNativeDelegate/;
    const sceneConfigMethod = `
  ${SCENE_DELEGATE_MARKER}
  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }
}

class ReactNativeDelegate`;

    newContents = newContents.replace(classEndMarker, sceneConfigMethod);

    config.modResults.contents = newContents;
    return config;
  });
}

module.exports = function withIosSceneLifecycle(config) {
  config = withIosSceneManifest(config);
  config = withIosAppDelegateSceneHandoff(config);
  config = withIosSceneDelegateFile(config);
  return config;
};
