const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema({
  listingId: { type: mongoose.Schema.Types.ObjectId, ref: "Listing", required: true, index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  requestedQuantity: { type: Number, required: true, min: 1 }, // Allows partial claiming
  // LOGISTICS LAYER
  deliveryMethod: { type: String, enum: ["pickup", "volunteer_delivery"], default: "pickup" },
  volunteerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Track who delivers
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected", "completed"],
    default: "pending"
  },
  // TRUST SYSTEM LAYER
  ratingScore: { type: Number, min: 1, max: 5 },
  feedbackText: { type: String, maxlength: 500 }
}, { timestamps: true });

requestSchema.index({ listingId: 1, receiverId: 1 }, { unique: true });

module.exports = mongoose.model("Request", requestSchema);