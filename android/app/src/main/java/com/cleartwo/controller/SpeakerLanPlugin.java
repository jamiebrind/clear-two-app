package com.cleartwo.controller;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "SpeakerLan")
public class SpeakerLanPlugin extends Plugin {
    private final ExecutorService networkJobs = Executors.newFixedThreadPool(8);
    private final ExecutorService toneJobs = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor();
    private final AmplifierTone amplifier = new AmplifierTone();
    private SweepServer sweep;

    private static InetAddress speakerAddress(String address) throws IOException {
        if (address == null || !address.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")) throw new IOException("Enter a private IPv4 address.");
        String[] parts = address.split("\\.");
        byte[] bytes = new byte[4];
        for (int i = 0; i < 4; i++) {
            int value = Integer.parseInt(parts[i]);
            if (value > 255 || !Integer.toString(value).equals(parts[i])) throw new IOException("Enter a private IPv4 address.");
            bytes[i] = (byte)value;
        }
        InetAddress parsed = InetAddress.getByAddress(bytes);
        if (!parsed.isSiteLocalAddress()) throw new IOException("Enter a private IPv4 address.");
        return parsed;
    }

    // Android can keep cellular as its default while the phone is joined to the amp's offline hotspot.
    @SuppressWarnings("deprecation")
    private Network lan(InetAddress target) throws IOException {
        ConnectivityManager manager = (ConnectivityManager)getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        Network active = manager.getActiveNetwork(), best = null;
        int bestScore = -1;
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities caps = manager.getNetworkCapabilities(network);
            LinkProperties link = manager.getLinkProperties(network);
            if (caps == null || link == null || !(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) continue;
            int score = network.equals(active) ? 1 : 0;
            if (target != null) {
                for (RouteInfo route : link.getRoutes()) {
                    if (route.matches(target)) score = Math.max(score, 2 * route.getDestination().getPrefixLength() + (network.equals(active) ? 1 : 0));
                }
            }
            if (score > bestScore) {
                bestScore = score;
                best = network;
            }
        }
        if (best == null) throw new IOException("Connect the phone to the speaker's Wi-Fi network.");
        return best;
    }

    @PluginMethod
    public void request(PluginCall call) {
        networkJobs.execute(() -> {
            HttpURLConnection connection = null;
            try {
                InetAddress address = speakerAddress(call.getString("address"));
                String command = call.getString("command");
                if (command == null || command.isEmpty() || command.length() > 8192) throw new IOException();
                URL url = new URL("http", address.getHostAddress(), "/httpapi.asp?command=" + URLEncoder.encode(command, "UTF-8"));
                connection = (HttpURLConnection)lan(address).openConnection(url, Proxy.NO_PROXY);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setConnectTimeout(2500);
                connection.setReadTimeout(2500);
                long deadline = SystemClock.elapsedRealtime() + 5000;
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IOException();
                try (InputStream input = connection.getInputStream()) {
                    ByteArrayOutputStream response = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (response.size() + count > 1024 * 1024 || SystemClock.elapsedRealtime() >= deadline) throw new IOException();
                        response.write(buffer, 0, count);
                    }
                    call.resolve(new JSObject().put("response", response.toString("UTF-8")));
                }
            } catch (Exception error) {
                // Connection exceptions may contain the full Wi-Fi onboarding URL.
                call.reject("The amplifier did not return a successful response on this network.");
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void discover(PluginCall call) {
        networkJobs.execute(() -> {
            Set<String> addresses = new LinkedHashSet<>();
            try (DatagramSocket socket = new DatagramSocket(null)) {
                lan(null).bindSocket(socket);
                socket.bind(new InetSocketAddress(0));
                byte[] query = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\n"
                    + "MX: 1\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
                socket.send(new DatagramPacket(query, query.length, InetAddress.getByName("239.255.255.250"), 1900));
                long until = SystemClock.elapsedRealtime() + 2400;
                byte[] bytes = new byte[2048];
                while (addresses.size() < 24) {
                    long remaining = until - SystemClock.elapsedRealtime();
                    if (remaining <= 0) break;
                    socket.setSoTimeout((int)remaining);
                    DatagramPacket response = new DatagramPacket(bytes, bytes.length);
                    try { socket.receive(response); } catch (SocketTimeoutException done) { break; }
                    InetAddress sender = response.getAddress();
                    if (sender.isSiteLocalAddress() && !"10.10.10.254".equals(sender.getHostAddress())) addresses.add(sender.getHostAddress());
                }
                call.resolve(new JSObject().put("addresses", new JSArray(addresses)));
            } catch (Exception error) {
                call.reject("Could not discover speakers. Connect to their Wi-Fi or add one by IP.");
            }
        });
    }

    @PluginMethod
    public void tone(PluginCall call) {
        toneJobs.execute(() -> {
            try {
                InetAddress address = speakerAddress(call.getString("address"));
                Integer gain = null;
                if (call.getData().has("gain")) {
                    Object raw = call.getData().opt("gain");
                    if (!(raw instanceof Number)) throw new IOException("Invalid tone gain.");
                    double value = ((Number)raw).doubleValue();
                    if (value != Math.rint(value) || Math.abs(value) > 10) throw new IOException("Invalid tone gain.");
                    gain = (int)value;
                }
                int actual = amplifier.run(lan(address), address, call.getString("band", ""), gain, timers);
                call.resolve(new JSObject().put("gain", actual));
            } catch (Exception error) {
                call.reject("The amplifier did not confirm the tone setting.");
            }
        });
    }

    @PluginMethod
    public void serveSweep(PluginCall call) {
        networkJobs.execute(() -> {
            try (DatagramSocket route = new DatagramSocket()) {
                InetAddress address = speakerAddress(call.getString("address"));
                String encoded = call.getString("wav");
                if (encoded == null || encoded.length() > 2 * 1024 * 1024) throw new IOException();
                byte[] wave = Base64.decode(encoded, Base64.DEFAULT);
                if (wave.length < 44 || !"RIFF".equals(new String(wave, 0, 4, StandardCharsets.US_ASCII))
                    || !"WAVE".equals(new String(wave, 8, 4, StandardCharsets.US_ASCII))) throw new IOException();
                lan(address).bindSocket(route);
                route.connect(address, 80);
                synchronized (this) {
                    if (sweep != null && !sweep.isClosed()) {
                        call.reject("A sweep is still in progress. Wait for it to finish.");
                        return;
                    }
                    SweepServer server = new SweepServer(route.getLocalAddress(), address, wave);
                    sweep = server;
                    timers.schedule(server::close, 12, TimeUnit.SECONDS);
                    networkJobs.execute(server::serve);
                    call.resolve(new JSObject().put("url", server.url()));
                }
            } catch (Exception error) {
                call.reject("Could not host the sweep on the speaker's network.");
            }
        });
    }

    @Override
    protected synchronized void handleOnDestroy() {
        if (sweep != null) sweep.close();
        toneJobs.shutdownNow();
        networkJobs.shutdownNow();
        timers.shutdown(); // Retain pending socket deadlines for in-flight tone operations.
    }
}
