const crypto = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  const id = req.session?.user?.id;
  if (!id || !mongoose.isValidObjectId(id)) return res.redirect("/login");
  const user = await User.findById(id).select("username displayName role status avatarUrl");
  if (!user || user.status !== "active") return req.session.destroy(() => res.redirect("/login"));
  req.session.user = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    avatarUrl: user.avatarUrl || "",
  };
  res.locals.user = req.session.user;
  next();
}
function csrf(key) {
  return (req, res, next) => {
    req.session[key] ||= crypto.randomBytes(32).toString("hex");
    res.locals.csrfToken = req.session[key];
    if (req.method === "POST") {
      const supplied = req.body?._csrf;
      const expected = req.session[key];
      if (
        typeof supplied !== "string" ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      ) {
        return res.status(403).render("error", {
          title: "Phiên biểu mẫu hết hạn",
          message: "Hãy tải lại trang và thử lại.",
        });
      }
    }
    next();
  };
}
const requireAdmin = [
  requireAuth,
  (req, res, next) => {
    if (req.session.user.role !== "admin")
      return res.status(403).render("error", {
        title: "Không có quyền truy cập",
        message: "Chức năng này dành cho quản trị viên.",
      });
    next();
  },
  csrf("adminCsrfToken"),
];
module.exports = { requireAuth, requireAdmin, csrf };
