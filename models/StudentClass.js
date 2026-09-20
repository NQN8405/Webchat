const mongoose = require("mongoose");
const classSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    majorId: { type: mongoose.Schema.Types.ObjectId, ref: "Major", required: true },
    homeroomTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["active", "inactive"], default: "active", required: true },
  },
  {
    timestamps: true,
    collection: "classes",
  },
);
classSchema.index({ majorId: 1, name: 1 }, { unique: true });
module.exports = mongoose.model("StudentClass", classSchema);
