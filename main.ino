// ─────────────────────────────────────────────
//  Member 1 — Vehicle ESP32 Unit
//  IoT Emergency Signal Preemption
//  With IP Based Location
// ─────────────────────────────────────────────

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

// ─────────────────────────────────────────────
//  CONFIG — EDIT ONLY THIS SECTION
// ─────────────────────────────────────────────

// Wi-Fi
const char* WIFI_SSID     = "YourWiFiName";      // <- change this
const char* WIFI_PASSWORD = "YourWiFiPassword";   // <- change this

// MQTT Broker
const char* MQTT_BROKER     = "broker.hivemq.com";
const int   MQTT_PORT       = 1883;
const char* MQTT_TOPIC_PUB  = "emergency/request";
const char* MQTT_TOPIC_ACK  = "emergency/ack";

// Vehicle Identity
const char* VEHICLE_ID     = "AMB-01";
const char* AUTH_TOKEN     = "a3f9x2k7";
const char* DESTINATION    = "Victoria Hospital";
const int   SIGNALS_NEEDED = 2;

// GPIO Pins
const int BUTTON_PIN  = 4;
const int ACK_LED_PIN = 2;

// Fallback coordinates if IP location fails
const float FALLBACK_LAT = 12.9716;
const float FALLBACK_LON = 77.5946;

// ─────────────────────────────────────────────
//  OBJECTS
// ─────────────────────────────────────────────
WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
bool              lastButtonState = HIGH;
unsigned long     lastDebounce    = 0;
const unsigned long DEBOUNCE_MS  = 50;

float  currentLat  = FALLBACK_LAT;
float  currentLon  = FALLBACK_LON;
String currentCity = "Bengaluru";

// ─────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Vehicle ESP32 Booting ===");

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(ACK_LED_PIN, OUTPUT);
  digitalWrite(ACK_LED_PIN, LOW);

  connectWiFi();

  // MQTT first
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  connectMQTT();

  // Then get location
  getIPLocation();

  Serial.println("[READY] Press button to send emergency request");
  Serial.printf("[LOCATION] %.6f, %.6f — %s\n", currentLat, currentLon, currentCity.c_str());
}

// ─────────────────────────────────────────────
//  LOOP
// ─────────────────────────────────────────────
void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  bool reading = digitalRead(BUTTON_PIN);
  if (reading != lastButtonState) {
    lastDebounce = millis();
  }
  if ((millis() - lastDebounce) > DEBOUNCE_MS) {
    if (reading == LOW) {
      lastButtonState = reading;
      handleButtonPress();
    }
  }
  lastButtonState = reading;
}

// ─────────────────────────────────────────────
//  GET LOCATION FROM IP
// ─────────────────────────────────────────────
void getIPLocation() {
  Serial.println("[LOCATION] Fetching location from IP...");

  HTTPClient http;
  http.begin("http://ip-api.com/json");
  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      currentLat  = doc["lat"].as<float>();
      currentLon  = doc["lon"].as<float>();
      currentCity = doc["city"].as<String>();

      Serial.printf("[LOCATION] Got location!\n");
      Serial.printf("[LOCATION] Lat: %.6f  Lon: %.6f\n", currentLat, currentLon);
      Serial.printf("[LOCATION] City: %s\n", currentCity.c_str());
      blinkLED(2, 200);
    } else {
      Serial.println("[LOCATION] Parse failed — using fallback");
      useFallback();
    }
  } else {
    Serial.printf("[LOCATION] HTTP failed — using fallback\n");
    useFallback();
  }
  http.end();
}

void useFallback() {
  currentLat  = FALLBACK_LAT;
  currentLon  = FALLBACK_LON;
  currentCity = "Bengaluru";
}

// ─────────────────────────────────────────────
//  BUTTON HANDLER
// ─────────────────────────────────────────────
void handleButtonPress() {
  Serial.println("\n[BUTTON] Press detected — building request...");

  // Refresh location on every press
  getIPLocation();

  String payload = buildPayload();
  Serial.println("[PAYLOAD] " + payload);
  publishRequest(payload);
}

// ─────────────────────────────────────────────
//  BUILD JSON PAYLOAD
// ─────────────────────────────────────────────
String buildPayload() {
  StaticJsonDocument<300> doc;
  doc["vehicle_id"]        = VEHICLE_ID;
  doc["auth_token"]        = AUTH_TOKEN;
  doc["lat"]               = currentLat;
  doc["lon"]               = currentLon;
  doc["city"]              = currentCity;
  doc["direction"]         = "North";
  doc["destination"]       = DESTINATION;
  doc["signals_requested"] = SIGNALS_NEEDED;
  doc["priority"]          = "high";

  String output;
  serializeJson(doc, output);
  return output;
}

// ─────────────────────────────────────────────
//  PUBLISH
// ─────────────────────────────────────────────
void publishRequest(String payload) {
  if (mqtt.publish(MQTT_TOPIC_PUB, payload.c_str())) {
    Serial.println("[MQTT] Published successfully");
    blinkLED(3, 100);
  } else {
    Serial.println("[MQTT] Publish FAILED");
    blinkLED(1, 800);
  }
}

// ─────────────────────────────────────────────
//  MQTT INCOMING MESSAGE
// ─────────────────────────────────────────────
void onMqttMessage(char* topic, byte* message, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)message[i];
  Serial.println("[MQTT] Incoming: " + msg);

  if (String(topic) == MQTT_TOPIC_ACK) {
    if (msg == "approved") {
      Serial.println("[ACK] APPROVED — signal turning green!");
      blinkLED(5, 100);
    } else if (msg == "rejected") {
      Serial.println("[ACK] REJECTED");
      blinkLED(1, 1000);
    } else if (msg == "reroute") {
      Serial.println("[ACK] REROUTE — road blocked ahead!");
      blinkLED(10, 50);
    }
  }
}

// ─────────────────────────────────────────────
//  WI-FI
// ─────────────────────────────────────────────
void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.print(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected — IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] FAILED — check credentials");
  }
}

// ─────────────────────────────────────────────
//  MQTT CONNECT
// ─────────────────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("[MQTT] Connecting...");
    String clientId = "vehicle-AMB01";
    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" connected");
      mqtt.subscribe(MQTT_TOPIC_ACK);
    } else {
      Serial.print(" failed rc=");
      Serial.print(mqtt.state());
      Serial.println(" retrying in 3s...");
      delay(3000);
    }
  }
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
void blinkLED(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(ACK_LED_PIN, HIGH);
    delay(ms);
    digitalWrite(ACK_LED_PIN, LOW);
    delay(ms);
  }
}
