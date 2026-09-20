const mongoose = require("mongoose");
const memberSchema = new mongoose.Schema(
  {
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { collection: "channelmembers" },
);
memberSchema.index({ channelId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.model("ChannelMember", memberSchema);
