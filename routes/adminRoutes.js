const express = require("express");
const controller = require("../controllers/adminController");
const { requireAdmin } = require("../middleware/authMiddleware");
const router = express.Router();
// Tất cả route bên dưới dùng chung kiểm tra đăng nhập, quyền admin và CSRF.
router.use(requireAdmin);
router.get("/", (req, res) => res.redirect("/admin/users"));

// Nhóm route tài khoản. GET xem dữ liệu, POST thực hiện thay đổi.
router.get("/users", controller.getUsers);
router.post("/users", controller.saveUser);
router.post("/users/:id/update", controller.saveUser);
router.post("/users/:id/toggle-status", controller.toggleUser);
// Nhóm route quản lý khoa, ngành và lớp.
router.get("/departments", controller.getDepartments);
router.post("/departments", controller.saveDepartment);
router.post("/departments/:id/update", controller.saveDepartment);
router.post("/departments/:id/toggle-status", controller.toggleDepartment);
router.get("/majors", controller.getMajors);
router.post("/majors", controller.saveMajor);
router.post("/majors/:id/update", controller.saveMajor);
router.post("/majors/:id/toggle-status", controller.toggleMajor);
router.get("/classes", controller.getClasses);
router.post("/classes", controller.saveClass);
router.post("/classes/:id/update", controller.saveClass);
router.post("/classes/:id/toggle-status", controller.toggleClass);
// Phân/bỏ sinh viên khỏi lớp và quản lý tên, trạng thái kênh chung.
router.get("/class-students", controller.getClassStudents);
router.post("/class-students/assign", controller.assignStudents);
router.post("/class-students/:id/remove", controller.removeStudent);
router.get("/channels", controller.getChannels);
router.post("/channels/:id/update", controller.saveChannel);
router.post("/channels/:id/toggle-status", controller.toggleChannel);

// Lỗi biểu mẫu trả về đúng trang và hiển thị thông báo.
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
