const mongoose = require("mongoose");
const ChannelMember = require("../models/ChannelMember");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const { isClassActive } = require("../services/classService");
function chatError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
async function channelAccess(channelId, userId, writing = false) {
  if (typeof channelId !== "string" || !mongoose.isValidObjectId(channelId))
    throw chatError("INVALID_CHANNEL", "Mã kênh không hợp lệ.");
  if (!(await ChannelMember.exists({ channelId, userId })))
    throw chatError("FORBIDDEN", "Bạn không còn quyền truy cập kênh này.", 403);
  const channel = await Channel.findOne({ _id: channelId, type: "class" }).populate({
    path: "classId",
    populate: { path: "majorId", populate: { path: "departmentId" } },
  });
  if (!channel?.classId) throw chatError("FORBIDDEN", "Kênh không còn tồn tại.", 403);
  const writable = channel.status === "active" && isClassActive(channel.classId);
  if (writing && !writable)
    throw chatError("CHANNEL_CLOSED", "Kênh đã đóng. Bạn vẫn có thể xem lịch sử tin nhắn.");
  return { channel, writable };
}
function messageDTO(message) {
  return {
    id: String(message._id),
    channelId: String(message.channelId),
    sender: {
      id: message.senderId?._id ? String(message.senderId._id) : "",
      displayName: message.senderId?.displayName || "Người dùng",
      avatarUrl: message.senderId?.avatarUrl || "",
    },
    content: message.content || "",
    createdAt: message.createdAt.toISOString(),
  };
}
async function messagePage(channelId, before) {
  const query = { channelId };
  if (before !== undefined && before !== null) {
    if (
      typeof before.id !== "string" ||
      !mongoose.isValidObjectId(before.id) ||
      typeof before.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(before.createdAt) ||
      !Number.isFinite(Date.parse(before.createdAt))
    )
      throw chatError("INVALID_CURSOR", "Mốc tải tin nhắn không hợp lệ.");
    const date = new Date(before.createdAt);
    query.$or = [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: before.id } }];
  }
  const items = await Message.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(51)
    .populate("senderId", "displayName avatarUrl");
  const hasMore = items.length > 50;
  const messages = items.slice(0, 50).reverse();
  const first = messages[0];
  return {
    messages,
    hasMore,
    cursor: first ? { id: String(first._id), createdAt: first.createdAt.toISOString() } : null,
  };
}
async function latestMessages(channelId, before) {
  const page = await messagePage(channelId, before);
  return { ...page, messages: page.messages.map(messageDTO) };
}
async function saveMessage(channelId, userId, content, messageId) {
  await channelAccess(channelId, userId, true);
  if (typeof content !== "string" || !content.trim() || content.trim().length > 4000)
    throw chatError("INVALID_CONTENT", "Nhập tin nhắn từ 1 đến 4.000 ký tự.");
  const fields = { channelId, senderId: userId, content: content.trim() };
  let saved;
  if (messageId) {
    saved = await Message.findById(messageId);
    if (!saved) {
      try {
        saved = await Message.create({ _id: messageId, ...fields });
      } catch (error) {
        if (error.code !== 11000) throw error;
        saved = await Message.findById(messageId);
      }
    }
    if (
      saved.content !== fields.content ||
      String(saved.channelId) !== channelId ||
      String(saved.senderId) !== String(userId)
    )
      throw chatError("REQUEST_CONFLICT", "Mã gửi đã được sử dụng cho nội dung khác.");
  } else saved = await Message.create(fields);
  await saved.populate("senderId", "displayName avatarUrl");
  return messageDTO(saved);
}

async function deleteMessage(channelId, userId, messageId) {
  await channelAccess(channelId, userId, true);
  if (typeof messageId !== "string" || !mongoose.isValidObjectId(messageId))
    throw chatError("INVALID_MESSAGE", "Mã tin nhắn không hợp lệ.");
  const message = await Message.findOneAndDelete({ _id: messageId, channelId, senderId: userId });
  if (!message)
    throw chatError(
      "MESSAGE_UNAVAILABLE",
      "Tin nhắn không tồn tại hoặc không phải do bạn gửi.",
      403,
    );
  return { id: messageId, channelId };
}
module.exports = {
  chatError,
  channelAccess,
  latestMessages,
  messagePage,
  saveMessage,
  deleteMessage,
};
