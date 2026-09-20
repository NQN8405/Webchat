const mongoose = require("mongoose");
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
channelSchema.index({ classId: 1 }, { unique: true, partialFilterExpression: { type: "class" } });
module.exports = mongoose.model("Channel", channelSchema);
