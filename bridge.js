// ═══════════════════════════════════════════════════════════════
//  Verification Bridge — Final Version
//  Run: node bridge.js
// ═══════════════════════════════════════════════════════════════

const mqtt = require('mqtt');

const BROKER      = 'mqtt://broker.hivemq.com:1883';
const TOPIC_IN    = 'emergency/request';
const TOPIC_OUT   = 'emergency/verified';
const TOPIC_BLOCK = 'emergency/blocked';
const TOPIC_ACK   = 'emergency/ack';

// ── Registered vehicles ──────────────────────────────────────
const REGISTERED = {
  'AMB-01':  'a3f9x2k7',
  'FIRE-01': 'f4r3x9z2'
};

// ── Junction registry ────────────────────────────────────────
const JUNCTIONS = [
  {
    id:   'SIG-01',
    name: 'Demo Junction Near College',
    lat:  12.9720,
    lon:  77.5950
  },
  {
    id:   'SIG-02',
    name: 'KR Puram Junction',
    lat:  12.9950,
    lon:  77.6753
  }
];

// ── Haversine distance formula ───────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Find nearest junction ────────────────────────────────────
function findNearestJunction(lat, lon) {
  let nearest = null;
  let minDist = Infinity;
  JUNCTIONS.forEach(j => {
    const dist = getDistance(lat, lon, j.lat, j.lon);
    if (dist < minDist) {
      minDist = dist;
      nearest = { ...j, distance: Math.round(dist) };
    }
  });
  return nearest;
}

// ── ETA calculation ──────────────────────────────────────────
function calculateETA(distanceMeters, speedKmh) {
  const speedMs = (speedKmh * 1000) / 3600;
  const seconds = distanceMeters / speedMs;
  const minutes = Math.floor(seconds / 60);
  const secs    = Math.round(seconds % 60);
  return {
    seconds: Math.round(seconds),
    display: minutes > 0
             ? `${minutes} min ${secs} sec`
             : `${Math.round(seconds)} seconds`
  };
}

// ── Urgency ──────────────────────────────────────────────────
function urgency(etaSec) {
  if (etaSec < 60)  return 'NOW';
  if (etaSec < 120) return 'SOON';
  return 'READY';
}

// ── Connect to broker ────────────────────────────────────────
console.log('='.repeat(55));
console.log('   Emergency Verification Bridge — Starting');
console.log('='.repeat(55));

const client = mqtt.connect(BROKER, {
  clientId:        'bridge-' + Math.random().toString(16).slice(2, 8),
  clean:           true,
  reconnectPeriod: 3000
});

client.on('connect', () => {
  console.log('\n✅ Connected to broker.hivemq.com');
  console.log('📡 Listening on : ' + TOPIC_IN);
  console.log('📤 Forwarding to: ' + TOPIC_OUT);
  console.log('\nRegistered vehicles:');
  Object.keys(REGISTERED).forEach(id =>
    console.log('  ✅ ' + id));
  console.log('\nJunctions:');
  JUNCTIONS.forEach(j =>
    console.log(`  📍 ${j.name}`));
  console.log('\n' + '─'.repeat(55));
  console.log('⏳ Waiting for requests...\n');
  client.subscribe(TOPIC_IN);
});

// ── Handle incoming request ──────────────────────────────────
client.on('message', (topic, message) => {
  const time = new Date().toLocaleTimeString();
  console.log(`\n[${time}] ── New request received ──────────`);

  let data;
  try {
    data = JSON.parse(message.toString());
  } catch (e) {
    console.log('❌ Invalid JSON — dropping');
    return;
  }

  const { vehicle_id, auth_token, lat, lon, speed_kmh } = data;

  console.log(`Vehicle  : ${vehicle_id}`);
  console.log(`Token    : ${auth_token}`);
  console.log(`Location : ${lat}, ${lon}`);
  console.log(`City     : ${data.city}`);

  // ── Token verification ────────────────────────────────────
  const validToken = REGISTERED[vehicle_id];

  if (!validToken) {
    console.log(`\n❌ REJECTED — ${vehicle_id} not registered`);
    client.publish(TOPIC_BLOCK, JSON.stringify({
      ...data,
      reason:     'Vehicle not registered',
      blocked_at: time
    }));
    // Send ack back to ESP32
    client.publish(TOPIC_ACK, 'rejected');
    return;
  }

  if (auth_token !== validToken) {
    console.log(`\n❌ REJECTED — Invalid token for ${vehicle_id}`);
    client.publish(TOPIC_BLOCK, JSON.stringify({
      ...data,
      reason:     'Invalid auth token',
      blocked_at: time
    }));
    client.publish(TOPIC_ACK, 'rejected');
    return;
  }

  console.log(`\n✅ VERIFIED — ${vehicle_id} is authorized`);

  // ── ETA Calculation ───────────────────────────────────────
  const junction = findNearestJunction(lat, lon);
  const speed    = speed_kmh || 40;
  const eta      = calculateETA(junction.distance, speed);
  const rec      = urgency(eta.seconds);

  console.log(`\n📍 Nearest junction : ${junction.name}`);
  console.log(`📏 Distance         : ${junction.distance} meters`);
  console.log(`⏱️  ETA              : ${eta.display}`);
  console.log(`🚦 Recommendation   : ${
    rec === 'NOW'  ? '🔴 Change NOW!' :
    rec === 'SOON' ? '🟡 Change SOON' :
                     '🟢 Change READY'
  }`);

  // ── Forward to dashboard ──────────────────────────────────
  const verified = {
    vehicle_id:        vehicle_id,
    vehicle_type:      data.vehicle_type    || 'Emergency',
    destination:       data.destination     || 'N/A',
    direction:         data.direction       || 'N/A',
    signals_requested: data.signals_requested || 1,
    priority:          data.priority        || 'high',
    lat:               lat,
    lon:               lon,
    city:              data.city            || 'Bengaluru',
    gps_fixed:         data.gps_fixed       || false,
    verified:          true,
    verified_at:       time,
    nearest_junction:  junction.name,
    junction_id:       junction.id,
    distance_meters:   junction.distance,
    eta_seconds:       eta.seconds,
    eta_display:       eta.display,
    recommendation:    rec
  };

  client.publish(TOPIC_OUT, JSON.stringify(verified));
  console.log('\n📤 Forwarded to dashboard successfully');
  console.log('─'.repeat(55));
});

client.on('error', err => {
  console.log('❌ Broker error:', err.message);
});

client.on('reconnect', () => {
  console.log('[MQTT] Reconnecting...');
});
