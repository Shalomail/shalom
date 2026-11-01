// Corpo do e-mail. HTML abre num WKWebView sem JavaScript, sem guardar nada e sem rede: uma regra do WebKit
// bloqueia todo endereço http(s) e a CSP só aceita imagens embutidas. Imagens de fora (que avisam quem
// enviou que você abriu) só com o pedido da pessoa, e mesmo assim pelo proxy do shalomail.com (/api/img,
// como no site): quem enviou não vê o IP nem o aparelho. Link abre no Safari. Texto puro vai em texto nativo.
import SwiftUI
import WebKit

enum BodyHTML {
    static func remoteImages(_ html: String) -> Bool {
        html.range(of: "<img[^>]+src=[\"']?https?:", options: [.regularExpression, .caseInsensitive]) != nil
            || html.range(of: "url\\(['\"]?https?:", options: [.regularExpression, .caseInsensitive]) != nil
    }

    // Imagens de fora baixadas pelo proxy (no máximo 40, quatro de cada vez) e trocadas por data: no HTML.
    // A que falhar ou não for imagem fica de fora.
    static func proxyImages(_ html: String) async -> String {
        let pattern = "<img[^>]+src=[\"']?(https?://[^\"' >]+)"
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return html }
        let ns = html as NSString
        var urls: [String] = []
        for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) where m.numberOfRanges > 1 {
            let url = ns.substring(with: m.range(at: 1))
            if !urls.contains(url) { urls.append(url) }
            if urls.count == 40 { break }
        }
        var loaded: [String: String] = [:]
        await withTaskGroup(of: (String, String?).self) { group in
            var next = 0
            func add() {
                guard next < urls.count else { return }
                let url = urls[next]; next += 1
                group.addTask {
                    guard let r = try? await API.shared.postBytes("/img", ["u": url]), r.type.hasPrefix("image/"), r.type != "image/svg+xml" else { return (url, nil) }
                    return (url, "data:\(r.type);base64,\(r.data.base64EncodedString())")
                }
            }
            for _ in 0 ..< 4 { add() }
            for await (url, data) in group { if let data { loaded[url] = data }; add() }
        }
        var out = html
        for (url, data) in loaded { out = out.replacingOccurrences(of: url, with: data) }
        return out
    }

    // Imagens do próprio e-mail (cid:) viram data: para abrir sem rede. Fundo transparente, como no web; no
    // escuro o e-mail inteiro é invertido (e as imagens desinvertidas), em vez de um cartão branco.
    // html: o corpo já com as imagens de fora trocadas pelo proxy, quando a pessoa pediu para mostrar.
    static func document(_ email: ParsedEmail, html given: String? = nil, dark: Bool) -> String {
        var html = given ?? email.html ?? ""
        for a in email.attachments where a.contentId != nil && a.mimeType.hasPrefix("image/") {
            html = html.replacingOccurrences(of: "cid:\(a.contentId!)", with: "data:\(a.mimeType);base64,\(a.data.base64EncodedString())")
        }
        let img = "data:"
        return """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src \(img); style-src 'unsafe-inline'; font-src data:;">
        <style>
          html { -webkit-text-size-adjust: 100%; }
          html, body { background: transparent; }
          body { margin: 0; padding: 2px 0 8px; font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #1d1e21; overflow-wrap: anywhere; }
          a { color: inherit; }
          img { max-width: 100%; height: auto; }
          table { max-width: 100% !important; }
          pre { white-space: pre-wrap; }
          blockquote { margin: 0 0 0 .8ex; border-left: 2px solid #5b5b60; padding-left: 1ex; color: #5b5b60; }
          \(dark ? "html { filter: invert(1) hue-rotate(180deg); } img, video, picture, svg, canvas, [style*=\"background-image\"], [background] { filter: invert(1) hue-rotate(180deg); }" : "")
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
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        context.coordinator.observe(web)
        load(web, context: context)
        return web
    }

    // Recarrega quando muda o tema (o documento muda) ou quando a pessoa libera as imagens.
    func updateUIView(_ web: WKWebView, context: Context) {
        if context.coordinator.loadedRemote != allowRemote || context.coordinator.loadedHTML != html { load(web, context: context) }
    }

    private func load(_ web: WKWebView, context: Context) {
        context.coordinator.loadedRemote = allowRemote
        context.coordinator.loadedHTML = html
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
        var loadedHTML: String?
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
