# SlashML Robotics & Spatial Memory Documentation

Ultra-low-latency spatial memory substrate and dynamic belief tracking for embodied AI, mobile manipulation, and autonomous robots.

---

## 1. Executive Overview

Robotics perception and task execution face a fundamental challenge: **spatial amnesia and coordinate obsolescence**.
When objects move in a dynamic workspace, robots must either:
1. Re-scan the entire environment with expensive visual search routines (slow, high compute overhead).
2. Query traditional databases that return outdated coordinates or lack sub-millisecond retrieval guarantees.

**SlashML Robotics** solves this with a purpose-built spatial memory engine delivering:
- **Sub-Millisecond Query Latency**: P50 < 0.35 ms and P99 < 0.55 ms across 2,000+ cluttered objects, fitting easily inside 30-60 Hz (16-33 ms) robot vision-action loops.
- **Dynamic Spatial State Updates**: When an object moves, new sensor observations immediately supersede obsolete coordinates in under 1 microsecond without reindexing.
- **Chronological Trajectory History**: Automatically maintains timestamped waypoint paths for every entity.
- **Functional Affordance Discovery**: Retrieve tools and equipment by capability (e.g. `fastening`, `measuring`, `cutting`).
- **Multi-Language Native Clients**: First-class support for Python, C++17, Rust, and TypeScript.

---

## 2. Supported Client Libraries

| Language | Package Name | Target Role | Key Integrations |
|---|---|---|---|
| **Python** | `slashml-robotics` (PyPI) | AI Perception & High-Level Orchestration | PyTorch, `rclpy`, OpenVLA, Isaac Sim, OpenCV |
| **C++** | `slashml-robotics-cpp` (CMake) | Hard Real-Time & Native Control | `rclcpp` (ROS 2), Nav2, MoveIt 2, BehaviorTree.CPP |
| **Rust** | `slashml-robotics` (crates.io) | Zero-Allocation & Fast Middleware | Zenoh, Rerun.io, embedded robotics microservices |
| **TypeScript** | `@slashml/robotics` (npm) | Fleet Management & Web Teleop | Foxglove Studio, React consoles, WebRTC video |

---

## 3. Quickstart Guides

### Python

```python
from slashml_robotics import RoboticMemory, Pose6D

# Connect to local appliance daemon or cloud service
memory = RoboticMemory(base_url="http://localhost:8000")

# Ingest perception detection (updates belief state automatically)
memory.add_observation(
    object_name="digital_caliper",
    room_zone="quality_inspection",
    pose=Pose6D(x=2.1, y=0.5, z=0.85),
    tags=["tool", "inspection"],
)

# Sub-microsecond active location lookup
loc = memory.where_is("digital_caliper")
print(f"Location: {loc.room_zone} at ({loc.pose.x}, {loc.pose.y}, {loc.pose.z})")

# Chronological trajectory history
traj = memory.get_trajectory("digital_caliper")
for wp in traj.waypoints:
    print(f"[{wp.timestamp}] Visited {wp.room_zone}")
```

### C++17 Header-Only

```cpp
#include <slashml/client.hpp>

int main() {
    using namespace slashml::robotics;
    RoboticMemoryClient client("http://localhost:8000");

    client.add_observation("torque_wrench", "tool_crib", Pose6D(1.0, 0.5, 0.8));
    auto loc = client.where_is("torque_wrench");
    if (loc) {
        std::cout << "Zone: " << loc->room_zone << "\n";
    }
    return 0;
}
```

### Rust

```rust
use slashml_robotics::{RoboticMemoryClient, Pose6D};

fn main() {
    let client = RoboticMemoryClient::new("http://localhost:8000", "key", "robot_1");
    client.add_observation("caliper", "tool_crib", Pose6D::new(1.0, 0.0, 0.8), &[], 1.0, None);
    if let Some(loc) = client.where_is("caliper") {
        println!("Found at zone: {}", loc.room_zone);
    }
}
```

---

## 4. ROS 2 Bridge Integration

The ROS 2 bridge connects onboard cameras and detectors (e.g. YOLO, RT-DETR, SAM) to SlashML:

```python
from slashml_robotics.ros2.bridge_node import SlashMLSpatialBridgeNode

# In your ROS 2 launch file or Python node:
bridge = SlashMLSpatialBridgeNode(node_name="spatial_memory_bridge")

# Vision callback runs at 30 Hz with <50 microseconds overhead:
bridge.handle_detection(
    class_name="wire_strippers",
    pose_x=1.25,
    pose_y=-0.4,
    pose_z=0.9,
)
```

The bridge advertises standard ROS 2 services for behavior tree planners:
- `/slashml/where_is`
- `/slashml/get_trajectory`
- `/slashml/find_by_affordance`

---

## 5. Embodied Agentic Tooling (MCP)

For physical reasoning agents (Claude, Gemini, OpenAI, local LLMs), SlashML provides Model Context Protocol (MCP) tools:

- `locate_physical_object`: Retrieve active 6-DoF location and room zone.
- `record_sensor_observation`: Ingest detection and supersede older coordinates automatically.
- `query_object_trajectory`: Reconstruct full chronological movement paths.
- `find_objects_by_affordance`: Find workspace items capable of executing an action.

```bash
# Install standalone Robotics plugin & skill in Claude Code
/plugin install slashml-robotics --marketplace slashml-ai/slashml-robotics
```

---

## 6. Architecture & Deployment Options

SlashML is distributed as a pre-compiled, opaque binary appliance or container:
- **Local Embedded IPC**: Run `slashmld` directly on NVIDIA Jetson AGX Orin or industrial x86 computers over Unix Domain Sockets for microsecond-level IPC.
- **On-Premise Edge Server**: Central workstation serving multiple mobile robots across a facility via gRPC/HTTP.
- **SlashML Cloud**: Multi-facility fleet coordination with global synchronization.

<!-- mcp-name: io.github.slashml-ai/slashml-robotics -->
