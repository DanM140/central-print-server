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
    origin: "*", // later restrict to your SaaS domain
    methods: ["GET", "POST"]
  }
});

// Store connected printers
let printers = {};

// When a POS agent (local computer) connects
io.on("connection", (socket) => {
  console.log("New agent connected:", socket.id);

  // Agent registers printer
  socket.on("register_printer", (printerName) => {
    printers[socket.id] = printerName;
    console.log(`Printer registered: ${printerName} (${socket.id})`);
  });

  // Receive print job from SaaS
  socket.on("print_job", (data) => {
    console.log("Print job received:", data);
    // Forward to the agent
    socket.to(socket.id).emit("execute_print", data);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Agent disconnected:", printers[socket.id]);
    delete printers[socket.id];
  });
});

// API to check available printers
app.get("/printers", (req, res) => {
  res.json(Object.values(printers));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Central Print Server running on port ${PORT}`);
});
