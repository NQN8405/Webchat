const mongoose = require("mongoose");
const messageSchema = new mongoose.Schema(
  {
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true, collection: "messages" },
);
messageSchema.index({ channelId: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model("Message", messageSchema);
