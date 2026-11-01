import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GameViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Capacitor's view, which turns as the settings' "Screen" says (src/host/native.ts): with the phone ("auto"), or held
/// sideways or upright. The choice kept from the last time is used from the start; an iPad stays sideways (Info.plist).
class GameViewController: CAPBridgeViewController {
    override open func setScreenOrientationDefaults() {
        supportedOrientations = ScreenLockPlugin.orientations(ScreenLockPlugin.storedMode())
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenLockPlugin())
    }
}

/// The page's "ScreenLock": `setOrientation({ mode })` turns the screen ("auto", "landscape", "portrait") and keeps the
/// choice for the next start.
@objc(ScreenLockPlugin)
public class ScreenLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenLockPlugin"
    public let jsName = "ScreenLock"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "setOrientation", returnType: CAPPluginReturnPromise)]
    private static let key = "screenMode"

    static func storedMode() -> String {
        return UserDefaults.standard.string(forKey: key) ?? "auto"
    }

    /// The orientations a mode allows. An iPad only ever has the landscape ones (the only ones its Info.plist lists: asking
    /// for others would leave none).
    static func orientations(_ mode: String) -> [Int] {
        let landscape = [UIInterfaceOrientation.landscapeLeft.rawValue, UIInterfaceOrientation.landscapeRight.rawValue]
        if UIDevice.current.userInterfaceIdiom == .pad || mode == "landscape" {
            return landscape
        }
        if mode == "portrait" {
            return [UIInterfaceOrientation.portrait.rawValue]
        }
        return [UIInterfaceOrientation.portrait.rawValue] + landscape
    }

    @objc func setOrientation(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "auto"
        UserDefaults.standard.set(mode, forKey: ScreenLockPlugin.key)
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController as? CAPBridgeViewController else {
                call.resolve()
                return
            }
            let allowed = ScreenLockPlugin.orientations(mode)
            controller.supportedOrientations = allowed
            controller.setNeedsUpdateOfSupportedInterfaceOrientations()
            var mask: UIInterfaceOrientationMask = []
            if allowed.contains(UIInterfaceOrientation.portrait.rawValue) { mask.insert(.portrait) }
            if allowed.contains(UIInterfaceOrientation.landscapeLeft.rawValue) { mask.insert(.landscapeLeft) }
            if allowed.contains(UIInterfaceOrientation.landscapeRight.rawValue) { mask.insert(.landscapeRight) }
            controller.view.window?.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
            call.resolve()
        }
    }
}
