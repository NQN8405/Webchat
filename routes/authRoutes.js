const express = require("express");
const controller = require("../controllers/authController");
const { csrf } = require("../middleware/authMiddleware");
const router = express.Router();
// Hiển thị biểu mẫu, xác thực đăng nhập và đăng xuất; mỗi biểu mẫu có mã CSRF riêng.
router.get("/login", csrf("loginCsrfToken"), controller.getLogin);
router.post("/login", csrf("loginCsrfToken"), controller.postLogin);
router.post("/logout", csrf("logoutCsrfToken"), controller.logout);
module.exports = router;
