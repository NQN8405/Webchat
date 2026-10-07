const mongoose = require("mongoose");
// Liên kết tài khoản với kênh; được đồng bộ từ phân lớp và phân công chủ nhiệm.
const memberSchema = new mongoose.Schema(
  {
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { collection: "channelmembers" },
);
// Mỗi người chỉ có một bản ghi thành viên trong cùng kênh.
memberSchema.index({ channelId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.model("ChannelMember", memberSchema);
