const bcrypt = require("bcrypt");
const User = require("../models/User");
const { text } = require("../services/validation");

// Đã đăng nhập thì chuyển đến trang theo vai trò; ngược lại hiển thị biểu mẫu.
exports.getLogin = (req, res) => {
  if (req.session?.user) {
    return res.redirect(req.session.user.role === "admin" ? "/admin/users" : "/");
  }
  res.render("auth/Login", { error: null });
};

// Kiểm tra tài khoản, trạng thái và mật khẩu đã băm trước khi tạo phiên đăng nhập.
exports.postLogin = async (req, res) => {
  try {
    const user = await User.findOne({ username: text(req.body.username) });
    if (
      !user ||
      user.status === "locked" ||
      !(await bcrypt.compare(
        typeof req.body.password === "string" ? req.body.password : "",
        user.hashedPassword,
      ))
    ) {
      return res.status(401).render("auth/Login", {
        error:
          !user || user.status === "locked"
            ? user?.status === "locked"
              ? "Tài khoản đã bị khóa."
              : "Tên đăng nhập hoặc mật khẩu không đúng."
            : "Tên đăng nhập hoặc mật khẩu không đúng.",
      });
    }
    // Tạo lại session ID sau đăng nhập để tránh dùng lại phiên chưa xác thực.
    await new Promise((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
    await new Promise((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
    res.redirect(user.role === "admin" ? "/admin/users" : "/");
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).render("auth/Login", {
      error: "Không thể đăng nhập lúc này.",
    });
  }
};

// Hủy phiên đăng nhập và đưa người dùng về trang đăng nhập.
exports.logout = (req, res) => req.session.destroy(() => res.redirect("/login"));
