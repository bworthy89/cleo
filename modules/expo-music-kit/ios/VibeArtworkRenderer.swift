import UIKit

struct VibeArtworkRenderer {
    enum Kind: String { case track, between }

    private static let cache = NSCache<NSString, UIImage>()

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
