const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();

// Enable CORS for Express
app.use(cors({
  origin: "*",
  credentials: true
}));

const server = http.createServer(app);

// Enable CORS for Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    
    console.log(`📞 User ${socket.id} joined room ${roomId}`);
    
    const otherUsers = Array.from(rooms.get(roomId)).filter(id => id !== socket.id);
    if (otherUsers.length > 0) {
      socket.to(roomId).emit("user-joined", socket.id);
      console.log("🔗 Notifying other user");
    }
  });

  socket.on("signal", ({ roomId, signal, to }) => {
    io.to(to).emit("signal", { signal, from: socket.id });
    console.log("📡 Signal relayed from", socket.id, "to", to);
  });

  socket.on("key-exchange", ({ roomId, publicKey, to }) => {
    io.to(to).emit("key-exchange", { publicKey, from: socket.id });
    console.log("🔐 Key exchanged");
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        socket.to(roomId).emit("user-left", socket.id);
        if (users.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO is ready to accept connections`);
});
