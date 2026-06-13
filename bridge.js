/**
 * bridge.js — Token Verification MQTT Bridge
 * ESP32 uses "auth_token" field (not "token")
 */

"use strict";

const mqtt = require("mqtt");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const BROKER         = "mqtt://broker.hivemq.com:1883";
const TOPIC_RAW      = "emergency/request";
const TOPIC_VERIFIED = "emergency/verified";
const TOPIC_REJECTED = "emergency/rejected";

// ─────────────────────────────────────────────
// REGISTERED VEHICLES
// Must match ESP32 #1 VEHICLES array exactly
// ─────────────────────────────────────────────
const REGISTERED_VEHICLES = {
  "AMB-01":  "a3f9x2k7",
  "FIRE-01": "f4r3x9z2",
};

// ─────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────
const client = mqtt.connect(BROKER, {
  clientId:        "bridge_" + Math.random().toString(16).slice(2, 10),
  clean:           true,
  reconnectPeriod: 3000,
});

client.on("connect", () => {
  console.log(`[bridge] Connected to ${BROKER}`);
  client.subscribe(TOPIC_RAW, { qos: 1 }, (err) => {
    if (err) { console.error("[bridge] Subscribe error:", err); return; }
    console.log(`[bridge] Subscribed  → ${TOPIC_RAW}`);
    console.log(`[bridge] Verified   → ${TOPIC_VERIFIED}`);
    console.log(`[bridge] Rejected   → ${TOPIC_REJECTED}\n`);
  });
});

client.on("error",     (err) => console.error("[bridge] Error:",      err.message));
client.on("offline",   ()    => console.warn("[bridge]  Offline"));
client.on("reconnect", ()    => console.log("[bridge]  Reconnecting…"));

// ─────────────────────────────────────────────
// VERIFICATION
// ─────────────────────────────────────────────
client.on("message", (topic, payloadBuf) => {
  if (topic !== TOPIC_RAW) return;

  let data;
  try {
    data = JSON.parse(payloadBuf.toString());
  } catch (e) {
    console.warn("[bridge] Malformed JSON — dropped");
    return;
  }

  const vehicleId = data.vehicle_id || "";
  const token     = data.auth_token  || "";   // ← her field name

  console.log(`[bridge] Request from: ${vehicleId} | token: ${token}`);

  // ── No token or no vehicle ID ──
  if (!token || !vehicleId) {
    console.log(`[bridge] REJECTED — no token/id`);
    publishRejected(data, "no_token");
    return;
  }

  // ── Unknown vehicle ──
  const expectedToken = REGISTERED_VEHICLES[vehicleId];
  if (!expectedToken) {
    console.log(`[bridge] REJECTED — unknown vehicle: ${vehicleId}`);
    publishRejected(data, "unknown_vehicle");
    return;
  }

  // ── Token mismatch ──
  if (!timingSafeEqual(token, expectedToken)) {
    console.log(`[bridge] REJECTED — invalid token for: ${vehicleId}`);
    publishRejected(data, "invalid_token");
    return;
  }

  // ── VERIFIED ──
  console.log(`[bridge] VERIFIED ✓ | ${vehicleId} | ${data.priority || "?"} priority`);

  const clean = { ...data };
  delete clean.auth_token;          // strip token before forwarding
  clean.verified  = true;
  clean.timestamp = clean.timestamp ||
    new Date().toISOString().replace("T", " ").slice(0, 19);

  client.publish(
    TOPIC_VERIFIED,
    JSON.stringify(clean),
    { qos: 1, retain: false },
    (err) => {
      if (err) console.error("[bridge] Publish error:", err);
      else     console.log(`[bridge] Published → ${TOPIC_VERIFIED}`);
    }
  );
});

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function publishRejected(data, reason) {
  const payload = JSON.stringify({
    vehicle_id: data.vehicle_id || "unknown",
    reason,
    timestamp:  new Date().toISOString().replace("T", " ").slice(0, 19),
  });
  client.publish(TOPIC_REJECTED, payload, { qos: 0 });
  console.log(`[bridge] Published → ${TOPIC_REJECTED} | reason: ${reason}`);
}