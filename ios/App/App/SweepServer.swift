import Darwin
import Foundation

struct SweepServer {
    let speaker: String
    let wave: Data
    let path = "/\(UUID().uuidString).wav"

    func serve(ready: (String) -> Void) throws {
        // Let the routing table choose the source address for this particular speaker.
        let route = try LanSocket.open(SOCK_DGRAM)
        defer { Darwin.close(route) }
        try LanSocket.connect(route, to: LanSocket.endpoint(speaker, port: 9), until: LanSocket.now + 1)
        var local = try LanSocket.name(route)
        let host = LanSocket.ip(local)
        guard LanSocket.isPrivate(host) else { throw LanError("Connect this device and the speaker to the same Wi-Fi network.") }
        local.sin_port = 0

        let listener = try LanSocket.open(SOCK_STREAM)
        defer { Darwin.close(listener) }
        guard LanSocket.withAddress(&local, { Darwin.bind(listener, $0, $1) }) == 0, listen(listener, 4) == 0 else {
            throw LanError("Could not start the measurement audio server.")
        }
        let port = UInt16(bigEndian: try LanSocket.name(listener).sin_port)
        let expires = LanSocket.now + 12
        ready("http://\(host):\(port)\(path)")
        while (try? LanSocket.wait(listener, Int16(POLLIN), until: expires)) != nil {
            var remote = sockaddr_in()
            var size = socklen_t(MemoryLayout<sockaddr_in>.size)
            let client = LanSocket.withAddress(&remote) { pointer, _ in Darwin.accept(listener, pointer, &size) }
            if client < 0 { continue }
            defer { Darwin.close(client) }
            guard LanSocket.ip(remote) == speaker else { continue }
            do {
                try LanSocket.configure(client)
                try respond(to: client, until: min(expires, LanSocket.now + 3))
            } catch {
                // The player may close a probe request before opening the playback request.
                continue
            }
        }
    }

    private func respond(to client: Int32, until deadline: Double) throws {
        var request = Data()
        let separator = Data("\r\n\r\n".utf8)
        while request.range(of: separator) == nil {
            guard request.count < 8192 else { return }
            request.append(try LanSocket.read(client, maximum: 8192 - request.count, until: deadline))
        }
        guard let text = String(data: request, encoding: .utf8) else { return }
        let lines = text.components(separatedBy: "\r\n")
        let fields = lines[0].components(separatedBy: " ")
        guard fields.count == 3, ["GET", "HEAD"].contains(fields[0]), fields[1] == path else {
            try LanSocket.write(Data("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), to: client, until: deadline)
            return
        }
        var range = 0..<wave.count
        var status = "200 OK"
        var contentRange = ""
        if let header = lines.dropFirst().first(where: { $0.lowercased().hasPrefix("range:") }) {
            let value = header.dropFirst(6).trimmingCharacters(in: .whitespaces)
            guard let bytes = byteRange(value) else {
                let message = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */\(wave.count)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                try LanSocket.write(Data(message.utf8), to: client, until: deadline)
                return
            }
            range = bytes
            status = "206 Partial Content"
            contentRange = "Content-Range: bytes \(range.lowerBound)-\(range.upperBound - 1)/\(wave.count)\r\n"
        }
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: audio/wav\r\nAccept-Ranges: bytes\r\n\(contentRange)Content-Length: \(range.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        try LanSocket.write(Data(headers.utf8), to: client, until: deadline)
        if fields[0] == "GET" { try LanSocket.write(wave.subdata(in: range), to: client, until: deadline) }
    }

    private func byteRange(_ value: String) -> Range<Int>? {
        guard value.hasPrefix("bytes=") else { return nil }
        let bounds = value.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard bounds.count == 2 else { return nil }
        if bounds[0].isEmpty {
            guard let suffix = Int(bounds[1]), suffix > 0 else { return nil }
            return (wave.count - min(wave.count, suffix))..<wave.count
        }
        guard let start = Int(bounds[0]), (0..<wave.count).contains(start) else { return nil }
        if bounds[1].isEmpty { return start..<wave.count }
        guard let end = Int(bounds[1]), end >= start else { return nil }
        return start..<(min(end, wave.count - 1) + 1)
    }
}
