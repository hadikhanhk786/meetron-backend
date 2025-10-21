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
    const isHost = room.size === 0;
    
    room.set(socket.id, {
      socketId: socket.id,
      userName: userName || `User ${room.size + 1}`,
      isScreenSharing: false,
      isMuted: false,
      isHost: isHost
    });
    
    console.log(`📞 ${userName} joined room ${roomId} as ${isHost ? 'HOST' : 'PARTICIPANT'}. Total: ${room.size}`);
    
    // Send existing users with their CURRENT state to the new user
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
    socket.emit("host-status", { isHost });
    
    // Notify existing users about the new user
    socket.to(roomId).emit("user-joined", {
      userId: socket.id,
      userName: room.get(socket.id).userName,
      isHost: room.get(socket.id).isHost,
      isMuted: false,
      isScreenSharing: false
    });

    // Send current room state summary to new user
    const roomState = {
      totalUsers: room.size,
      screenSharingUser: null,
      mutedUsers: []
    };

    room.forEach((userData, userId) => {
      if (userData.isScreenSharing) {
        roomState.screenSharingUser = {
          userId: userId,
          userName: userData.userName
        };
      }
      if (userData.isMuted && userId !== socket.id) {
        roomState.mutedUsers.push({
          userId: userId,
          userName: userData.userName
        });
      }
    });

    socket.emit("room-state", roomState);
    console.log(`📊 Room state sent to ${userName}:`, roomState);
  });

  socket.on("signal", ({ roomId, signal, to }) => {
    io.to(to).emit("signal", { signal, from: socket.id });
  });

  socket.on("key-exchange", ({ roomId, publicKey, to }) => {
    io.to(to).emit("key-exchange", { publicKey, from: socket.id });
  });

  socket.on("screen-share-status", ({ roomId, isSharing }) => {
    console.log(`📺 Screen share status update: ${socket.id} - ${isSharing}`);
    
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const userData = room.get(socket.id);
        userData.isScreenSharing = isSharing;
        
        // Broadcast to ALL users in the room (including sender for confirmation)
        io.to(rid).emit("peer-screen-share-status", {
          userId: socket.id,
          userName: userData.userName,
          isSharing
        });
        
        console.log(`✅ Screen share status broadcasted to room ${rid}`);
      }
    });
  });

  socket.on("mute-status", ({ roomId, isMuted }) => {
    console.log(`🔇 Mute status update: ${socket.id} - ${isMuted}`);
    
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const userData = room.get(socket.id);
        userData.isMuted = isMuted;
        
        // Broadcast to ALL users in the room
        io.to(rid).emit("peer-mute-status", {
          userId: socket.id,
          userName: userData.userName,
          isMuted
        });
        
        console.log(`✅ Mute status broadcasted to room ${rid}`);
      }
    });
  });

  socket.on("kick-user", ({ roomId, userIdToKick }) => {
    console.log(`🚫 Kick request: ${socket.id} wants to kick ${userIdToKick}`);
    
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const requester = room.get(socket.id);
        
        if (requester.isHost) {
          io.to(userIdToKick).emit("kicked-from-room", {
            reason: "You have been removed from the call by the host"
          });
          console.log(`✅ ${userIdToKick} kicked by host`);
        } else {
          socket.emit("kick-denied", { reason: "Only host can remove participants" });
          console.log(`❌ Kick denied: not host`);
        }
      }
    });
  });

  socket.on("request-peer-state", ({ peerId }) => {
    console.log(`📡 State request for peer: ${peerId}`);
    
    rooms.forEach((room) => {
      if (room.has(peerId)) {
        const peerData = room.get(peerId);
        socket.emit("peer-state-response", {
          userId: peerId,
          userName: peerData.userName,
          isMuted: peerData.isMuted,
          isScreenSharing: peerData.isScreenSharing,
          isHost: peerData.isHost
        });
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
        socket.to(roomId).emit("user-left", socket.id);
        
        console.log(`${userName} left room ${roomId}. Remaining: ${room.size}`);
        
        if (wasHost && room.size > 0) {
          const newHostId = Array.from(room.keys())[0];
          const newHost = room.get(newHostId);
          newHost.isHost = true;
          
          io.to(newHostId).emit("host-status", { isHost: true });
          io.to(roomId).emit("new-host", { 
            userId: newHostId, 
            userName: newHost.userName 
          });
          
          console.log(`👑 New host: ${newHost.userName}`);
        }
        
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
  console.log(`📡 Room state persistence enabled`);
});
