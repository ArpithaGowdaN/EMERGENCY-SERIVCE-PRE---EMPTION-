from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import paho.mqtt.client as mqtt
import paho.mqtt.publish as publish
import json
import sqlite3
import hashlib
from datetime import datetime

app = Flask(__name__)
app.secret_key = "ambulance_secret_key_2024"

# ─────────────────────────────────────────────
# MQTT CONFIG
# ─────────────────────────────────────────────
MQTT_BROKER    = "broker.hivemq.com"
MQTT_PORT      = 1883
TOPIC_COMMAND  = "ambulance/junction/command"
TOPIC_ALERT    = "emergency/request"
TOPIC_VERIFIED = "emergency/verified"
TOPIC_STATUS   = "ambulance/junction/status"

# ─────────────────────────────────────────────
# HARDCODED ACCOUNTS
# Change passwords here directly — no DB users needed
# ─────────────────────────────────────────────
ACCOUNTS = {
    "admin":   {"password": hashlib.sha256("admin123".encode()).hexdigest(), "role": "admin"},
    "control": {"password": hashlib.sha256("ctrl123".encode()).hexdigest(),  "role": "control"},
}

# ─────────────────────────────────────────────
# DATABASE — alerts + commands only
# ─────────────────────────────────────────────
DB = "database.db"

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id  TEXT,
            from_dir    TEXT,
            to_dir      TEXT,
            destination TEXT,
            priority    TEXT,
            lat         REAL,
            lon         REAL,
            city        TEXT,
            verified    INTEGER DEFAULT 0,
            timestamp   TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS commands (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            command   TEXT,
            direction TEXT,
            operator  TEXT,
            timestamp TEXT
        )
    ''')

    conn.commit()
    conn.close()

init_db()

# ─────────────────────────────────────────────
# STATE
# ─────────────────────────────────────────────
latest_verified = {}
junction_status = "normal"

# ─────────────────────────────────────────────
# MQTT
# ─────────────────────────────────────────────
def on_message(client, userdata, msg):
    global latest_verified, junction_status
    try:
        topic   = msg.topic
        payload = msg.payload.decode()
        print(f"[MQTT] {topic} → {payload}")

        if topic == TOPIC_VERIFIED:
            data = json.loads(payload)
            data["timestamp"] = data.get("timestamp") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            latest_verified = data
            conn = get_db()
            conn.execute('''
                INSERT INTO alerts
                (vehicle_id, from_dir, to_dir, destination, priority, lat, lon, city, verified, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ''', (
                data.get("vehicle_id"), data.get("from_dir"), data.get("to_dir"),
                data.get("destination"), data.get("priority"),
                data.get("lat"), data.get("lon"), data.get("city"),
                data.get("timestamp")
            ))
            conn.commit()
            conn.close()

        elif topic == TOPIC_STATUS:
            junction_status = payload

    except Exception as e:
        print(f"[ERROR] {e}")

mqtt_client = mqtt.Client()
mqtt_client.on_message = on_message
mqtt_client.connect(MQTT_BROKER, MQTT_PORT)
mqtt_client.subscribe([(TOPIC_VERIFIED, 1), (TOPIC_STATUS, 0)])
mqtt_client.loop_start()

# ─────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────
@app.route("/")
def index():
    return redirect(url_for("login"))

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = hashlib.sha256(request.form.get("password", "").encode()).hexdigest()
        account  = ACCOUNTS.get(username)
        if account and account["password"] == password:
            session["user"] = username
            session["role"] = account["role"]
            return redirect(url_for("dashboard"))
        return render_template("login.html", error="Invalid username or password.")
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.route("/dashboard")
def dashboard():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("dashboard.html", user=session["user"], role=session["role"])

# ─────────────────────────────────────────────
# API
# ─────────────────────────────────────────────
@app.route("/alert/verified")
def get_verified_alert():
    if "user" not in session:
        return jsonify({"error": "unauthorized"}), 403
    return jsonify(latest_verified)

@app.route("/status")
def get_status():
    return jsonify({"status": junction_status})

@app.route("/alerts/all")
def get_all_alerts():
    if "user" not in session:
        return jsonify({"error": "unauthorized"}), 403
    conn = get_db()
    alerts = conn.execute("SELECT * FROM alerts ORDER BY timestamp DESC").fetchall()
    conn.close()
    return jsonify([dict(a) for a in alerts])

@app.route("/command/<cmd>")
def send_command(cmd):
    if "user" not in session:
        return jsonify({"error": "unauthorized"}), 403
    direction = request.args.get("direction", "North")
    if cmd in ["CLEAR", "NORMAL"]:
        payload = json.dumps({"command": cmd, "direction": direction})
        publish.single(TOPIC_COMMAND, payload, hostname=MQTT_BROKER)
        conn = get_db()
        conn.execute(
            "INSERT INTO commands (command, direction, operator, timestamp) VALUES (?, ?, ?, ?)",
            (cmd, direction, session["user"], datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        )
        conn.commit()
        conn.close()
        return jsonify({"status": "sent", "command": cmd, "direction": direction})
    return jsonify({"status": "invalid command"})

@app.route("/logs")
def get_logs():
    if "user" not in session:
        return jsonify({"error": "unauthorized"}), 403
    conn = get_db()
    alerts   = conn.execute("SELECT * FROM alerts ORDER BY timestamp DESC").fetchall()
    commands = conn.execute("SELECT * FROM commands ORDER BY timestamp DESC").fetchall()
    conn.close()
    return jsonify({
        "alerts":   [dict(a) for a in alerts],
        "commands": [dict(c) for c in commands]
    })

# ─────────────────────────────────────────────
# RUN
# ─────────────────────────────────────────────
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)