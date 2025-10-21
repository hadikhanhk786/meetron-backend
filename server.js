const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on("join-room", ({ roomId, userName }) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    
    const room = rooms.get(roomId);
    room.set(socket.id, {
      socketId: socket.id,
      userName: userName || `User ${room.size + 1}`,
      isScreenSharing: false
    });
    
    console.log(`📞 ${socket.id} joined room ${roomId}. Total users: ${room.size}`);
    
    // Send existing users to the new user
    const existingUsers = Array.from(room.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, data]) => ({ userId: id, userName: data.userName, isScreenSharing: data.isScreenSharing }));
    
    socket.emit("existing-users", existingUsers);
    
    // Notify all other users about the new user
    socket.to(roomId).emit("user-joined", {
      userId: socket.id,
      userName: room.get(socket.id).userName
    });
  });

  socket.on("signal", ({ roomId, signal, to }) => {
    io.to(to).emit("signal", { signal, from: socket.id });
  });

  socket.on("key-exchange", ({ roomId, publicKey, to }) => {
    io.to(to).emit("key-exchange", { publicKey, from: socket.id });
  });

  socket.on("screen-share-status", ({ roomId, isSharing }) => {
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const userData = room.get(socket.id);
        userData.isScreenSharing = isSharing;
        socket.to(rid).emit("peer-screen-share-status", {
          userId: socket.id,
          isSharing
        });
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    
    rooms.forEach((room, roomId) => {
      if (room.has(socket.id)) {
        room.delete(socket.id);
        
        // Notify other users in the room
        socket.to(roomId).emit("user-left", socket.id);
        
        console.log(`Room ${roomId} now has ${room.size} users`);
        
        // Clean up empty rooms
        if (room.size === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO is ready for multi-user connections`);
});
