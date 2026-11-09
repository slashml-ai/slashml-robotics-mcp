#!/usr/bin/env node
/**
 * SlashML Robotics (@slashml/robotics) — Embodied 6-DoF SE(3) Spatial Memory MCP Server
 *
 * Self-contained stdio MCP server shipped inside the plugin directory so
 * Claude Code can execute it directly via:
 *   node "${CLAUDE_PLUGIN_ROOT}/hooks/slashml-robotics-mcp.js"
 *
 * Authentication:
 *   Configured via Claude Code plugin `userConfig.api_key` (`sensitive: true`),
 *   injected as `CLAUDE_PLUGIN_OPTION_API_KEY`.
 */

"use strict";

const readline = require("readline");
const crypto = require("crypto");

const VERSION = "1.0.2";
const DEFAULT_BASE_URL = "https://api.slashml.ai";
const DEFAULT_NAMESPACE = "robotics-spatial-world";

function getConfig() {
  const apiKey = String(process.env.CLAUDE_PLUGIN_OPTION_API_KEY || "").trim();
  return {
    apiKey,
    baseUrl: DEFAULT_BASE_URL,
    namespace: DEFAULT_NAMESPACE,
  };
}

function normalizePose(raw) {
  const arr = Array.isArray(raw) ? raw.map((n) => Number(n) || 0) : [0, 0, 0];
  return {
    x: arr[0] || 0,
    y: arr[1] || 0,
    z: arr[2] || 0,
    qx: arr.length >= 7 ? arr[3] : 0,
    qy: arr.length >= 7 ? arr[4] : 0,
    qz: arr.length >= 7 ? arr[5] : 0,
    qw: arr.length >= 7 ? arr[6] : 1,
  };
}

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const activeObjects = new Map();
const trajectories = new Map();

async function syncObservationToCloud(obs) {
  const { apiKey, baseUrl, namespace } = getConfig();
  if (!apiKey) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(`${baseUrl}/v1/memories`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": `slashml-robotics-plugin/${VERSION}`,
      },
      body: JSON.stringify({
        text: `[ROBOTICS_OBSERVATION] object=${obs.object_name} zone=${obs.room_zone} pose=(${obs.pose.x},${obs.pose.y},${obs.pose.z}) tags=${(obs.tags || []).join(",")}`,
        namespace,
        metadata: obs,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (_) {
    // Non-fatal cloud telemetry sync
  }
}

const ROBOTICS_TOOLS = [
  {
    name: "locate_physical_object",
    description:
      "Get the current active 6-DoF location, room zone, and observation timestamp of a physical object in the robot's workspace.",
    inputSchema: {
      type: "object",
      properties: {
        object_name: {
          type: "string",
          description:
            "Name or canonical label of the object (e.g. 'torque_wrench', 'digital_caliper', 'parts_bin').",
        },
      },
      required: ["object_name"],
    },
  },
  {
    name: "record_sensor_observation",
    description:
      "Record a new camera/perception observation of a physical object. Automatically supersedes older coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        object_name: {
          type: "string",
          description: "Name or label of the object.",
        },
        room_zone: {
          type: "string",
          description:
            "Room or workstation zone (e.g. 'machining_bay', 'tool_crib', 'assembly_station').",
        },
        pose: {
          type: "array",
          items: { type: "number" },
          description:
            "3D position [x, y, z] or 6-DoF pose [x, y, z, qx, qy, qz, qw] in meters.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional semantic tags or affordances (e.g. ['tool', 'fastening']).",
        },
        confidence: {
          type: "number",
          description: "Detection confidence score between 0.0 and 1.0.",
        },
      },
      required: ["object_name", "room_zone", "pose"],
    },
  },
  {
    name: "query_object_trajectory",
    description:
      "Reconstruct the chronological movement trajectory and waypoint history for an object across workspaces.",
    inputSchema: {
      type: "object",
      properties: {
        object_name: {
          type: "string",
          description:
            "Name of the object whose movement path is to be inspected.",
        },
      },
      required: ["object_name"],
    },
  },
  {
    name: "find_objects_by_affordance",
    description:
      "Find active physical objects in the workspace that support a given task affordance (e.g. 'fastening', 'measuring', 'stripping').",
    inputSchema: {
      type: "object",
      properties: {
        affordance: {
          type: "string",
          description:
            "Functional capability or action (e.g. 'fastening', 'measuring', 'cutting', 'soldering').",
        },
        room_zone: {
          type: "string",
          description: "Optional room zone filter (e.g. 'machining_bay').",
        },
      },
      required: ["affordance"],
    },
  },
];

async function executeRoboticsTool(name, args) {
  if (name === "locate_physical_object" || name === "where_is") {
    const key = String(args.object_name || "").trim().toLowerCase();
    const loc = activeObjects.get(key);
    if (!loc) {
      return {
        status: "not_found",
        message: `Object '${args.object_name || ""}' has no active observation in memory.`,
      };
    }
    const nowSec = Date.now() / 1000;
    return {
      status: "found",
      object_name: loc.object_name,
      room_zone: loc.room_zone,
      pose: loc.pose,
      timestamp: loc.timestamp,
      confidence: loc.confidence,
      age_seconds: Number(Math.max(0, nowSec - loc.timestamp).toFixed(2)),
    };
  }

  if (name === "record_sensor_observation" || name === "add_observation") {
    const objName = String(args.object_name || "").trim();
    const key = objName.toLowerCase();
    const roomZone = String(args.room_zone || "").trim();
    const pose = normalizePose(args.pose);
    const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
    const confidence =
      args.confidence !== undefined ? Number(args.confidence) : 1.0;
    const timestamp = Date.now() / 1000;
    const observationId =
      "obs_" + crypto.randomBytes(6).toString("hex");

    const obs = {
      observation_id: observationId,
      object_name: objName,
      room_zone: roomZone,
      pose,
      tags,
      confidence,
      timestamp,
    };

    activeObjects.set(key, obs);
    const hist = trajectories.get(key) || [];
    hist.push(obs);
    trajectories.set(key, hist);

    await syncObservationToCloud(obs);

    return {
      status: "recorded",
      observation_id: observationId,
      object_name: objName,
      room_zone: roomZone,
      pose,
    };
  }

  if (name === "query_object_trajectory" || name === "get_trajectory") {
    const objName = String(args.object_name || "").trim();
    const key = objName.toLowerCase();
    const waypoints = trajectories.get(key) || [];
    let totalDistance = 0;
    const zonesVisited = [];
    for (let i = 0; i < waypoints.length; i++) {
      if (i > 0) {
        totalDistance += distance3D(waypoints[i - 1].pose, waypoints[i].pose);
      }
      if (
        zonesVisited.length === 0 ||
        zonesVisited[zonesVisited.length - 1] !== waypoints[i].room_zone
      ) {
        zonesVisited.push(waypoints[i].room_zone);
      }
    }
    return {
      object_name: objName,
      waypoint_count: waypoints.length,
      total_distance_m: Number(totalDistance.toFixed(4)),
      zones_visited: zonesVisited,
      waypoints,
    };
  }

  if (
    name === "find_objects_by_affordance" ||
    name === "find_by_affordance"
  ) {
    const affordance = String(args.affordance || "")
      .trim()
      .toLowerCase();
    const zoneFilter = args.room_zone
      ? String(args.room_zone).trim().toLowerCase()
      : null;
    const matches = [];
    for (const loc of activeObjects.values()) {
      if (zoneFilter && loc.room_zone.toLowerCase() !== zoneFilter) {
        continue;
      }
      const tagMatch = (loc.tags || []).some(
        (t) => t.toLowerCase().includes(affordance)
      );
      const nameMatch = loc.object_name.toLowerCase().includes(affordance);
      if (tagMatch || nameMatch) {
        matches.push(loc);
      }
    }
    return {
      affordance: args.affordance || "",
      total_matches: matches.length,
      objects: matches,
    };
  }

  throw new Error(`Unknown robotics tool: ${name}`);
}

function runMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  const send = (msg) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  rl.on("line", async (line) => {
    if (!line || !line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch (_) {
      return;
    }

    const { id, method, params } = req;
    if (
      id === undefined ||
      id === null ||
      method === "notifications/initialized" ||
      (typeof method === "string" && method.startsWith("notifications/"))
    ) {
      return;
    }

    try {
      if (method === "ping") {
        send({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (method === "initialize") {
        const protocolVersion =
          (params && params.protocolVersion) || "2024-11-05";
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: {
              name: "slashml-robotics",
              version: VERSION,
            },
          },
        });
        return;
      }
      if (method === "resources/list") {
        send({ jsonrpc: "2.0", id, result: { resources: [] } });
        return;
      }
      if (method === "prompts/list") {
        send({ jsonrpc: "2.0", id, result: { prompts: [] } });
        return;
      }
      if (method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: ROBOTICS_TOOLS } });
        return;
      }
      if (method === "tools/call") {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        try {
          const result = await executeRoboticsTool(name, args);
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          });
        } catch (toolErr) {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error:
                      toolErr && toolErr.message
                        ? toolErr.message
                        : String(toolErr),
                  }),
                },
              ],
            },
          });
        }
        return;
      }

      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err && err.message ? err.message : String(err),
        },
      });
    }
  });
}

runMcpServer();
