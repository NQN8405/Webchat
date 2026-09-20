const mongoose = require("mongoose");
const departmentSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active", required: true },
  },
  { timestamps: true, collection: "departments" },
);
module.exports = mongoose.model("Department", departmentSchema);
