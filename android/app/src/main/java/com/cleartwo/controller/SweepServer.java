package com.cleartwo.controller;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** One expiring WAV on the phone's LAN interface, readable only by the selected amplifier. */
final class SweepServer implements Closeable {
    private static final Pattern RANGE = Pattern.compile("(?im)^range:[ \\t]*bytes=(\\d*)-(\\d*)[ \\t]*\\r?$");
    private final ServerSocket listener;
    private final InetAddress speaker;
    private final byte[] wave;
    private final String path = "/" + UUID.randomUUID() + ".wav";
    private Socket connection;

    SweepServer(InetAddress local, InetAddress speaker, byte[] wave) throws IOException {
        this.speaker = speaker;
        this.wave = wave;
        listener = new ServerSocket();
        try {
            listener.bind(new InetSocketAddress(local, 0), 4);
        } catch (IOException error) {
            listener.close();
            throw error;
        }
    }

    String url() {
        return "http://" + listener.getInetAddress().getHostAddress() + ":" + listener.getLocalPort() + path;
    }

    boolean isClosed() { return listener.isClosed(); }

    void serve() {
        while (!isClosed()) {
            try (Socket client = listener.accept()) {
                if (!client.getInetAddress().equals(speaker)) continue;
                synchronized (this) {
                    if (isClosed()) return;
                    connection = client;
                }
                client.setSoTimeout(1500);
                respond(client);
            } catch (IOException ignored) {
                // The listener expires independently. A player can reconnect after disconnecting.
            } finally {
                synchronized (this) { connection = null; }
            }
        }
    }

    private void respond(Socket client) throws IOException {
        BufferedInputStream input = new BufferedInputStream(client.getInputStream());
        ByteArrayOutputStream headers = new ByteArrayOutputStream();
        int last = 0;
        while (last != 0x0D0A0D0A) {
            int b = input.read();
            if (b == -1 || headers.size() >= 8192) return;
            headers.write(b);
            last = (last << 8) | b;
        }
        String request = headers.toString("US-ASCII");
        String[] line = request.substring(0, request.indexOf("\r\n")).split(" ");
        if (line.length != 3 || !path.equals(line[1]) || !(line[0].equals("GET") || line[0].equals("HEAD"))) return;

        Matcher range = RANGE.matcher(request);
        boolean partial = range.find();
        long first = 0, end = wave.length - 1;
        OutputStream output = client.getOutputStream();
        if (partial) {
            try {
                if (range.group(1).isEmpty()) first = Math.max(0, wave.length - Long.parseLong(range.group(2)));
                else {
                    first = Long.parseLong(range.group(1));
                    if (!range.group(2).isEmpty()) end = Math.min(end, Long.parseLong(range.group(2)));
                }
            } catch (NumberFormatException invalid) { first = wave.length; }
            if (first > end) {
                output.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + wave.length
                    + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                return;
            }
        }
        int count = (int)(end - first + 1);
        String status = partial ? "206 Partial Content" : "200 OK";
        String contentRange = partial ? "Content-Range: bytes " + first + "-" + end + "/" + wave.length + "\r\n" : "";
        String response = "HTTP/1.1 " + status + "\r\nContent-Type: audio/wav\r\nAccept-Ranges: bytes\r\n"
            + contentRange + "Content-Length: " + count + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.US_ASCII));
        if (line[0].equals("GET")) output.write(wave, (int)first, count);
    }

    @Override
    public synchronized void close() {
        try { listener.close(); } catch (IOException ignored) {}
        if (connection != null) {
            try { connection.close(); } catch (IOException ignored) {}
        }
    }
}
