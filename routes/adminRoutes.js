const express = require("express");
const controller = require("../controllers/adminController");
const { requireAdmin } = require("../middleware/authMiddleware");
const router = express.Router();
router.use(requireAdmin);
router.get("/", (req, res) => res.redirect("/admin/users"));

router.get("/users", controller.getUsers);
router.post("/users", controller.saveUser);
router.post("/users/:id/update", controller.saveUser);
router.post("/users/:id/toggle-status", controller.toggleUser);
router.get("/departments", controller.getDepartments);
router.post("/departments", controller.saveDepartment);
router.post("/departments/:id/update", controller.saveDepartment);
router.post("/departments/:id/toggle-status", controller.toggleDepartment);

router.use((error, req, res, next) => {
  if (res.headersSent || req.method !== "POST") return next(error);
  const section = req.path.split("/")[1];
  const sections = ["users", "departments", "majors", "classes", "class-students", "channels"];
  if (!sections.includes(section)) return next(error);
  req.session.error =
    error.code === 11000
      ? "Mã hoặc tên đăng nhập đã tồn tại."
      : error.status
        ? error.message
        : "Không thể lưu lúc này. Hãy thử lại.";
  if (!error.status && error.code !== 11000) console.error(error);
  const submittedClassId = req.body?.classId;
  const classId =
    section === "class-students" && /^[a-f0-9]{24}$/i.test(submittedClassId || "")
      ? "?classId=" + submittedClassId
      : "";
  res.redirect("/admin/" + section + classId);
});
module.exports = router;
