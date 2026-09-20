const mongoose = require("mongoose");
const majorSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
    status: { type: String, enum: ["active", "inactive"], default: "active", required: true },
  },
  { timestamps: true, collection: "majors" },
);
module.exports = mongoose.model("Major", majorSchema);
