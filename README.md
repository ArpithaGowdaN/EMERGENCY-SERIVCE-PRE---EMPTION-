# Emergency Services Pre-emption using ESP32 and IoT

## 🚦 Project Overview
This project focuses on a secure and practical emergency vehicle pre-emption system for a limited demo setup (1 to 2 traffic signals). During a traffic jam, emergency vehicles such as ambulances, fire trucks, or police vehicles may get delayed at signals. 

The objective of this project is to create an IoT-based emergency pre-emption system where the vehicle can send an emergency request to a control room. The request is verified and approved, and the required traffic signal(s) can be cleared automatically or manually for a short path ahead.

## 🏗️ System Architecture
The project utilizes **two ESP32 microcontrollers** and a web-based dashboard:
1. **Vehicle Unit (ESP32 #1):** Placed in the emergency vehicle. Responsible for sending the pre-emption request (direction, destination, and number of signals) via Wi-Fi/MQTT/HTTP.
2. **Traffic Signal Node (ESP32 #2):** Located at the traffic signal. Receives approval commands from the control room and drives LEDs/relays to simulate signal changes.
3. **Control Room Dashboard:** Runs on a laptop/PC (browser-based). Displays incoming requests, verifies the vehicle, and approves the signal pre-emption command.

## 🛠️ Hardware Components
- **2x ESP32 Development Boards** (1 for Vehicle Unit, 1 for Traffic Signal Node)
- **GPS Module** (NEO-6M or similar) - *Provides location information and live tracking*
- **IR Sensor** - *Detects vehicle crossing for closed-loop reset at a signal*
- **LEDs / Traffic Light Module** - *Simulates red, yellow, and green traffic lights*
- **Push Buttons / Manual Override Switch** - *Allows manual signal change testing*
- **Power Supply & Jumper Wires**
- **Breadboard**

## 💻 Software & Tools
- **Firmware:** Arduino IDE / PlatformIO
- **Communication:** MQTT Broker or HTTP Backend
- **Dashboard:** HTML, CSS, JavaScript (Web browser for access and testing)
- **Database (Optional):** Firebase or Local Database (for storing vehicle IDs, logs, and status)
- **Debugging:** Serial Monitor, USB Cable

## 🔄 System Flow
1. **Request:** Emergency vehicle detects the need for signal pre-emption.
2. **Transmit:** Vehicle's ESP32 sends a request with direction, destination, and the number of signals to the control room.
3. **Verify:** The control room dashboard receives the request, verifies it, and the operator (or automated system) approves it.
4. **Execute:** The Signal Node's ESP32 receives the command and turns the target signal to Green.
5. **Passage:** The emergency vehicle passes through the cleared intersection.
6. **Reset:** Using an IR sensor or GPS condition, the system detects the vehicle has passed and restores normal traffic light operation.

## 🚀 Why ESP32?
The ESP32 is an ideal choice for this project because it features built-in Wi-Fi, sufficient processing power for IoT messaging, excellent sensor interfacing capabilities, and low cost. Using two ESP32s (Vehicle and Node) alongside a laptop-based control room creates a perfect college-level demonstration of a real-world smart city application.

## 🔮 Future Scope
- GPS-based live route tracking
- Automatic route optimization
- Multi-vehicle priority handling
- Stronger authentication mechanisms to prevent system misuse
