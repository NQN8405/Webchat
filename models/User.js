const mongoose = require("mongoose");
const { birthDate } = require("../services/validation");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    hashedPassword: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    birthDate: {
      type: Date,
      validate: {
        validator: (value) => !value || !!birthDate(value.toISOString().slice(0, 10)),
        message: "Ngày sinh không hợp lệ.",
      },
    },
    avatarUrl: String,
    role: {
      type: String,
      enum: ["admin", "lecturer", "student"],
      default: "student",
      required: true,
    },
    status: { type: String, enum: ["active", "locked"], default: "active", required: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "StudentClass" },
  },
  { timestamps: true, collection: "users" },
);

module.exports = mongoose.model("User", userSchema);
