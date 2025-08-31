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
let agents = {};        // agentId -> socket.id
let userSessions = {};  // userId -> agentId

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Agent registers itself
  socket.on("register_agent", ({ agentId, printerName }) => {
    agents[agentId] = { socketId: socket.id, printerName };
    console.log(`Agent registered: ${agentId}, printer: ${printerName}`);
  });

  // Website binds logged-in user to agent
  socket.on("bind_user", ({ userId, agentId }) => {
    userSessions[userId] = agentId;
    console.log(`User ${userId} bound to agent ${agentId}`);
  });

  // Website sends a print job
  socket.on("print_job", ({ userId, payload }) => {
    const agentId = userSessions[userId];
    const agent = agents[agentId];

    if (agent) {
      io.to(agent.socketId).emit("execute_print", payload);
      console.log(`Print job sent to ${agentId}:`, payload);
    } else {
      console.log(`No agent found for user ${userId}`);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    // Clean up agent records
    for (const [agentId, info] of Object.entries(agents)) {
      if (info.socketId === socket.id) {
        console.log(`Agent disconnected: ${agentId}`);
        delete agents[agentId];
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
