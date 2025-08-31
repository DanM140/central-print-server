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
    origin: "*", // restrict later to your SaaS domain
    methods: ["GET", "POST"]
  }
});

// Store connected agents and active user sessions
// agents[branchId][agentId] = { socketId, printerName }
let agents = {};        

// userSessions[userId] = { branchId, agentId }
let userSessions = {};  

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Agent registers itself
  socket.on("register_agent", ({ agentId, branchId, printerName }) => {
    if (!agents[branchId]) agents[branchId] = {};
    agents[branchId][agentId] = { socketId: socket.id, printerName };

    console.log(
      `Agent registered: Branch ${branchId} - ${agentId}, printer: ${printerName}`
    );
  });

  // Website binds logged-in user to agent
  socket.on("bind_user", ({ userId, branchId, agentId }) => {
    userSessions[userId] = { branchId, agentId };
    console.log(`User ${userId} bound to agent ${agentId} in branch ${branchId}`);
  });

  // Website sends a print job
  socket.on("print_job", ({ userId, payload }) => {
    const session = userSessions[userId];
    if (!session) return console.log(`No session found for user ${userId}`);

    const { branchId, agentId } = session;
    const agent = agents[branchId]?.[agentId];

    if (agent) {
      io.to(agent.socketId).emit("execute_print", payload);
      console.log(`Print job sent to Branch ${branchId} - ${agentId}:`, payload);
    } else {
      console.log(`No agent found for user ${userId} in branch ${branchId}`);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);

    for (const [branchId, branchAgents] of Object.entries(agents)) {
      for (const [agentId, info] of Object.entries(branchAgents)) {
        if (info.socketId === socket.id) {
          console.log(`Agent disconnected: Branch ${branchId} - ${agentId}`);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Central Print Server running on port ${PORT}`);
});
