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
// So sánh mã bảo vệ kết nối với mã trong session bằng timingSafeEqual.
function validToken(supplied, expected) {
  return (
    typeof supplied === "string" &&
    typeof expected === "string" &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}
// Khởi tạo máy chủ realtime và đăng ký các sự kiện của chức năng chat.
function attachChat(server, sessionMiddleware, app) {
  const io = new Server(server, { maxHttpBufferSize: 20000 });
  // Dùng chung cookie/session Express; không tin userId hay senderId từ trình duyệt.
  io.engine.use(sessionMiddleware);
  // Nạp lại session và kiểm tra tài khoản ở mỗi lần xử lý để không tin phiên cũ.
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
  // Kiểm tra lại từng người nhận để session cũ/thành viên vừa bị gỡ không nhận tin mới.
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
    // Xử lý tuần tự sự kiện của một kết nối; ack trả kết quả cho đúng yêu cầu Client.
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
    // Vào nhóm kết nối của kênh để nhận cập nhật và đồng bộ lịch sử ban đầu.
    handle("channel:join", async (payload) => {
      await authorized(socket, payload.channelId);
      for (const room of socket.rooms) if (room.startsWith("channel:")) socket.leave(room);
      socket.data.channelId = payload.channelId;
      await socket.join("channel:" + payload.channelId);
      // Vào room trước khi đọc lịch sử để không hụt tin ở khoảng chuyển tiếp; client loại trùng theo ID.
      const messages = await latestMessages(payload.channelId);
      const { writable } = await authorized(socket, payload.channelId);
      return { ...messages, writable };
    });
    // Dùng mốc before để tải đợt lịch sử cũ hơn; kiểm tra lại quyền trước khi trả dữ liệu.
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
      // Cùng session/người gửi/kênh/requestId tạo cùng id, hạn chế lưu trùng khi gửi lại.
      const messageId = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([socket.request.sessionID, userId, payload.channelId, payload.requestId]),
        )
        .digest("hex")
        .slice(0, 24);
      const message = await saveMessage(payload.channelId, userId, payload.content, messageId);
      // Đã lưu là thành công; lỗi phát tin sẽ được bù bằng lịch sử khi kết nối lại.
      await publish(message).catch((error) => console.error("Chat publish:", error.message));
      return { message };
    });

    // Xóa tin thuộc người gửi rồi phát sự kiện để các Client bỏ tin khỏi giao diện.
    handle("message:delete", async (payload) => {
      const userId = await authenticate(socket);
      const message = await deleteMessage(payload.channelId, userId, payload.messageId);
      await publish(message, "message:deleted").catch((error) =>
        console.error("Chat publish:", error.message),
      );
      return { message };
    });
  });
  // Admin đổi lớp/giảng viên, khóa tài khoản hoặc đóng kênh: cập nhật ngay tab đang mở.
  let accessRevision = 0;
  // Bỏ qua kết quả kiểm tra cũ nếu đã có đợt thay đổi quyền mới hơn.
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
