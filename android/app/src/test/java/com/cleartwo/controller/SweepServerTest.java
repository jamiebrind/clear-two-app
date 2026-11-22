package com.cleartwo.controller;

import static org.junit.Assert.*;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.URL;
import org.junit.Test;

public class SweepServerTest {
    @Test
    public void servesTheSelectedSpeakerByteRangesAndClosesOnExpiry() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        byte[] sample = new byte[] { 0, 1, 2, 3, 4 };
        SweepServer server = new SweepServer(loopback, loopback, sample);
        Thread worker = new Thread(server::serve);
        worker.start();
        try {
            HttpURLConnection request = (HttpURLConnection)new URL(server.url()).openConnection(Proxy.NO_PROXY);
            request.setReadTimeout(2000);
            request.setRequestProperty("Range", "bytes=1-3");
            assertEquals(206, request.getResponseCode());
            assertEquals("bytes 1-3/5", request.getHeaderField("Content-Range"));
            try (InputStream body = request.getInputStream()) {
                assertArrayEquals(new byte[] { 1, 2, 3 }, body.readAllBytes());
            } finally { request.disconnect(); }
        } finally {
            server.close();
            worker.join(2000);
        }
        assertFalse(worker.isAlive());
    }
}
