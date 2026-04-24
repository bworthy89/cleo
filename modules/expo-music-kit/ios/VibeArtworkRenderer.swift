import UIKit

struct VibeArtworkRenderer {
    enum Kind: String { case track, between }

    private static let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.countLimit = 14
        return c
    }()

    /// Returns a 1024×1024 UIImage for the given vibe+kind. Cached so each
    /// of the 14 unique combinations renders at most once per process.
    func render(vibe: String, kind: Kind) -> UIImage {
        let key = "\(vibe)|\(kind.rawValue)" as NSString
        if let cached = Self.cache.object(forKey: key) { return cached }
        let img = draw(vibe: vibe, kind: kind)
        Self.cache.setObject(img, forKey: key)
        return img
    }

    private func draw(vibe: String, kind: Kind) -> UIImage {
        let size = CGSize(width: 1024, height: 1024)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            paintBackground(in: ctx.cgContext, size: size, vibe: vibe)
            paintBrand(in: ctx.cgContext, size: size)
            if kind == .track { paintAvatar(in: ctx.cgContext, size: size) }
            else { paintBetweenLabel(in: ctx.cgContext, size: size, vibe: vibe) }
        }
    }
}

// MARK: - Background + Brand

private extension VibeArtworkRenderer {
    static let warmBlack = UIColor(red: 0.043, green: 0.035, blue: 0.027, alpha: 1)
    static let amber     = UIColor(red: 0.910, green: 0.635, blue: 0.294, alpha: 1)
    static let ink       = UIColor(red: 0.957, green: 0.925, blue: 0.863, alpha: 1)
    static let onAirRed  = UIColor(red: 0.643, green: 0.227, blue: 0.180, alpha: 1)
    static let accent: [String: UIColor] = [
        "morning":    UIColor(red: 0.957, green: 0.780, blue: 0.478, alpha: 1),
        "focus":      UIColor(red: 0.435, green: 0.722, blue: 0.608, alpha: 1),
        "workout":    UIColor(red: 0.769, green: 0.271, blue: 0.192, alpha: 1),
        "feelGood":   amber,
        "lateNight":  UIColor(red: 0.431, green: 0.310, blue: 0.557, alpha: 1),
        "melancholy": UIColor(red: 0.420, green: 0.482, blue: 0.557, alpha: 1),
        "party":      UIColor(red: 0.878, green: 0.306, blue: 0.518, alpha: 1),
    ]

    func vibeAccent(_ vibe: String) -> UIColor {
        Self.accent[vibe] ?? Self.accent["feelGood"]!
    }

    func paintBackground(in ctx: CGContext, size: CGSize, vibe: String) {
        ctx.setFillColor(Self.warmBlack.cgColor)
        ctx.fill(CGRect(origin: .zero, size: size))

        // Bottom radial: vibe-tinted glow
        let accent = vibeAccent(vibe).withAlphaComponent(0.18)
        let cs = CGColorSpaceCreateDeviceRGB()
        let grad = CGGradient(colorsSpace: cs,
            colors: [accent.cgColor, UIColor.clear.cgColor] as CFArray,
            locations: [0.0, 1.0])!
        ctx.drawRadialGradient(grad,
            startCenter: CGPoint(x: size.width / 2, y: size.height),
            startRadius: 0,
            endCenter:   CGPoint(x: size.width / 2, y: size.height),
            endRadius:   size.width * 0.7,
            options:     [])

        // Left amber edge bar — design's "gold-edge cards" cue
        ctx.setFillColor(Self.amber.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: 16, height: size.height))
    }

    func paintBrand(in ctx: CGContext, size: CGSize) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: 56, weight: .medium),
            .foregroundColor: Self.amber,
            .kern: 12.0,
        ]
        let str = NSAttributedString(string: "ONAY", attributes: attrs)
        let bounds = str.boundingRect(
            with: CGSize(width: size.width, height: 80),
            options: [.usesLineFragmentOrigin], context: nil)
        str.draw(at: CGPoint(
            x: (size.width - bounds.width) / 2,
            y: 80))

        // ON-AIR dot to the left of wordmark
        ctx.setFillColor(Self.onAirRed.cgColor)
        let dotR: CGFloat = 14
        ctx.fillEllipse(in: CGRect(
            x: (size.width - bounds.width) / 2 - dotR * 2.5,
            y: 80 + bounds.height / 2 - dotR / 2,
            width: dotR, height: dotR))
    }
}

// MARK: - Avatar + Between Label

private extension VibeArtworkRenderer {
    func paintAvatar(in ctx: CGContext, size: CGSize) {
        guard let avatar = UIImage(named: "onay-avatar",
                                   in: Bundle(for: NowPlayingController.self),
                                   with: nil) else {
            // Fallback: draw an amber-bordered placeholder square so the
            // image still has structure if the asset is missing.
            ctx.setStrokeColor(Self.amber.cgColor)
            ctx.setLineWidth(6)
            let rect = CGRect(x: size.width * 0.2, y: size.height * 0.25,
                              width: size.width * 0.6, height: size.height * 0.6)
            ctx.stroke(rect)
            return
        }
        let target = CGRect(x: size.width * 0.18, y: size.height * 0.20,
                            width: size.width * 0.64, height: size.width * 0.64)
        avatar.draw(in: target)
    }

    func paintBetweenLabel(in ctx: CGContext, size: CGSize, vibe: String) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: 36, weight: .regular),
            .foregroundColor: Self.ink,
            .kern: 8.0,
        ]
        let label = NSAttributedString(
            string: "BETWEEN TRACKS",
            attributes: attrs)
        let lb = label.boundingRect(with: CGSize(width: size.width, height: 80),
                                    options: [.usesLineFragmentOrigin], context: nil)
        label.draw(at: CGPoint(x: (size.width - lb.width) / 2,
                               y: size.height / 2 - 40))

        let vibeAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: 28, weight: .medium),
            .foregroundColor: vibeAccent(vibe),
            .kern: 6.0,
        ]
        let vibeStr = NSAttributedString(
            string: vibe.uppercased(),
            attributes: vibeAttrs)
        let vb = vibeStr.boundingRect(with: CGSize(width: size.width, height: 60),
                                      options: [.usesLineFragmentOrigin], context: nil)
        vibeStr.draw(at: CGPoint(x: (size.width - vb.width) / 2,
                                 y: size.height / 2 + 30))
    }
}
