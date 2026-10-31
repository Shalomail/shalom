// Corpo do e-mail. HTML abre num WKWebView sem JavaScript, sem guardar nada e sem rede: uma regra do WebKit
// bloqueia todo endereço http(s) e a CSP só aceita imagens embutidas. Imagens de fora (que avisam quem
// enviou que você abriu) só com o pedido da pessoa. Link abre no Safari. Texto puro vai em texto nativo.
import SwiftUI
import WebKit

enum BodyHTML {
    static func remoteImages(_ html: String) -> Bool {
        html.range(of: "<img[^>]+src=[\"']?https?:", options: [.regularExpression, .caseInsensitive]) != nil
            || html.range(of: "url\\(['\"]?https?:", options: [.regularExpression, .caseInsensitive]) != nil
    }

    // Imagens do próprio e-mail (cid:) viram data: para abrir sem rede.
    static func document(_ email: ParsedEmail, allowRemote: Bool) -> String {
        var html = email.html ?? ""
        for a in email.attachments where a.contentId != nil && a.mimeType.hasPrefix("image/") {
            html = html.replacingOccurrences(of: "cid:\(a.contentId!)", with: "data:\(a.mimeType);base64,\(a.data.base64EncodedString())")
        }
        let img = allowRemote ? "data: https: http:" : "data:"
        return """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src \(img); style-src 'unsafe-inline'; font-src data:;">
        <style>
          html { -webkit-text-size-adjust: 100%; }
          body { margin: 0; padding: 16px; font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #111; background: #fff; overflow-wrap: anywhere; }
          img { max-width: 100%; height: auto; }
          table { max-width: 100% !important; }
          pre { white-space: pre-wrap; }
        </style></head><body>\(html)</body></html>
        """
    }
}

struct HTMLBody: UIViewRepresentable {
    let html: String
    let allowRemote: Bool
    let linksOn: Bool
    @Binding var height: CGFloat

    private static var blockRules: WKContentRuleList?
    private static let rules = #"[{"trigger":{"url-filter":"^(https?|ftp|wss?)://"},"action":{"type":"block"}}]"#

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.defaultWebpagePreferences.allowsContentJavaScript = false
        cfg.websiteDataStore = .nonPersistent()
        cfg.dataDetectorTypes = []
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = context.coordinator
        web.scrollView.isScrollEnabled = false
        web.isOpaque = false
        web.backgroundColor = .white
        context.coordinator.observe(web)
        load(web, context: context)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        if context.coordinator.loadedRemote != allowRemote { load(web, context: context) }
    }

    private func load(_ web: WKWebView, context: Context) {
        context.coordinator.loadedRemote = allowRemote
        let content = web.configuration.userContentController
        content.removeAllContentRuleLists()
        let go = { _ = web.loadHTMLString(html, baseURL: nil) }
        if allowRemote { go(); return }
        if let rules = Self.blockRules { content.add(rules); go(); return }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "shalom-block-remote", encodedContentRuleList: Self.rules) { list, _ in
            if let list { Self.blockRules = list; content.add(list) }
            go()
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: HTMLBody
        var loadedRemote: Bool?
        private var sizeWatch: NSKeyValueObservation?
        init(_ parent: HTMLBody) { self.parent = parent }

        func observe(_ web: WKWebView) {
            sizeWatch = web.scrollView.observe(\.contentSize, options: [.new]) { [weak self] sv, _ in
                let h = sv.contentSize.height
                DispatchQueue.main.async { if let self, abs(self.parent.height - h) > 1 { self.parent.height = h } }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .other, action.request.url?.scheme == "about" || action.request.url == nil { decisionHandler(.allow); return }
            // Link tocado: fora do app, no Safari (no Spam, links desligados).
            if action.navigationType == .linkActivated, parent.linksOn, let url = action.request.url, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }
}

// Texto puro com os links reconhecidos, em texto nativo (selecionável).
struct PlainBody: View {
    let text: String
    let linksOn: Bool

    var body: some View {
        Text(attributed).font(.system(size: 15)).foregroundStyle(Palette.text).textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.openURL, OpenURLAction { url in linksOn ? .systemAction(url) : .discarded })
    }

    private var attributed: AttributedString {
        var s = AttributedString(text)
        guard linksOn, let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return s }
        for m in detector.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let url = m.url, let r = Range(m.range, in: text), let ar = Range(r, in: s) else { continue }
            s[ar].link = url
            s[ar].underlineStyle = .single
        }
        return s
    }
}
