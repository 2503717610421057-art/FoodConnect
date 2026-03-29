const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { 
    type: String, unique: true, required: true, lowercase: true, trim: true,
    match: [/^\S+@\S+\.\S+$/, "Please use a valid email address"] 
  },
  password: { type: String, required: true, select: false },
  phone: { type: String }, // Crucial for logistics handover
  role: { 
    type: String, 
    enum: ["donor", "receiver", "volunteer", "charity_team", "admin"], 
    required: true 
  },
  // INTELLIGENT LAYER: Gamification & Reliability
  reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },
  points: { type: Number, default: 0 }, 
  isVerified: { type: Boolean, default: false }, // For NGOs and Charity Teams
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [lng, lat]
  }
}, { timestamps: true });

userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model("User", userSchema);