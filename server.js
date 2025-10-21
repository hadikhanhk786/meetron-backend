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
    const isHost = room.size === 0; // First user is the host
    
    room.set(socket.id, {
      socketId: socket.id,
      userName: userName || `User ${room.size + 1}`,
      isScreenSharing: false,
      isMuted: false,
      isHost: isHost
    });
    
    console.log(`📞 ${userName || socket.id} joined room ${roomId} as ${isHost ? 'HOST' : 'PARTICIPANT'}. Total users: ${room.size}`);
    
    // Send existing users to the new user
    const existingUsers = Array.from(room.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, data]) => ({ 
        userId: id, 
        userName: data.userName, 
        isScreenSharing: data.isScreenSharing,
        isMuted: data.isMuted,
        isHost: data.isHost
      }));
    
    socket.emit("existing-users", existingUsers);
    socket.emit("host-status", { isHost }); // Tell user if they're host
    
    // Notify all other users about the new user
    socket.to(roomId).emit("user-joined", {
      userId: socket.id,
      userName: room.get(socket.id).userName,
      isHost: room.get(socket.id).isHost
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

  socket.on("mute-status", ({ roomId, isMuted }) => {
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const userData = room.get(socket.id);
        userData.isMuted = isMuted;
        socket.to(rid).emit("peer-mute-status", {
          userId: socket.id,
          isMuted
        });
        console.log(`🔇 ${socket.id} mute status:`, isMuted);
      }
    });
  });

  // New: Kick user functionality
  socket.on("kick-user", ({ roomId, userIdToKick }) => {
    console.log(`🚫 Kick request from ${socket.id} to kick ${userIdToKick}`);
    
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const requester = room.get(socket.id);
        
        // Only host can kick users
        if (requester.isHost) {
          io.to(userIdToKick).emit("kicked-from-room", {
            reason: "You have been removed from the call by the host"
          });
          console.log(`✅ ${userIdToKick} kicked by host ${socket.id}`);
        } else {
          socket.emit("kick-denied", { reason: "Only host can remove participants" });
          console.log(`❌ Kick denied: ${socket.id} is not host`);
        }
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    
    rooms.forEach((room, roomId) => {
      if (room.has(socket.id)) {
        const userName = room.get(socket.id).userName;
        const wasHost = room.get(socket.id).isHost;
        
        room.delete(socket.id);
        
        // Notify other users in the room
        socket.to(roomId).emit("user-left", socket.id);
        
        console.log(`${userName} left room ${roomId}. Remaining users: ${room.size}`);
        
        // If host left and there are still users, assign new host
        if (wasHost && room.size > 0) {
          const newHostId = Array.from(room.keys())[0];
          const newHost = room.get(newHostId);
          newHost.isHost = true;
          
          io.to(newHostId).emit("host-status", { isHost: true });
          io.to(roomId).emit("new-host", { userId: newHostId, userName: newHost.userName });
          
          console.log(`👑 New host assigned: ${newHost.userName}`);
        }
        
        // Clean up empty rooms
        if (room.size === 0) {
          rooms.delete(roomId);
          console.log(`🗑️ Room ${roomId} deleted (empty)`);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready for mesh connections (up to 10 users)`);
});
