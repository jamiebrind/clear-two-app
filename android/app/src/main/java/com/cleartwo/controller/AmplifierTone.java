package com.cleartwo.controller;

import android.net.Network;
import android.os.SystemClock;
import java.io.DataInputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

final class AmplifierTone {
    private static final int MAGIC = 0x20189618;
    private long nextSend;

    // The caller serializes operations, including the gap between separate connections.
    int run(Network network, InetAddress speaker, String band, Integer gain, ScheduledExecutorService timers)
        throws IOException, InterruptedException {
        String command;
        switch (band) {
            case "bass": command = "BAS"; break;
            case "mid": command = "MID"; break;
            case "treble": command = "TRE"; break;
            default: throw new IOException("Choose bass, mid or treble.");
        }
        String prefix = "MCU+PAS+RAKOIT:" + command;
        try (Socket socket = network.getSocketFactory().createSocket()) {
            ScheduledFuture<?> timeout = timers.schedule(() -> {
                try { socket.close(); } catch (IOException ignored) {}
            }, 4300, TimeUnit.MILLISECONDS);
            try {
                socket.connect(new InetSocketAddress(speaker, 8899), 2500);
                DataInputStream input = new DataInputStream(socket.getInputStream());
                if (gain != null) exchange(socket, input, prefix, ":" + gain);
                int actual = exchange(socket, input, prefix, "");
                if (gain != null && actual != gain) throw new IOException("The amplifier did not confirm the tone setting.");
                return actual;
            } finally {
                timeout.cancel(false);
            }
        }
    }

    private int exchange(Socket socket, DataInputStream input, String prefix, String setting)
        throws IOException, InterruptedException {
        long delay = nextSend - SystemClock.elapsedRealtime();
        if (delay > 0) Thread.sleep(delay);
        byte[] payload = (prefix + setting + "&").getBytes(StandardCharsets.US_ASCII);
        ByteBuffer packet = ByteBuffer.allocate(20 + payload.length).order(ByteOrder.LITTLE_ENDIAN);
        packet.putInt(MAGIC).putInt(payload.length).putInt(checksum(payload)).putLong(0).put(payload);
        nextSend = SystemClock.elapsedRealtime() + 220;
        socket.getOutputStream().write(packet.array());
        while (true) {
            byte[] header = new byte[20];
            input.readFully(header);
            ByteBuffer fields = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
            int magic = fields.getInt(), size = fields.getInt(), expected = fields.getInt();
            if (magic != MAGIC || size < 0 || size > 65536) throw new IOException("Invalid amplifier packet.");
            byte[] response = new byte[size];
            input.readFully(response);
            if (checksum(response) != expected) throw new IOException("Invalid amplifier checksum.");
            String reply = new String(response, StandardCharsets.UTF_8).trim();
            if (reply.startsWith("MCU+PAS+RAKOIT:ERR:")) throw new IOException("The amplifier rejected the tone command.");
            if (!reply.startsWith(prefix + ":")) continue;
            String value = reply.substring(prefix.length() + 1).replaceFirst("&$", "");
            if (!value.matches("-?[0-9]{1,2}")) throw new IOException("Invalid amplifier gain.");
            int gain = Integer.parseInt(value);
            if (Math.abs(gain) > 10) throw new IOException("Invalid amplifier gain.");
            return gain;
        }
    }

    private static int checksum(byte[] bytes) {
        int sum = 0;
        for (byte b : bytes) sum += b & 255;
        return sum;
    }
}
