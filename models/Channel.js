const mongoose = require("mongoose");
// Kênh chung của lớp; active cho phép chat, closed giữ lịch sử để xem lại.
const channelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    type: { type: String, enum: ["class"], default: "class", required: true },
    status: { type: String, enum: ["active", "closed"], default: "active", required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "StudentClass", required: true },
    closedAt: Date,
  },
  { timestamps: true, collection: "channels" },
);
// Index có điều kiện: có thể thêm loại kênh khác sau này mà không đổi tên collection.
channelSchema.index({ classId: 1 }, { unique: true, partialFilterExpression: { type: "class" } });
module.exports = mongoose.model("Channel", channelSchema);
