const express = require("express");
const path = require("node:path");
// Node.js nạp cấu hình .env nếu có; biến môi trường đã đặt được giữ nguyên.
const envFile = path.join(__dirname, ".env");
if (require("node:fs").existsSync(envFile)) process.loadEnvFile(envFile);
const { createServer } = require("node:http");
const session = require("express-session");
const bcrypt = require("bcrypt");
const connectDB = require("./config/db");
const User = require("./models/User");
const { attachChat } = require("./controllers/chatSocket");
const { syncClasses } = require("./services/classService");

// Tạo ứng dụng Express và gắn Socket.IO vào cùng máy chủ HTTP.
function createApp() {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(require("./routes/assetsRoutes"));
  // Session lưu thông tin đăng nhập để các yêu cầu HTTP và Socket.IO dùng chung.
  const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "webchat-development-secret",
    resave: false,
    saveUninitialized: false,
  });
  app.use(sessionMiddleware);
  app.use((req, res, next) => {
    req.session.logoutCsrfToken ||= require("node:crypto")
      .randomBytes(32)
      .toString("hex");
    next();
  });
  // Truyền dữ liệu chung cho EJS; thông báo chỉ hiển thị một lần sau thao tác.
  app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.logoutToken = req.session.logoutCsrfToken;
    res.locals.notice = req.session.notice || null;
    res.locals.error = req.session.error || null;
    if (req.method === "GET") {
      delete req.session.notice;
      delete req.session.error;
    }
    next();
  });
  const server = createServer(app);
  const io = attachChat(server, sessionMiddleware, app);
  app.use(require("./routes/authRoutes"));
  app.use("/admin", require("./routes/adminRoutes"));
  app.use(require("./routes/userRoutes"));
  // Các route không khớp trả về trang 404; middleware tiếp theo xử lý lỗi phát sinh.
  app.use((req, res) =>
    res.status(404).render("error", {
      title: "Không tìm thấy trang",
      message: "Đường dẫn không tồn tại.",
    }),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (!error.status) console.error(error);
    res.status(error.status || 500).render("error", {
      title: "Không thể xử lý yêu cầu",
      message: error.status ? error.message : "Hãy thử lại sau.",
    });
  });
  return { app, server, io };
}
// Kết nối DB, tạo admin nếu chưa có và đồng bộ kênh trước khi mở cổng.
async function start() {
  await connectDB();
  const username = process.env.ADMIN_USERNAME || "admin";
  if (!(await User.exists({ username }))) {
    await User.create({
      username,
      displayName: "Quản trị viên",
      role: "admin",
      hashedPassword: await bcrypt.hash(
        process.env.ADMIN_PASSWORD || "admin123",
        10,
      ),
    });
  }
  await syncClasses();
  const { server } = createApp();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log("WebChat: http://localhost:" + port));
}
// Import createApp trong kiểm thử không khởi động ứng dụng hoặc sửa DB đang sử dụng.
if (require.main === module)
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { createApp, start };
