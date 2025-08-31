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

// agents[businessId][branchId][agentId] = { socketId, printerName, jobs: 0 }
let agents = {};
let userSessions = {};
let branchRoundRobin = {};

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Agent registers itself
  socket.on("register_agent", ({ agentId, businessId, branchId, printerName }) => {
    if (!businessId || !branchId) {
      console.log("⚠️ Agent missing businessId or branchId");
      return;
    }

    if (!agents[businessId]) agents[businessId] = {};
    if (!agents[businessId][branchId]) agents[businessId][branchId] = {};

    agents[businessId][branchId][agentId] = {
      socketId: socket.id,
      printerName,
      jobs: 0,
    };

    console.log(
      `✅ Agent registered: Business ${businessId} / Branch ${branchId} - ${agentId}, printer: ${printerName}`
    );
  });

  // Website binds logged-in user to agent
  socket.on("bind_user", ({ userId, businessId, branchId, agentId }) => {
    userSessions[userId] = { businessId, branchId, agentId };
    console.log(`👤 User ${userId} bound to agent ${agentId} in business ${businessId}, branch ${branchId}`);
  });

  // Handle business + branch updates
  socket.on("update_ids", ({ agentId, businessId, branchId }) => {
    if (!businessId || !branchId) return;

    // Remove from any old business/branch
    for (const [oldBizId, bizBranches] of Object.entries(agents)) {
      for (const [oldBranchId, branchAgents] of Object.entries(bizBranches)) {
        if (branchAgents[agentId]) {
          const printerName = branchAgents[agentId].printerName;
          delete branchAgents[agentId];
          console.log(`🔄 Agent ${agentId} moved from ${oldBizId}/${oldBranchId} to ${businessId}/${branchId}`);

          if (!agents[businessId]) agents[businessId] = {};
          if (!agents[businessId][branchId]) agents[businessId][branchId] = {};
          agents[businessId][branchId][agentId] = { socketId: socket.id, printerName };
          return;
        }
      }
    }

    // If not registered, just add fresh
    if (!agents[businessId]) agents[businessId] = {};
    if (!agents[businessId][branchId]) agents[businessId][branchId] = {};
    agents[businessId][branchId][agentId] = { socketId: socket.id, printerName: "Unknown" };

    console.log(`✅ Agent ${agentId} registered under ${businessId}/${branchId}`);
  });

  // Website sends a print job
  socket.on("print_job", ({ userId, payload }) => {
    const session = userSessions[userId];
    if (!session) {
      console.log(`⚠️ No session found for user ${userId}`);
      socket.emit("print_error", { reason: "No session bound to user" });
      return;
    }

    const { businessId, branchId, agentId } = session;
    const agent = agents[businessId]?.[branchId]?.[agentId];

    if (agent) {
      agent.jobs++;
      io.to(agent.socketId).emit("execute_print", { userId, payload });
      console.log(`🖨 Print job sent to ${businessId}/${branchId}/${agentId}:`, payload);
    } else {
      console.log(`⚠️ No agent found for user ${userId} in ${businessId}/${branchId}`);
      socket.emit("print_error", { reason: "No agent available" });
    }
  });

  // Job done
  socket.on("print_done", ({ userId }) => {
    console.log(`✅ Print done for user ${userId}`);
    const session = userSessions[userId];
    if (session) {
      const agent = agents[session.businessId]?.[session.branchId]?.[session.agentId];
      if (agent) agent.jobs = Math.max(0, agent.jobs - 1);
    }
    io.to(socket.id).emit("acknowledge", { status: "done", userId });
  });

  socket.on("print_error", ({ userId, error }) => {
    console.log(`❌ Print error for user ${userId}: ${error}`);
    const session = userSessions[userId];
    if (session) {
      const agent = agents[session.businessId]?.[session.branchId]?.[session.agentId];
      if (agent) agent.jobs = Math.max(0, agent.jobs - 1);
    }
    io.to(socket.id).emit("acknowledge", { status: "error", userId, error });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("🔌 Socket disconnected:", socket.id);

    for (const [bizId, bizBranches] of Object.entries(agents)) {
      for (const [branchId, branchAgents] of Object.entries(bizBranches)) {
        for (const [agentId, info] of Object.entries(branchAgents)) {
          if (info.socketId === socket.id) {
            console.log(`⚠️ Agent disconnected: ${bizId}/${branchId}/${agentId}`);
            delete agents[bizId][branchId][agentId];
          }
        }
      }
    }
  });
});

// API to check agents
app.get("/agents", (req, res) => {
  res.json(agents);
});

// Laravel will hit this endpoint
app.post("/print", (req, res) => {
  const { business_id, branch_id, content, user_id } = req.body;

  const branchAgents = agents[business_id]?.[branch_id];
  if (!branchAgents || Object.keys(branchAgents).length === 0) {
    return res.status(404).json({ error: "No agents available for this branch" });
  }

  const agentIds = Object.keys(branchAgents);
  const key = `${business_id}-${branch_id}`;
  if (!branchRoundRobin[key]) branchRoundRobin[key] = 0;

  const agentId = agentIds[branchRoundRobin[key] % agentIds.length];
  branchRoundRobin[key]++;

  const agent = branchAgents[agentId];
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  agent.jobs++;
  io.to(agent.socketId).emit("execute_print", { content, userId: user_id });
  console.log(`🖨 Print job sent (API) to ${business_id}/${branch_id}/${agentId}:`, content);

  res.json({ status: "queued", agentId });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Central Print Server running on port ${PORT}`);
});
