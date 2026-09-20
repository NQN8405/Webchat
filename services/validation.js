const mongoose = require("mongoose");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function requireValue(value, message) {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
  return value;
}
function objectId(value, label) {
  requireValue(
    typeof value === "string" && mongoose.isValidObjectId(value),
    label + " không hợp lệ.",
  );
  return value;
}
function sameId(a, b) {
  return String(a?._id || a || "") === String(b?._id || b || "");
}
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
