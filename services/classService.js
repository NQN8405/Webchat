const User = require("../models/User");
const Department = require("../models/Department");
const Major = require("../models/Major");
const StudentClass = require("../models/StudentClass");
const Channel = require("../models/Channel");
const ChannelMember = require("../models/ChannelMember");
const { EventEmitter } = require("node:events");
const { objectId, requireValue } = require("./validation");
const classEvents = new EventEmitter();
let syncQueue = Promise.resolve();

async function getClass(classId) {
  objectId(classId, "Lớp");
  const item = await StudentClass.findById(classId).populate({
    path: "majorId",
    populate: { path: "departmentId" },
  });
  requireValue(item, "Lớp không tồn tại.");
  return item;
}
function isClassActive(item) {
  return (
    item?.status === "active" &&
    item.majorId?.status === "active" &&
    item.majorId?.departmentId?.status === "active"
  );
}
async function getActiveClass(classId) {
  const item = await getClass(classId);
  requireValue(isClassActive(item), "Lớp, ngành hoặc khoa đã ngừng hoạt động.");
  return item;
}
async function getActiveMajor(majorId) {
  objectId(majorId, "Ngành");
  const item = await Major.findById(majorId).populate("departmentId");
  requireValue(
    item?.status === "active" && item.departmentId?.status === "active",
    "Ngành hoặc khoa không hoạt động.",
  );
  return item;
}
async function resolveUserMembership(body, existing) {
  if (body.role === "student" && body.classId) {
    const item = await getClass(body.classId);
    const keepingClass =
      existing?.role === "student" && String(existing.classId) === String(item._id);
    requireValue(keepingClass || isClassActive(item), "Không thể phân vào lớp đã ngừng hoạt động.");
    return { classId: item._id, departmentId: item.majorId?.departmentId?._id };
  }
  if (body.departmentId) {
    objectId(body.departmentId, "Khoa");
    const department = await Department.findById(body.departmentId);
    requireValue(
      department &&
        (department.status === "active" || String(existing?.departmentId) === department.id),
      "Khoa không hoạt động.",
    );
    return { classId: undefined, departmentId: department._id };
  }
  return { classId: undefined, departmentId: undefined };
}

async function synchronizeClasses() {
  await Promise.all([StudentClass.init(), Channel.init(), ChannelMember.init()]);
  const classes = await StudentClass.find().populate({
    path: "majorId",
    populate: { path: "departmentId" },
  });
  for (const item of classes) {
    const active = isClassActive(item);
    const channel = await Channel.findOneAndUpdate(
      { classId: item._id, type: "class" },
      {
        $setOnInsert: {
          classId: item._id,
          type: "class",
          name: "Chat chung " + item.code,
          description: "Trao đổi của lớp " + item.name,
          status: active ? "active" : "closed",
          ...(active ? {} : { closedAt: new Date() }),
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );
    if (!active && channel.status === "active") {
      channel.status = "closed";
      channel.closedAt = new Date();
      await channel.save();
    }
    if (item.majorId?.departmentId) {
      await User.updateMany(
        { role: "student", classId: item._id },
        { $set: { departmentId: item.majorId.departmentId._id } },
      );
    }
    const students = await User.find({
      role: "student",
      status: "active",
      classId: item._id,
    }).select("_id");
    const teacher = item.homeroomTeacherId
      ? await User.findOne({
          _id: item.homeroomTeacherId,
          role: "lecturer",
          status: "active",
        }).select("_id")
      : null;
    const userIds = [...students.map((student) => student._id), ...(teacher ? [teacher._id] : [])];
    for (const userId of userIds) {
      await ChannelMember.updateOne(
        { channelId: channel._id, userId },
        { $setOnInsert: { channelId: channel._id, userId, joinedAt: new Date() } },
        { upsert: true },
      );
    }
    await ChannelMember.deleteMany({ channelId: channel._id, userId: { $nin: userIds } });
  }
  classEvents.emit("changed");
}
function syncClasses() {
  syncQueue = syncQueue.catch(() => {}).then(synchronizeClasses);
  return syncQueue;
}
module.exports = {
  getActiveClass,
  getActiveMajor,
  isClassActive,
  resolveUserMembership,
  syncClasses,
  classEvents,
};
