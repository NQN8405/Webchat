const { Server } = require("socket.io");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/User");
const {
  chatError,
  channelAccess,
  latestMessages,
  saveMessage,
  deleteMessage,
} = require("./chatMessages");
const { classEvents } = require("../services/classService");
function validToken(supplied, expected) {
  return (
    typeof supplied === "string" &&
    typeof expected === "string" &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}
function attachChat(server, sessionMiddleware, app) {
  const io = new Server(server, { maxHttpBufferSize: 20000 });
  io.engine.use(sessionMiddleware);
  async function authenticate(socket) {
    await new Promise((resolve, reject) => {
      if (!socket.request.session)
        return reject(chatError("UNAUTHORIZED", "Hãy đăng nhập lại.", 403));
      socket.request.session.reload((error) =>
        error ? reject(chatError("UNAUTHORIZED", "Phiên đăng nhập đã hết hạn.", 403)) : resolve(),
      );
    });
    const session = socket.request.session,
      id = session.user?.id;
    if (
      !id ||
      !mongoose.isValidObjectId(id) ||
      !validToken(socket.handshake.auth?.token, session.chatCsrfToken)
    )
      throw chatError("UNAUTHORIZED", "Phiên đăng nhập không hợp lệ. Hãy tải lại trang.", 403);
    const user = await User.findById(id).select("status role");
    if (!user || user.status !== "active" || !["student", "lecturer"].includes(user.role))
      throw chatError("UNAUTHORIZED", "Tài khoản không còn hoạt động.", 403);
    return id;
  }
  io.use(async (socket, next) => {
    try {
      await authenticate(socket);
      next();
    } catch (error) {
      const e = new Error(error.status ? error.message : "Không thể kết nối lúc này.");
      e.data = { code: error.status ? error.code : "SERVER_ERROR" };
      next(e);
    }
  });
  async function authorized(socket, channelId) {
    const userId = await authenticate(socket);
    return { userId, ...(await channelAccess(channelId, userId)) };
  }
  function report(socket, error) {
    const data = {
      ok: false,
      code: error.code || "SERVER_ERROR",
      message: error.status ? error.message : "Không thể xử lý lúc này. Hãy thử lại.",
    };
    if (!error.status) console.error("Chat socket:", error.message);
    if (error.code === "UNAUTHORIZED") {
      socket.emit("channel:unavailable", data);
      socket.disconnect(true);
    }
    return data;
  }
  async function publish(message, event = "message:new") {
    const recipients = await io.in("channel:" + message.channelId).fetchSockets();
    await Promise.all(
      recipients.map(async (socket) => {
        try {
          await authorized(socket, message.channelId);
          socket.emit(event, message);
        } catch (error) {
          socket.leave("channel:" + message.channelId);
          socket.emit("channel:unavailable", report(socket, error));
        }
      }),
    );
  }
  app.locals.publishChatMessage = publish;
  io.on("connection", (socket) => {
    let queue = Promise.resolve();
    const handle = (event, fn) =>
      socket.on(event, (payload, ack) => {
        if (typeof ack !== "function") return;
        queue = queue
          .catch(() => {})
          .then(async () => {
            try {
              ack({ ok: true, ...(await fn(payload || {})) });
            } catch (error) {
              ack(report(socket, error));
            }
          });
      });
    handle("channel:join", async (payload) => {
      await authorized(socket, payload.channelId);
      for (const room of socket.rooms) if (room.startsWith("channel:")) socket.leave(room);
      socket.data.channelId = payload.channelId;
      await socket.join("channel:" + payload.channelId);
      const messages = await latestMessages(payload.channelId);
      const { writable } = await authorized(socket, payload.channelId);
      return { ...messages, writable };
    });
    handle("message:history", async (payload) => {
      await authorized(socket, payload.channelId);
      if (!payload.before) throw chatError("INVALID_CURSOR", "Thiếu mốc tải tin nhắn.");
      const page = await latestMessages(payload.channelId, payload.before);
      await authorized(socket, payload.channelId);
      return page;
    });
    handle("message:send", async (payload) => {
      const userId = await authenticate(socket);
      if (typeof payload.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId))
        throw chatError("INVALID_REQUEST", "Mã yêu cầu gửi không hợp lệ.");
      const messageId = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([socket.request.sessionID, userId, payload.channelId, payload.requestId]),
        )
        .digest("hex")
        .slice(0, 24);
      const message = await saveMessage(payload.channelId, userId, payload.content, messageId);
      await publish(message).catch((error) => console.error("Chat publish:", error.message));
      return { message };
    });

    handle("message:delete", async (payload) => {
      const userId = await authenticate(socket);
      const message = await deleteMessage(payload.channelId, userId, payload.messageId);
      await publish(message, "message:deleted").catch((error) =>
        console.error("Chat publish:", error.message),
      );
      return { message };
    });
  });
  let accessRevision = 0;
  async function refreshAccess(revision) {
    await Promise.all(
      [...io.sockets.sockets.values()].map(async (socket) => {
        const channelId = socket.data.channelId;
        if (!channelId) return;
        try {
          const { writable } = await authorized(socket, channelId);
          if (revision === accessRevision) socket.emit("channel:state", { channelId, writable });
        } catch (error) {
          if (revision !== accessRevision) return;
          socket.leave("channel:" + channelId);
          socket.emit("channel:unavailable", report(socket, error));
        }
      }),
    );
  }
  const refresh = () => {
    accessRevision++;
    refreshAccess(accessRevision).catch((error) => console.error("Chat access:", error.message));
  };
  classEvents.on("changed", refresh);
  server.once("close", () => classEvents.off("changed", refresh));
  return io;
}
module.exports = { attachChat };
