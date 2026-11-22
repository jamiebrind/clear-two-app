import Capacitor
import Foundation
import NetworkExtension

final class SpeakerBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SpeakerLanPlugin())
    }
}

private final class SpeakerHTTPDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@objc(SpeakerLanPlugin)
final class SpeakerLanPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SpeakerLanPlugin"
    let jsName = "SpeakerLan"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "serveSweep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "joinHotspot", returnType: CAPPluginReturnPromise)
    ]

    private let toneQueue = DispatchQueue(label: "com.cleartwo.tone")
    private let toneSocket = ToneSocket()
    private let sweepSlot = DispatchSemaphore(value: 1)
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.allowsCellularAccess = false
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 3
        config.timeoutIntervalForResource = 5
        return URLSession(configuration: config, delegate: SpeakerHTTPDelegate(), delegateQueue: nil)
    }()

    @objc func joinHotspot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let config = NEHotspotConfiguration(ssidPrefix: "SoundSystem_")
            config.joinOnce = true
            NEHotspotConfigurationManager.shared.apply(config) { error in
                if let error = error as NSError?,
                   !(error.domain == NEHotspotConfigurationErrorDomain && error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue) {
                    call.reject("Open Settings, choose Wi-Fi, and join the speaker's SoundSystem_ network.")
                    return
                }
                call.resolve()
            }
        }
    }

    @objc func discover(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            call.resolve(["addresses": LanSocket.discover()])
        }
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let address = call.getString("address"), LanSocket.isPrivate(address),
              let command = call.getString("command"), !command.isEmpty, command.utf8.count <= 4096,
              let query = command.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
              let url = URL(string: "http://\(address)/httpapi.asp?command=\(query)") else {
            call.reject("Invalid speaker request.")
            return
        }
        Task {
            do {
                let (bytes, response) = try await session.bytes(from: url)
                guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                    throw LanError("The speaker rejected the request.")
                }
                var data = Data()
                for try await byte in bytes {
                    guard data.count < 1024 * 1024 else { throw LanError("The speaker response is too large.") }
                    data.append(byte)
                }
                guard let reply = String(data: data, encoding: .utf8) else { throw LanError("Invalid speaker reply.") }
                call.resolve(["response": reply])
            } catch {
                // URL loading errors can include the entire command URL, including Wi-Fi credentials.
                call.reject((error as? LanError)?.message ?? "Could not reach the speaker on Wi-Fi.")
            }
        }
    }

    @objc func tone(_ call: CAPPluginCall) {
        let codes = ["bass": "BAS", "mid": "MID", "treble": "TRE"]
        guard let address = call.getString("address"), LanSocket.isPrivate(address),
              let band = call.getString("band"), let command = codes[band] else {
            call.reject("Invalid speaker or tone band.")
            return
        }
        var gain: Int?
        if call.getValue("gain") != nil {
            guard let number = call.getValue("gain") as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  (-10.0...10.0).contains(number.doubleValue), number.doubleValue.rounded() == number.doubleValue else {
                call.reject("Enter a whole-number gain from -10 to 10.")
                return
            }
            gain = number.intValue
        }
        toneQueue.async { [self, gain] in
            do { call.resolve(["gain": try toneSocket.query(address, command: command, gain: gain)]) }
            catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func serveSweep(_ call: CAPPluginCall) {
        guard let address = call.getString("address"), LanSocket.isPrivate(address),
              let encoded = call.getString("wav"), encoded.utf8.count <= 2_000_000,
              let wave = Data(base64Encoded: encoded), wave.count >= 44,
              wave.prefix(4) == Data("RIFF".utf8), wave[8..<12] == Data("WAVE".utf8) else {
            call.reject("Invalid speaker or measurement audio.")
            return
        }
        guard sweepSlot.wait(timeout: .now()) == .success else {
            call.reject("A measurement sweep is still in progress.")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            defer { sweepSlot.signal() }
            do { try SweepServer(speaker: address, wave: wave).serve { call.resolve(["url": $0]) } }
            catch { call.reject(error.localizedDescription) }
        }
    }
}
