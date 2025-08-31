// server.js 
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// HTTP server
const server = http.createServer(app);

// WebSocket server
const io = new Server(server, {
  cors: {
    origin: "*", // change to your SaaS domain later
    methods: ["GET", "POST"],
  },
});

// Store connected agents and active user sessions
// agents[branchId][agentId] = { socketId, printerName, jobs: 0 }
let agents = {};

// userSessions[userId] = { branchId, agentId }
let userSessions = {};

// round-robin tracker per branch
let branchRoundRobin = {};

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Agent registers itself
  socket.on("register_agent", ({ agentId, branchId, printerName }) => {
    if (!agents[branchId]) agents[branchId] = {};
    agents[branchId][agentId] = {
      socketId: socket.id,
      printerName,
      jobs: 0,
    };

    console.log(
      `✅ Agent registered: Branch ${branchId} - ${agentId}, printer: ${printerName}`
    );
  });

  // Website binds logged-in user to agent
  socket.on("bind_user", ({ userId, branchId, agentId }) => {
    userSessions[userId] = { branchId, agentId };
    console.log(`👤 User ${userId} bound to agent ${agentId} in branch ${branchId}`);
  });
// Handle branch updates
socket.on("update_branch", ({ agentId, branchId }) => {
  // remove from old branch
  for (const [oldBranchId, branchAgents] of Object.entries(agents)) {
    if (branchAgents[agentId]) {
      const printerName = branchAgents[agentId].printerName;
      delete branchAgents[agentId];
      console.log(`🔄 Agent ${agentId} moved from branch ${oldBranchId} to ${branchId}`);

      // re-add under new branch with same printer
      if (!agents[branchId]) agents[branchId] = {};
      agents[branchId][agentId] = { socketId: socket.id, printerName };

      return;
    }
  }

  // if agent wasn't registered yet, just add it fresh
  if (!agents[branchId]) agents[branchId] = {};
  agents[branchId][agentId] = { socketId: socket.id, printerName: "Unknown" };

  console.log(`✅ Agent ${agentId} registered under branch ${branchId}`);
});

  // Website sends a print job (via WebSocket)
  socket.on("print_job", ({ userId, payload }) => {
    const session = userSessions[userId];
    if (!session) {
      console.log(`⚠️ No session found for user ${userId}`);
      socket.emit("print_error", { reason: "No session bound to user" });
      return;
    }

    const { branchId, agentId } = session;
    const agent = agents[branchId]?.[agentId];

    if (agent) {
      agent.jobs++;
      io.to(agent.socketId).emit("execute_print", {
        userId,
        payload,
      });
      console.log(`🖨 Print job sent to Branch ${branchId} - ${agentId}:`, payload);
    } else {
      console.log(`⚠️ No agent found for user ${userId} in branch ${branchId}`);
      socket.emit("print_error", { reason: "No agent available" });
    }
  });

  // Agent confirms job status
  socket.on("print_done", ({ userId }) => {
    console.log(`✅ Print done for user ${userId}`);
    const session = userSessions[userId];
    if (session) {
      const agent = agents[session.branchId]?.[session.agentId];
      if (agent) agent.jobs = Math.max(0, agent.jobs - 1);
    }
    io.to(socket.id).emit("acknowledge", { status: "done", userId });
  });

  socket.on("print_error", ({ userId, error }) => {
    console.log(`❌ Print error for user ${userId}: ${error}`);
    const session = userSessions[userId];
    if (session) {
      const agent = agents[session.branchId]?.[session.agentId];
      if (agent) agent.jobs = Math.max(0, agent.jobs - 1);
    }
    io.to(socket.id).emit("acknowledge", { status: "error", userId, error });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("🔌 Socket disconnected:", socket.id);

    for (const [branchId, branchAgents] of Object.entries(agents)) {
      for (const [agentId, info] of Object.entries(branchAgents)) {
        if (info.socketId === socket.id) {
          console.log(`⚠️ Agent disconnected: Branch ${branchId} - ${agentId}`);
          delete agents[branchId][agentId];
        }
      }
    }
  });
});

// API to check available agents & printers
app.get("/agents", (req, res) => {
  res.json(agents);
});

// Laravel will hit this endpoint
app.post("/print", (req, res) => {
  const { branch_id, content, user_id } = req.body;

  const branchAgents = agents[branch_id];
  if (!branchAgents || Object.keys(branchAgents).length === 0) {
    return res.status(404).json({ error: "No agents available for this branch" });
  }

  // Implement round-robin selection
  const agentIds = Object.keys(branchAgents);
  if (!branchRoundRobin[branch_id]) branchRoundRobin[branch_id] = 0;

  const agentId = agentIds[branchRoundRobin[branch_id] % agentIds.length];
  branchRoundRobin[branch_id]++;

  const agent = branchAgents[agentId];
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  // Increment job count
  agent.jobs++;

  // Send print job
  io.to(agent.socketId).emit("execute_print", { content, userId: user_id });
  console.log(`🖨 Print job sent (API) to Branch ${branch_id} - ${agentId}:`, content);

  res.json({ status: "queued", agentId });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Central Print Server running on port ${PORT}`);
});
