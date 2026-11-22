import Foundation
import Darwin

final class ToneSocket {
    private var nextSend = 0.0
    private let magic: [UInt8] = [0x18, 0x96, 0x18, 0x20]

    // Called only from the plugin's serial tone queue.
    func query(_ host: String, command: String, gain: Int?) throws -> Int {
        let fd = try LanSocket.open(SOCK_STREAM)
        defer { Darwin.close(fd) }
        let deadline = LanSocket.now + 4.3
        try LanSocket.connect(fd, to: LanSocket.endpoint(host, port: 8899), until: deadline)
        let prefix = "MCU+PAS+RAKOIT:" + command

        func exchange(_ value: Int?) throws -> Int {
            let payload = Data((prefix + (value.map { ":\($0)" } ?? "") + "&").utf8)
            var frame = Data(magic)
            for word in [UInt32(payload.count), checksum(payload), 0, 0] {
                var little = word.littleEndian
                withUnsafeBytes(of: &little) { frame.append(contentsOf: $0) }
            }
            frame.append(payload)
            Thread.sleep(forTimeInterval: max(0, nextSend - LanSocket.now))
            nextSend = LanSocket.now + 0.22
            try LanSocket.write(frame, to: fd, until: deadline)
            while true {
                let header = try readExactly(20, from: fd, until: deadline)
                let count = Int(word(header, at: 4))
                guard header.starts(with: magic), count <= 65536 else { throw LanError("Invalid amplifier packet.") }
                let response = try readExactly(count, from: fd, until: deadline)
                guard checksum(response) == word(header, at: 8), let text = String(data: response, encoding: .utf8) else {
                    throw LanError("Invalid amplifier reply.")
                }
                let reply = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if reply.hasPrefix("MCU+PAS+RAKOIT:ERR:") { throw LanError("The amplifier rejected the tone command.") }
                guard reply.hasPrefix(prefix + ":") else { continue }
                var number = reply.dropFirst(prefix.count + 1)
                if number.last == "&" { number = number.dropLast() }
                guard let actual = Int(number), (-10...10).contains(actual) else { throw LanError("Invalid amplifier gain.") }
                return actual
            }
        }
        let echo = try exchange(gain)
        guard let gain = gain else { return echo }
        let actual = try exchange(nil)
        guard actual == gain else { throw LanError("The amplifier did not confirm the requested tone setting.") }
        return actual
    }

    private func checksum(_ data: Data) -> UInt32 { data.reduce(0) { $0 + UInt32($1) } }

    private func word(_ data: Data, at i: Int) -> UInt32 {
        (0..<4).reduce(UInt32(0)) { $0 | (UInt32(data[i + $1]) << ($1 * 8)) }
    }

    private func readExactly(_ count: Int, from fd: Int32, until deadline: Double) throws -> Data {
        var data = Data()
        while data.count < count {
            data.append(try LanSocket.read(fd, maximum: min(4096, count - data.count), until: deadline))
        }
        return data
    }
}
