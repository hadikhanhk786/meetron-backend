const { P2P_MAX_USERS } = require('../config/constants');

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        mode: 'p2p',
        users: new Map(),
        created: Date.now()
      });
    }
    return this.rooms.get(roomId);
  }

  addUser(roomId, socketId, userData) {
    const room = this.createRoom(roomId);
    room.users.set(socketId, userData);
    
    // Determine mode
    const newMode = room.users.size <= P2P_MAX_USERS ? 'p2p' : 'sfu';
    const modeChanged = room.mode !== newMode;
    room.mode = newMode;
    
    return { room, modeChanged, newMode };
  }

  removeUser(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    room.users.delete(socketId);
    
    // Delete empty rooms
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
      return null;
    }
    
    // Check if mode should change
    const newMode = room.users.size <= P2P_MAX_USERS ? 'p2p' : 'sfu';
    const modeChanged = room.mode !== newMode;
    room.mode = newMode;
    
    return { room, modeChanged, newMode };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getUserCount(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.users.size : 0;
  }

  getMode(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.mode : 'p2p';
  }
}

module.exports = new RoomManager();
