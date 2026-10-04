const express = require("express");
const { requireAuth, csrf } = require("../middleware/authMiddleware");
const controller = require("../controllers/userController");
const router = express.Router();

function requireUserPage(req, res, next) {
  if (req.session.user.role !== "admin") return next();
  if (req.method === "GET") return res.redirect("/admin/users");
  return res.status(403).render("error", {
    title: "Không có quyền truy cập",
    message: "Tài khoản quản trị không sử dụng chức năng chat của người dùng.",
  });
}

router.get("/", requireAuth, requireUserPage, csrf("chatCsrfToken"), controller.getHome);
router.get("/chat", requireAuth, requireUserPage, csrf("chatCsrfToken"), controller.getChat);
router.get("/profile", requireAuth, requireUserPage, csrf("chatCsrfToken"), controller.getProfile);
router.post(
  "/channels/:id/messages",
  requireAuth,
  requireUserPage,
  csrf("chatCsrfToken"),
  controller.sendMessage,
);
router.post(
  "/profile/password",
  requireAuth,
  requireUserPage,
  csrf("chatCsrfToken"),
  controller.changePassword,
);
router.post(
  "/profile",
  requireAuth,
  requireUserPage,
  csrf("chatCsrfToken"),
  controller.updateProfile,
);
module.exports = router;
