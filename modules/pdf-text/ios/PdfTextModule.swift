import ExpoModulesCore
import PDFKit

// Lê o texto de um PDF no próprio aparelho, linha a linha, com a posição de
// cada linha na página (origem no canto inferior esquerdo, como no PDF).
// Assim o app envia ~5 KB ao servidor em vez do PDF inteiro — fichas de
// treino geradas por apps de personal chegam a 75 MB por causa das fotos.
public class PdfTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PdfText")

    AsyncFunction("extractLines") { (uri: String) throws -> [[String: Any]] in
      guard let url = URL(string: uri), let document = PDFDocument(url: url) else {
        throw Exception(name: "PdfOpenError", description: "Não foi possível abrir o PDF.")
      }
      var lines: [[String: Any]] = []
      for index in 0..<min(document.pageCount, 20) {
        guard let page = document.page(at: index),
              let selection = page.selection(for: page.bounds(for: .mediaBox)) else { continue }
        for line in selection.selectionsByLine() {
          guard let text = line.string,
                !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
          let bounds = line.bounds(for: page)
          lines.append(["text": text, "x": Double(bounds.origin.x), "y": Double(bounds.origin.y), "page": index + 1])
        }
      }
      return lines
    }
  }
}
