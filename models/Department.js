const mongoose = require("mongoose");
// Danh mục khoa; mã duy nhất và được chuẩn hóa thành chữ hoa khi lưu.
const departmentSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active", required: true },
  },
  { timestamps: true, collection: "departments" },
);
module.exports = mongoose.model("Department", departmentSchema);
