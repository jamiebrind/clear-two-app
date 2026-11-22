import Darwin
import Foundation

struct LanError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum LanSocket {
    // All socket deadlines are monotonic. A peer sending a byte at a time cannot extend one.
    static var now: Double { ProcessInfo.processInfo.systemUptime }

    static func endpoint(_ host: String, port: UInt16) throws -> sockaddr_in {
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &address.sin_addr) == 1 else {
            throw LanError("Enter a local IPv4 address.")
        }
        return address
    }

    static func isPrivate(_ host: String) -> Bool {
        guard let address = try? endpoint(host, port: 0) else { return false }
        let ip = UInt32(bigEndian: address.sin_addr.s_addr)
        return ip >> 24 == 10 || ip >> 20 == 0xac1 || ip >> 16 == 0xc0a8
    }

    static func ip(_ address: sockaddr_in) -> String {
        var raw = address.sin_addr
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        guard inet_ntop(AF_INET, &raw, &buffer, socklen_t(buffer.count)) != nil else { return "" }
        return String(cString: buffer)
    }

    static func withAddress<T>(_ address: inout sockaddr_in, _ body: (UnsafeMutablePointer<sockaddr>, socklen_t) -> T) -> T {
        withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                body($0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
    }

    static func open(_ type: Int32) throws -> Int32 {
        let fd = Darwin.socket(AF_INET, type, 0)
        guard fd >= 0 else { throw LanError("Could not open a network socket.") }
        do {
            try configure(fd)
            return fd
        } catch {
            Darwin.close(fd)
            throw error
        }
    }

    static func configure(_ fd: Int32) throws {
        var enabled: Int32 = 1
        guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0,
              setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &enabled, socklen_t(MemoryLayout<Int32>.size)) == 0 else {
            throw LanError("Could not configure the network socket.")
        }
    }

    static func wait(_ fd: Int32, _ event: Int16, until deadline: Double) throws {
        var request = pollfd(fd: fd, events: event, revents: 0)
        while now < deadline {
            let milliseconds = Int32(max(1, ceil((deadline - now) * 1000)))
            let result = Darwin.poll(&request, 1, milliseconds)
            if result > 0 { return }  // The following socket operation reports EOF or a specific error.
            if result < 0 && errno != EINTR { throw LanError("The network connection was interrupted.") }
        }
        throw LanError("The speaker did not respond in time.")
    }

    static func connect(_ fd: Int32, to address: sockaddr_in, until deadline: Double) throws {
        var target = address
        let result = withAddress(&target) { Darwin.connect(fd, $0, $1) }
        if result == 0 { return }
        guard errno == EINPROGRESS else { throw LanError("Could not connect to the speaker on Wi-Fi.") }
        try wait(fd, Int16(POLLOUT), until: deadline)
        var status: Int32 = 0
        var length = socklen_t(MemoryLayout<Int32>.size)
        guard getsockopt(fd, SOL_SOCKET, SO_ERROR, &status, &length) == 0, status == 0 else {
            throw LanError("Could not connect to the speaker on Wi-Fi.")
        }
    }

    static func name(_ fd: Int32) throws -> sockaddr_in {
        var address = sockaddr_in()
        var size = socklen_t(MemoryLayout<sockaddr_in>.size)
        let result = withAddress(&address) { pointer, _ in getsockname(fd, pointer, &size) }
        guard result == 0 else { throw LanError("Could not find this device's local address.") }
        return address
    }

    static func read(_ fd: Int32, maximum: Int, until deadline: Double) throws -> Data {
        var buffer = [UInt8](repeating: 0, count: maximum)
        while true {
            try wait(fd, Int16(POLLIN), until: deadline)
            let count = Darwin.recv(fd, &buffer, maximum, 0)
            if count > 0 { return Data(buffer.prefix(count)) }
            if count < 0 && (errno == EAGAIN || errno == EINTR) { continue }
            throw LanError("The speaker closed the connection.")
        }
    }

    static func write(_ data: Data, to fd: Int32, until deadline: Double) throws {
        try data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            var offset = 0
            while offset < data.count {
                try wait(fd, Int16(POLLOUT), until: deadline)
                let written = Darwin.send(fd, bytes.baseAddress!.advanced(by: offset), data.count - offset, 0)
                if written > 0 { offset += written; continue }
                if written < 0 && (errno == EAGAIN || errno == EINTR) { continue }
                throw LanError("Could not send data to the speaker.")
            }
        }
    }

    static func discover() -> [String] {
        guard let fd = try? open(SOCK_DGRAM) else { return [] }
        defer { Darwin.close(fd) }
        let query = Data("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n".utf8)
        guard var target = try? endpoint("239.255.255.250", port: 1900) else { return [] }
        let sent = query.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            withAddress(&target) { sendto(fd, bytes.baseAddress, bytes.count, 0, $0, $1) }
        }
        guard sent == query.count else { return [] }
        let deadline = now + 2.4
        var addresses: Set<String> = []
        var buffer = [UInt8](repeating: 0, count: 4096)
        while addresses.count < 24 && (try? wait(fd, Int16(POLLIN), until: deadline)) != nil {
            var sender = sockaddr_in()
            var size = socklen_t(MemoryLayout<sockaddr_in>.size)
            let count = withAddress(&sender) { address, _ in recvfrom(fd, &buffer, 4096, 0, address, &size) }
            guard count > 0 else { break }
            let host = ip(sender)
            if buffer.prefix(count).starts(with: "HTTP/1.1 200".utf8), isPrivate(host), host != "10.10.10.254" {
                addresses.insert(host)
            }
        }
        return addresses.sorted()
    }
}
