const mongoose = require("mongoose");

// Chỉ nhận chuỗi và bỏ khoảng trắng đầu/cuối để dùng chung khi đọc biểu mẫu.
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
// Điều kiện sai thì báo lỗi 400; điều kiện đúng trả lại giá trị để tiếp tục xử lý.
function requireValue(value, message) {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
  return value;
}
// Kiểm tra định danh MongoDB trước khi đưa vào truy vấn.
function objectId(value, label) {
  requireValue(
    typeof value === "string" && mongoose.isValidObjectId(value),
    label + " không hợp lệ.",
  );
  return value;
}
// So sánh được cả ObjectId, chuỗi id và document đã populate.
function sameId(a, b) {
  return String(a?._id || a || "") === String(b?._id || b || "");
}
// Biểu mẫu date gửi yyyy-MM-dd; lưu UTC để ngày sinh không lệch theo múi giờ.
function birthDate(value) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(),
  );
  requireValue(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Vui lòng nhập ngày sinh.",
  );
  const date = new Date(value + "T00:00:00.000Z");
  requireValue(
    Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= "1900-01-01" &&
      value <= today,
    "Ngày sinh không hợp lệ hoặc nằm trong tương lai.",
  );
  return date;
}
module.exports = { text, requireValue, objectId, sameId, birthDate };
