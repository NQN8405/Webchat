const express = require("express");
const path = require("node:path");
const envFile = path.join(__dirname, ".env");
if (require("node:fs").existsSync(envFile)) process.loadEnvFile(envFile);
const { createServer } = require("node:http");
const session = require("express-session");
const bcrypt = require("bcrypt");
const connectDB = require("./config/db");
const User = require("./models/User");
const { syncClasses } = require("./services/classService");

function createApp() {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(require("./routes/assetsRoutes"));
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
  const io = null;
  app.use(require("./routes/authRoutes"));
  app.get("/admin/users", require("./middleware/authMiddleware").requireAdmin, (req,res) => res.send("WebChat Admin"));
  app.get("/", require("./middleware/authMiddleware").requireAuth, (req,res) => res.send("WebChat"));
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
if (require.main === module)
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { createApp, start };
