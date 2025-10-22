const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const P2P_MAX_USERS = 8;
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  socket.on("join-room", ({ roomId, userName }) => {
    console.log(`📥 Join request: ${userName} → ${roomId}`);

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);
    const isHost = room.size === 0;

    // Add user to room
    room.set(socket.id, {
      socketId: socket.id,
      userName: userName || `User ${room.size + 1}`,
      isScreenSharing: false,
      isMuted: false,
      isHost: isHost,
    });

    const mode = room.size <= P2P_MAX_USERS ? "p2p" : "sfu";

    console.log(
      `✅ ${userName} joined ${roomId} as ${
        isHost ? "HOST" : "MEMBER"
      } [${mode}] - Total: ${room.size}`
    );

    // 1. Send room state to NEW user
    socket.emit("room-state", {
      totalUsers: room.size,
      mode: mode,
    });

    // 2. Send host status to NEW user
    socket.emit("host-status", { isHost });

    // 3. Send list of existing users to NEW user
    const existingUsers = Array.from(room.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, data]) => ({
        userId: id,
        userName: data.userName,
        isScreenSharing: data.isScreenSharing,
        isMuted: data.isMuted,
        isHost: data.isHost,
      }));

    console.log(
      `📤 Sending ${existingUsers.length} existing users to ${userName}`
    );
    socket.emit("existing-users", existingUsers);

    // 4. Notify EXISTING users about NEW user (CRITICAL - DON'T SEND TO NEW USER)
    if (existingUsers.length > 0) {
      console.log(
        `📤 Broadcasting new user ${userName} to ${existingUsers.length} existing users`
      );
      socket.to(roomId).emit("user-joined", {
        userId: socket.id,
        userName: room.get(socket.id).userName,
        isHost: room.get(socket.id).isHost,
      });
    }

    // 5. Broadcast participant count to ALL users
    io.to(roomId).emit("participant-count-changed", room.size);
  });

  socket.on("signal", ({ roomId, signal, to }) => {
    console.log(`📡 Signal relay: ${socket.id} → ${to}`);
    io.to(to).emit("signal", { signal, from: socket.id });
  });

  socket.on("screen-share-status", ({ roomId, isSharing }) => {
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const userData = room.get(socket.id);
        userData.isScreenSharing = isSharing;

        // Broadcast to EVERYONE in the room (sender included)
        io.to(rid).emit("peer-screen-share-status", {
          userId: socket.id,
          userName: userData.userName,
          isSharing,
        });

        // Optional nudge so UIs rebind srcObject if needed
        io.to(rid).emit("peer-stream-refresh", { userId: socket.id });
      }
    });
  });

  socket.on("mute-status", ({ roomId, isMuted }) => {
    rooms.forEach((room, rid) => {
      if (room.has(socket.id)) {
        const userData = room.get(socket.id);
        userData.isMuted = isMuted;

        io.to(rid).emit("peer-mute-status", {
          userId: socket.id,
          userName: userData.userName,
          isMuted,
        });
      }
    });
  });

  socket.on("kick-user", ({ roomId, userIdToKick }) => {
    rooms.forEach((room) => {
      if (room.has(socket.id)) {
        const requester = room.get(socket.id);

        if (requester.isHost) {
          io.to(userIdToKick).emit("kicked-from-room", {
            reason: "You have been removed by the host",
          });
        } else {
          socket.emit("kick-denied", { reason: "Only host can remove users" });
        }
      }
    });
  });

  socket.on("request-peer-state", ({ peerId }) => {
    rooms.forEach((room) => {
      if (room.has(peerId)) {
        const peerData = room.get(peerId);
        socket.emit("peer-state-response", {
          userId: peerId,
          userName: peerData.userName,
          isMuted: peerData.isMuted,
          isScreenSharing: peerData.isScreenSharing,
          isHost: peerData.isHost,
        });
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);

    rooms.forEach((room, roomId) => {
      if (room.has(socket.id)) {
        const userName = room.get(socket.id).userName;
        const wasHost = room.get(socket.id).isHost;

        room.delete(socket.id);

        console.log(`👋 ${userName} left ${roomId}. Remaining: ${room.size}`);

        // Notify others
        socket.to(roomId).emit("user-left", socket.id);

        if (room.size > 0) {
          io.to(roomId).emit("participant-count-changed", room.size);

          // Assign new host if needed
          if (wasHost) {
            const newHostId = Array.from(room.keys())[0];
            const newHost = room.get(newHostId);
            newHost.isHost = true;

            io.to(newHostId).emit("host-status", { isHost: true });
            io.to(roomId).emit("new-host", {
              userId: newHostId,
              userName: newHost.userName,
            });

            console.log(`👑 New host: ${newHost.userName}`);
          }
        } else {
          rooms.delete(roomId);
          console.log(`🗑️ Room ${roomId} deleted (empty)`);
        }
      }
    });
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    rooms: rooms.size,
    connections: io.engine.clientsCount,
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
  console.log(`📡 P2P: 1-${P2P_MAX_USERS} | SFU: ${P2P_MAX_USERS + 1}+`);
});
