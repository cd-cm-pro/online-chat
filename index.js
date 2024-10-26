const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('set nickname', (nickname) => {
    users.set(socket.id, { nickname, isAdmin: false });
    socket.emit('update rooms', Array.from(rooms.entries()).map(([name, room]) => ({
      name,
      hasPassword: !!room.password,
      currentUsers: room.users.size,
      maxUsers: room.maxUsers
    })));
  });

  socket.on('create room', ({ roomName, password, maxUsers }) => {
    if (!rooms.has(roomName)) {
      rooms.set(roomName, {
        users: new Set(),
        password: password || null,
        maxUsers: maxUsers || Infinity,
        admin: socket.id
      });
      io.emit('update rooms', Array.from(rooms.entries()).map(([name, room]) => ({
        name,
        hasPassword: !!room.password,
        currentUsers: room.users.size,
        maxUsers: room.maxUsers
      })));
    }
    joinRoom(socket, roomName, password);
  });

  socket.on('join room', ({ roomName, password }) => {
    if (rooms.has(roomName)) {
      joinRoom(socket, roomName, password);
    } else {
      socket.emit('room not found');
    }
  });

  socket.on('chat message', (data) => {
    if (rooms.has(data.room) && rooms.get(data.room).users.has(socket.id)) {
      io.to(data.room).emit('chat message', {
        nickname: users.get(socket.id).nickname,
        msg: data.msg,
        isAdmin: socket.id === rooms.get(data.room).admin
      });
    }
  });

  socket.on('kick user', ({ roomName, userId }) => {
    const room = rooms.get(roomName);
    if (room && socket.id === room.admin) {
      const userSocket = io.sockets.sockets.get(userId);
      const user = users.get(userId);
      if (userSocket && user) {
        room.users.delete(userId);
        userSocket.leave(roomName);
        userSocket.emit('kicked', roomName);
        io.to(roomName).emit('user left', user.nickname);
        updateRoomList();
      }
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const userNickname = user.nickname;
      rooms.forEach((room, roomName) => {
        if (room.users.has(socket.id)) {
          room.users.delete(socket.id);
          io.to(roomName).emit('user left', userNickname);
          if (room.users.size === 0) {
            rooms.delete(roomName);
          } else if (socket.id === room.admin) {
            room.admin = Array.from(room.users)[0];
            io.to(roomName).emit('new admin', users.get(room.admin).nickname);
          }
          updateRoomList();
        }
      });
      users.delete(socket.id);
    }
    console.log('A user disconnected');
  });

  socket.on('get users', (roomName) => {
    const room = rooms.get(roomName);
    if (room) {
      const userList = Array.from(room.users).map(userId => ({
        id: userId,
        nickname: users.get(userId).nickname,
        isAdmin: userId === room.admin
      }));
      socket.emit('user list', userList);
    }
  });
});

function joinRoom(socket, roomName, password) {
  const room = rooms.get(roomName);
  if (room.password && room.password !== password) {
    socket.emit('wrong password');
    return;
  }
  if (room.users.size >= room.maxUsers) {
    socket.emit('room full');
    return;
  }

  // Leave current room if any
  Array.from(socket.rooms).forEach(room => {
    if (rooms.has(room)) {
      rooms.get(room).users.delete(socket.id);
      updateRoomList();
    }
  });

  socket.join(roomName);
  room.users.add(socket.id);
  
  // Check if this user is the admin (first user in the room)
  const isAdmin = socket.id === room.admin;
  
  socket.emit('room joined', {
    roomName: roomName,
    isAdmin: isAdmin
  });
  
  io.to(roomName).emit('user joined', users.get(socket.id).nickname);
  updateRoomList();

  // If this is the first user, make them the admin
  if (room.users.size === 1) {
    room.admin = socket.id;
    socket.emit('new admin', users.get(socket.id).nickname);
  }
}

function updateRoomList() {
  io.emit('update rooms', Array.from(rooms.entries()).map(([name, room]) => ({
    name,
    hasPassword: !!room.password,
    currentUsers: room.users.size,
    maxUsers: room.maxUsers
  })));
}

const PORT = process.env.PORT || 5500;
http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});