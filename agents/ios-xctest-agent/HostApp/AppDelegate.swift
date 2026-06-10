import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let controller = UIViewController()
        controller.view.backgroundColor = UIColor(red: 245.0 / 255.0, green: 248.0 / 255.0, blue: 255.0 / 255.0, alpha: 1)

        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = .white
        card.layer.cornerRadius = 28
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.08
        card.layer.shadowRadius = 28
        card.layer.shadowOffset = CGSize(width: 0, height: 18)

        let badge = UIView()
        badge.translatesAutoresizingMaskIntoConstraints = false
        badge.backgroundColor = UIColor(red: 18.0 / 255.0, green: 41.0 / 255.0, blue: 78.0 / 255.0, alpha: 1)
        badge.layer.cornerRadius = 34

        let badgeLabel = UILabel()
        badgeLabel.translatesAutoresizingMaskIntoConstraints = false
        badgeLabel.text = "A"
        badgeLabel.font = UIFont.systemFont(ofSize: 34, weight: .bold)
        badgeLabel.textColor = .white
        badge.addSubview(badgeLabel)

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "Astur"
        titleLabel.font = UIFont.systemFont(ofSize: 34, weight: .bold)
        titleLabel.textColor = UIColor(red: 18.0 / 255.0, green: 41.0 / 255.0, blue: 78.0 / 255.0, alpha: 1)

        let subtitleLabel = UILabel()
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.text = "iOS Agent Host"
        subtitleLabel.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        subtitleLabel.textColor = UIColor(red: 24.0 / 255.0, green: 54.0 / 255.0, blue: 102.0 / 255.0, alpha: 1)

        let versionLabel = UILabel()
        versionLabel.translatesAutoresizingMaskIntoConstraints = false
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        versionLabel.text = "Version \(version) (\(build))"
        versionLabel.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .medium)
        versionLabel.textColor = UIColor(red: 75.0 / 255.0, green: 94.0 / 255.0, blue: 126.0 / 255.0, alpha: 1)

        let bodyLabel = UILabel()
        bodyLabel.translatesAutoresizingMaskIntoConstraints = false
        bodyLabel.numberOfLines = 0
        bodyLabel.textAlignment = .center
        bodyLabel.text = "This bundled host app keeps the Astur XCUITest bridge alive for simulator codegen sessions. Install and launch your simulator-built .app to inspect your own app instead."
        bodyLabel.font = UIFont.systemFont(ofSize: 16, weight: .regular)
        bodyLabel.textColor = UIColor(red: 75.0 / 255.0, green: 94.0 / 255.0, blue: 126.0 / 255.0, alpha: 1)

        let noteLabel = UILabel()
        noteLabel.translatesAutoresizingMaskIntoConstraints = false
        noteLabel.numberOfLines = 0
        noteLabel.textAlignment = .center
        noteLabel.text = "Astur Inspector can upload Android .apk, real-device iOS .ipa, and simulator-built .app bundles from the Controls panel."
        noteLabel.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        noteLabel.textColor = UIColor(red: 24.0 / 255.0, green: 54.0 / 255.0, blue: 102.0 / 255.0, alpha: 1)

        let stack = UIStackView(arrangedSubviews: [badge, titleLabel, subtitleLabel, versionLabel, bodyLabel, noteLabel])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14

        card.addSubview(stack)
        controller.view.addSubview(card)

        NSLayoutConstraint.activate([
            badge.widthAnchor.constraint(equalToConstant: 68),
            badge.heightAnchor.constraint(equalToConstant: 68),
            badgeLabel.centerXAnchor.constraint(equalTo: badge.centerXAnchor),
            badgeLabel.centerYAnchor.constraint(equalTo: badge.centerYAnchor),

            card.leadingAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.leadingAnchor, constant: 28),
            card.trailingAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.trailingAnchor, constant: -28),
            card.centerYAnchor.constraint(equalTo: controller.view.centerYAnchor),

            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 32),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -32),

            bodyLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            noteLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 420)
        ])

        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
